const { Client } = require("pg");
require("dotenv").config();

// Connection details come only from the environment. There are deliberately no
// fallback values: an earlier version defaulted to the live reporting server, so
// running this script on a machine without a loaded .env silently pointed a
// permission test at production.
const REQUIRED_VARS = [
  "REPORT_PGHOST",
  "REPORT_PGUSER",
  "REPORT_PGPASSWORD",
  "REPORT_PGDATABASE"
];

const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `Refusing to run: missing reporting database variables: ${missing.join(", ")}.\n` +
    "Set them in .env (see .env.example) and point them at a development server."
  );
  process.exit(1);
}

(async () => {
  const client = new Client({
    host: process.env.REPORT_PGHOST,
    port: Number(process.env.REPORT_PGPORT || 5432),
    user: process.env.REPORT_PGUSER,
    password: process.env.REPORT_PGPASSWORD,
    database: process.env.REPORT_PGDATABASE,
    // Honour REPORT_PGSSL the same way reporting/db.js does.
    ssl: /^true$/i.test(process.env.REPORT_PGSSL || "")
  });

  console.log(
    `Connecting to ${process.env.REPORT_PGHOST}:${Number(process.env.REPORT_PGPORT || 5432)}` +
    ` database ${process.env.REPORT_PGDATABASE} as ${process.env.REPORT_PGUSER}`
  );

  try {
    await client.connect();
    await client.query("SET statement_timeout = 30000");
    const { rows } = await client.query(
      `select current_user, current_database(), inet_server_addr() as server_ip, inet_client_addr() as client_ip, now() as server_time`
    );
    console.log("Identity:", rows[0]);

    // quick read of catalog (doesn't need a specific table)
    const tables = await client.query(
      `select tablename from pg_tables where schemaname='public' order by tablename limit 10`
    );
    console.log("Some tables:", tables.rows.map(r => r.tablename));

    // write should fail
    let writeDenied = false;
    try {
      await client.query(`create table public.__perm_test(id int)`);
    } catch (e) {
      writeDenied = true;
      console.log("Write denied (expected):", e.message);
    }
    console.log("Write permission correctly denied?", writeDenied);
  } catch (e) {
    console.error("Connection or query failed:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();