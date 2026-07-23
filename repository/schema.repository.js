/**
 * Repository module for PostgreSQL schema introspection.
 *
 * Provides read-only metadata queries for public tables and views so API
 * consumers can build database browsers, relationship maps, and query helpers.
 *
 * @fileoverview Schema introspection repository queries.
 * @author Isaac Travers
 * @module repository/schema
 */

const db = require('../model');
const logger = require('../logger/api.logger');

/**
 * Normalize PostgreSQL array values to plain JavaScript string arrays.
 *
 * @param {Array<string>|string|null} value - Value returned from pg driver.
 * @returns {Array<string>} Normalized array.
 */
function normalizePgArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value !== 'string') {
        return [];
    }

    if (!value.startsWith('{') || !value.endsWith('}')) {
        return [value];
    }

    const inner = value.slice(1, -1);
    if (inner.trim() === '') {
        return [];
    }

    return inner.split(',').map((item) => item.replace(/^"|"$/g, ''));
}

/**
 * Repository for schema introspection queries.
 *
 * @class SchemaRepository
 */
class SchemaRepository {

    db = {};

    constructor() {
        this.db = db;
    }

    /**
     * Retrieve detailed metadata for every base table in the public schema.
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of table metadata objects with
     * columns, keys, constraints, indexes, and row estimates.
     */
    async getPublicTables() {
        try {
            const tables = await this.db.sequelize.query(
                `
                    SELECT
                        n.nspname AS table_schema,
                        c.relname AS table_name,
                        c.reltuples::bigint AS row_estimate,
                        obj_description(c.oid) AS comment
                    FROM pg_class c
                    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public'
                      AND c.relkind IN ('r', 'p')
                    ORDER BY c.relname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const columns = await this.db.sequelize.query(
                `
                    SELECT
                        c.table_schema,
                        c.table_name,
                        c.column_name,
                        c.ordinal_position,
                        c.data_type,
                        c.udt_name,
                        c.is_nullable,
                        c.column_default,
                        c.character_maximum_length,
                        c.numeric_precision,
                        c.numeric_scale,
                        c.datetime_precision,
                        c.is_identity,
                        c.identity_generation,
                        pg_catalog.col_description(pg_class.oid, c.ordinal_position::int) AS comment
                    FROM information_schema.columns c
                    INNER JOIN pg_class ON pg_class.relname = c.table_name
                    INNER JOIN pg_namespace ns ON ns.oid = pg_class.relnamespace
                    WHERE c.table_schema = 'public'
                      AND ns.nspname = 'public'
                    ORDER BY c.table_name, c.ordinal_position;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const primaryKeys = await this.db.sequelize.query(
                `
                    SELECT
                        ns.nspname AS table_schema,
                        tbl.relname AS table_name,
                        con.conname AS constraint_name,
                        array_agg(att.attname ORDER BY key_ords.ord) AS column_names
                    FROM pg_constraint con
                    INNER JOIN pg_class tbl ON tbl.oid = con.conrelid
                    INNER JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                    INNER JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key_ords(attnum, ord) ON true
                    INNER JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = key_ords.attnum
                    WHERE con.contype = 'p'
                      AND ns.nspname = 'public'
                    GROUP BY ns.nspname, tbl.relname, con.conname
                    ORDER BY tbl.relname, con.conname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const foreignKeys = await this.db.sequelize.query(
                `
                    SELECT
                        src_ns.nspname AS table_schema,
                        src_tbl.relname AS table_name,
                        con.conname AS constraint_name,
                        array_agg(src_att.attname ORDER BY src_keys.ord) AS column_names,
                        ref_ns.nspname AS referenced_table_schema,
                        ref_tbl.relname AS referenced_table_name,
                        array_agg(ref_att.attname ORDER BY ref_keys.ord) AS referenced_column_names,
                        CASE con.confupdtype
                            WHEN 'a' THEN 'NO ACTION'
                            WHEN 'r' THEN 'RESTRICT'
                            WHEN 'c' THEN 'CASCADE'
                            WHEN 'n' THEN 'SET NULL'
                            WHEN 'd' THEN 'SET DEFAULT'
                        END AS on_update,
                        CASE con.confdeltype
                            WHEN 'a' THEN 'NO ACTION'
                            WHEN 'r' THEN 'RESTRICT'
                            WHEN 'c' THEN 'CASCADE'
                            WHEN 'n' THEN 'SET NULL'
                            WHEN 'd' THEN 'SET DEFAULT'
                        END AS on_delete
                    FROM pg_constraint con
                    INNER JOIN pg_class src_tbl ON src_tbl.oid = con.conrelid
                    INNER JOIN pg_namespace src_ns ON src_ns.oid = src_tbl.relnamespace
                    INNER JOIN pg_class ref_tbl ON ref_tbl.oid = con.confrelid
                    INNER JOIN pg_namespace ref_ns ON ref_ns.oid = ref_tbl.relnamespace
                    INNER JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_keys(attnum, ord) ON true
                    INNER JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS ref_keys(attnum, ord) ON ref_keys.ord = src_keys.ord
                    INNER JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = src_keys.attnum
                    INNER JOIN pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = ref_keys.attnum
                    WHERE con.contype = 'f'
                      AND src_ns.nspname = 'public'
                    GROUP BY
                        src_ns.nspname,
                        src_tbl.relname,
                        con.conname,
                        ref_ns.nspname,
                        ref_tbl.relname,
                        con.confupdtype,
                        con.confdeltype
                    ORDER BY src_tbl.relname, con.conname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const uniqueConstraints = await this.db.sequelize.query(
                `
                    SELECT
                        ns.nspname AS table_schema,
                        tbl.relname AS table_name,
                        con.conname AS constraint_name,
                        array_agg(att.attname ORDER BY key_ords.ord) AS column_names
                    FROM pg_constraint con
                    INNER JOIN pg_class tbl ON tbl.oid = con.conrelid
                    INNER JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                    INNER JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key_ords(attnum, ord) ON true
                    INNER JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = key_ords.attnum
                    WHERE con.contype = 'u'
                      AND ns.nspname = 'public'
                    GROUP BY ns.nspname, tbl.relname, con.conname
                    ORDER BY tbl.relname, con.conname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const checkConstraints = await this.db.sequelize.query(
                `
                    SELECT
                        ns.nspname AS table_schema,
                        tbl.relname AS table_name,
                        con.conname AS constraint_name,
                        pg_get_constraintdef(con.oid, true) AS check_expression
                    FROM pg_constraint con
                    INNER JOIN pg_class tbl ON tbl.oid = con.conrelid
                    INNER JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                    WHERE con.contype = 'c'
                      AND ns.nspname = 'public'
                    ORDER BY tbl.relname, con.conname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const indexes = await this.db.sequelize.query(
                `
                    SELECT
                        ns.nspname AS table_schema,
                        tbl.relname AS table_name,
                        idx.relname AS index_name,
                        ind.indisunique AS is_unique,
                        ind.indisprimary AS is_primary,
                        pg_get_indexdef(ind.indexrelid) AS index_definition
                    FROM pg_index ind
                    INNER JOIN pg_class tbl ON tbl.oid = ind.indrelid
                    INNER JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                    INNER JOIN pg_class idx ON idx.oid = ind.indexrelid
                    WHERE ns.nspname = 'public'
                    ORDER BY tbl.relname, idx.relname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const tableMap = new Map();

            for (const table of tables) {
                tableMap.set(
                    `${table.table_schema}.${table.table_name}`,
                    {
                        schema: table.table_schema,
                        name: table.table_name,
                        rowEstimate: Number(table.row_estimate || 0),
                        comment: table.comment,
                        columns: [],
                        primaryKey: null,
                        foreignKeys: [],
                        uniqueConstraints: [],
                        checkConstraints: [],
                        indexes: [],
                    }
                );
            }

            for (const column of columns) {
                const key = `${column.table_schema}.${column.table_name}`;
                const table = tableMap.get(key);
                if (!table) {
                    continue;
                }

                table.columns.push({
                    name: column.column_name,
                    ordinalPosition: Number(column.ordinal_position),
                    dataType: column.data_type,
                    udtName: column.udt_name,
                    isNullable: column.is_nullable === 'YES',
                    defaultValue: column.column_default,
                    maxLength: column.character_maximum_length,
                    numericPrecision: column.numeric_precision,
                    numericScale: column.numeric_scale,
                    datetimePrecision: column.datetime_precision,
                    isIdentity: column.is_identity === 'YES',
                    identityGeneration: column.identity_generation,
                    comment: column.comment,
                });
            }

            for (const primaryKey of primaryKeys) {
                const key = `${primaryKey.table_schema}.${primaryKey.table_name}`;
                const table = tableMap.get(key);
                if (!table) {
                    continue;
                }

                table.primaryKey = {
                    name: primaryKey.constraint_name,
                    columns: normalizePgArray(primaryKey.column_names),
                };
            }

            for (const foreignKey of foreignKeys) {
                const key = `${foreignKey.table_schema}.${foreignKey.table_name}`;
                const table = tableMap.get(key);
                if (!table) {
                    continue;
                }

                table.foreignKeys.push({
                    name: foreignKey.constraint_name,
                    columns: normalizePgArray(foreignKey.column_names),
                    referencedSchema: foreignKey.referenced_table_schema,
                    referencedTable: foreignKey.referenced_table_name,
                    referencedColumns: normalizePgArray(foreignKey.referenced_column_names),
                    onUpdate: foreignKey.on_update,
                    onDelete: foreignKey.on_delete,
                });
            }

            for (const uniqueConstraint of uniqueConstraints) {
                const key = `${uniqueConstraint.table_schema}.${uniqueConstraint.table_name}`;
                const table = tableMap.get(key);
                if (!table) {
                    continue;
                }

                table.uniqueConstraints.push({
                    name: uniqueConstraint.constraint_name,
                    columns: normalizePgArray(uniqueConstraint.column_names),
                });
            }

            for (const checkConstraint of checkConstraints) {
                const key = `${checkConstraint.table_schema}.${checkConstraint.table_name}`;
                const table = tableMap.get(key);
                if (!table) {
                    continue;
                }

                table.checkConstraints.push({
                    name: checkConstraint.constraint_name,
                    expression: checkConstraint.check_expression,
                });
            }

            for (const index of indexes) {
                const key = `${index.table_schema}.${index.table_name}`;
                const table = tableMap.get(key);
                if (!table) {
                    continue;
                }

                table.indexes.push({
                    name: index.index_name,
                    isUnique: index.is_unique,
                    isPrimary: index.is_primary,
                    definition: index.index_definition,
                });
            }

            return Array.from(tableMap.values());
        } catch (error) {
            logger.error('Repository: getPublicTables failed', error);
            throw error;
        }
    }

    /**
     * Retrieve metadata for all standard and materialized views in public.
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of view metadata objects with
     * columns, SQL definition, updatability flag, and dependencies.
     */
    async getPublicViews() {
        try {
            const standardViews = await this.db.sequelize.query(
                `
                    SELECT
                        table_schema AS view_schema,
                        table_name AS view_name,
                        view_definition,
                        is_updatable,
                        'VIEW'::text AS view_type
                    FROM information_schema.views
                    WHERE table_schema = 'public'
                    ORDER BY table_name;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const materializedViews = await this.db.sequelize.query(
                `
                    SELECT
                        schemaname AS view_schema,
                        matviewname AS view_name,
                        definition AS view_definition,
                        'NO'::text AS is_updatable,
                        'MATERIALIZED_VIEW'::text AS view_type
                    FROM pg_matviews
                    WHERE schemaname = 'public'
                    ORDER BY matviewname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const columns = await this.db.sequelize.query(
                `
                    SELECT
                        c.table_schema AS view_schema,
                        c.table_name AS view_name,
                        c.column_name,
                        c.ordinal_position,
                        c.data_type,
                        c.udt_name,
                        c.is_nullable,
                        c.column_default
                    FROM information_schema.columns c
                    INNER JOIN information_schema.views v
                      ON v.table_schema = c.table_schema
                     AND v.table_name = c.table_name
                    WHERE c.table_schema = 'public'
                    ORDER BY c.table_name, c.ordinal_position;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const dependencies = await this.db.sequelize.query(
                `
                    SELECT
                        view_ns.nspname AS view_schema,
                        view_cls.relname AS view_name,
                        dep_ns.nspname AS dependency_schema,
                        dep_cls.relname AS dependency_name,
                        CASE dep_cls.relkind
                            WHEN 'r' THEN 'TABLE'
                            WHEN 'p' THEN 'PARTITIONED_TABLE'
                            WHEN 'v' THEN 'VIEW'
                            WHEN 'm' THEN 'MATERIALIZED_VIEW'
                            WHEN 'f' THEN 'FOREIGN_TABLE'
                            ELSE dep_cls.relkind::text
                        END AS dependency_type
                    FROM pg_rewrite rw
                    INNER JOIN pg_class view_cls ON view_cls.oid = rw.ev_class
                    INNER JOIN pg_namespace view_ns ON view_ns.oid = view_cls.relnamespace
                    INNER JOIN pg_depend dep ON dep.objid = rw.oid
                    INNER JOIN pg_class dep_cls ON dep_cls.oid = dep.refobjid
                    INNER JOIN pg_namespace dep_ns ON dep_ns.oid = dep_cls.relnamespace
                    WHERE view_ns.nspname = 'public'
                      AND view_cls.relkind IN ('v', 'm')
                      AND dep_ns.nspname = 'public'
                      AND dep_cls.relkind IN ('r', 'p', 'v', 'm', 'f')
                      AND dep_cls.oid <> view_cls.oid
                    GROUP BY
                        view_ns.nspname,
                        view_cls.relname,
                        dep_ns.nspname,
                        dep_cls.relname,
                        dep_cls.relkind
                    ORDER BY view_cls.relname, dep_ns.nspname, dep_cls.relname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            const allViews = [...standardViews, ...materializedViews];
            const viewMap = new Map();

            for (const view of allViews) {
                viewMap.set(
                    `${view.view_schema}.${view.view_name}`,
                    {
                        schema: view.view_schema,
                        name: view.view_name,
                        type: view.view_type,
                        isUpdatable: view.is_updatable === 'YES',
                        definition: view.view_definition,
                        columns: [],
                        dependencies: [],
                    }
                );
            }

            for (const column of columns) {
                const key = `${column.view_schema}.${column.view_name}`;
                const view = viewMap.get(key);
                if (!view) {
                    continue;
                }

                view.columns.push({
                    name: column.column_name,
                    ordinalPosition: Number(column.ordinal_position),
                    dataType: column.data_type,
                    udtName: column.udt_name,
                    isNullable: column.is_nullable === 'YES',
                    defaultValue: column.column_default,
                });
            }

            for (const dependency of dependencies) {
                const key = `${dependency.view_schema}.${dependency.view_name}`;
                const view = viewMap.get(key);
                if (!view) {
                    continue;
                }

                view.dependencies.push({
                    schema: dependency.dependency_schema,
                    name: dependency.dependency_name,
                    type: dependency.dependency_type,
                });
            }

            return Array.from(viewMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            logger.error('Repository: getPublicViews failed', error);
            throw error;
        }
    }

    /**
     * Retrieve all foreign-key relationships between public-schema tables.
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of normalized FK relationship edges.
     */
    async getPublicRelationships() {
        try {
            const relationships = await this.db.sequelize.query(
                `
                    SELECT
                        con.conname AS name,
                        src_ns.nspname AS source_schema,
                        src_tbl.relname AS source_table,
                        array_agg(src_att.attname ORDER BY src_keys.ord) AS source_columns,
                        ref_ns.nspname AS target_schema,
                        ref_tbl.relname AS target_table,
                        array_agg(ref_att.attname ORDER BY ref_keys.ord) AS target_columns,
                        CASE con.confupdtype
                            WHEN 'a' THEN 'NO ACTION'
                            WHEN 'r' THEN 'RESTRICT'
                            WHEN 'c' THEN 'CASCADE'
                            WHEN 'n' THEN 'SET NULL'
                            WHEN 'd' THEN 'SET DEFAULT'
                        END AS on_update,
                        CASE con.confdeltype
                            WHEN 'a' THEN 'NO ACTION'
                            WHEN 'r' THEN 'RESTRICT'
                            WHEN 'c' THEN 'CASCADE'
                            WHEN 'n' THEN 'SET NULL'
                            WHEN 'd' THEN 'SET DEFAULT'
                        END AS on_delete
                    FROM pg_constraint con
                    INNER JOIN pg_class src_tbl ON src_tbl.oid = con.conrelid
                    INNER JOIN pg_namespace src_ns ON src_ns.oid = src_tbl.relnamespace
                    INNER JOIN pg_class ref_tbl ON ref_tbl.oid = con.confrelid
                    INNER JOIN pg_namespace ref_ns ON ref_ns.oid = ref_tbl.relnamespace
                    INNER JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_keys(attnum, ord) ON true
                    INNER JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS ref_keys(attnum, ord) ON ref_keys.ord = src_keys.ord
                    INNER JOIN pg_attribute src_att ON src_att.attrelid = con.conrelid AND src_att.attnum = src_keys.attnum
                    INNER JOIN pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = ref_keys.attnum
                    WHERE con.contype = 'f'
                      AND src_ns.nspname = 'public'
                      AND ref_ns.nspname = 'public'
                    GROUP BY
                        con.conname,
                        src_ns.nspname,
                        src_tbl.relname,
                        ref_ns.nspname,
                        ref_tbl.relname,
                        con.confupdtype,
                        con.confdeltype
                    ORDER BY src_tbl.relname, con.conname;
                `,
                { type: this.db.Sequelize.QueryTypes.SELECT }
            );

            return relationships.map((relationship) => ({
                ...relationship,
                source_columns: normalizePgArray(relationship.source_columns),
                target_columns: normalizePgArray(relationship.target_columns),
            }));
        } catch (error) {
            logger.error('Repository: getPublicRelationships failed', error);
            throw error;
        }
    }
}

module.exports = new SchemaRepository();
