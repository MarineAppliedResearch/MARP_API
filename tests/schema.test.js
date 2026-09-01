/**
 * Smoke tests for schema introspection endpoints.
 *
 * These tests assert contract shape and status codes for read-only schema
 * metadata routes without mutating the database.
 *
 * @fileoverview Tests for /api/schema endpoints.
 * @author Isaac Travers
 * @module tests/schema
 */

const request = require('supertest');
const app = require('../app');

/**
 * GET /api/schema/tables returns table metadata.
 */
describe('GET /api/schema/tables', () => {
    it('returns 200 with an array of table metadata objects', async () => {
        const res = await global.api.get('/api/v2/schema/tables');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        if (res.body.length > 0) {
            const table = res.body[0];
            expect(typeof table.schema).toBe('string');
            expect(typeof table.name).toBe('string');
            expect(Array.isArray(table.columns)).toBe(true);
            expect(Array.isArray(table.foreignKeys)).toBe(true);
            expect(Array.isArray(table.uniqueConstraints)).toBe(true);
            expect(Array.isArray(table.indexes)).toBe(true);

            if (table.columns.length > 0) {
                const column = table.columns[0];
                expect(typeof column.name).toBe('string');
                expect(typeof column.dataType).toBe('string');
                expect(typeof column.isNullable).toBe('boolean');
            }
        }
    });
});

/**
 * GET /api/schema/views returns view metadata.
 */
describe('GET /api/schema/views', () => {
    it('returns 200 with an array of view metadata objects', async () => {
        const res = await global.api.get('/api/v2/schema/views');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        if (res.body.length > 0) {
            const view = res.body[0];
            expect(typeof view.schema).toBe('string');
            expect(typeof view.name).toBe('string');
            expect(typeof view.type).toBe('string');
            expect(typeof view.isUpdatable).toBe('boolean');
            expect(typeof view.definition).toBe('string');
            expect(Array.isArray(view.columns)).toBe(true);
            expect(Array.isArray(view.dependencies)).toBe(true);
        }
    });
});

/**
 * GET /api/schema/relationships returns normalized FK relationships.
 */
describe('GET /api/schema/relationships', () => {
    it('returns 200 with an array of relationship objects', async () => {
        const res = await global.api.get('/api/v2/schema/relationships');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);

        if (res.body.length > 0) {
            const relationship = res.body[0];
            expect(typeof relationship.name).toBe('string');
            expect(typeof relationship.source_schema).toBe('string');
            expect(typeof relationship.source_table).toBe('string');
            expect(Array.isArray(relationship.source_columns)).toBe(true);
            expect(typeof relationship.target_schema).toBe('string');
            expect(typeof relationship.target_table).toBe('string');
            expect(Array.isArray(relationship.target_columns)).toBe(true);
        }
    });
});
