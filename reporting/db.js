require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.REPORT_PGHOST,
  port: Number(process.env.REPORT_PGPORT || 5432),
  user: process.env.REPORT_PGUSER,
  password: process.env.REPORT_PGPASSWORD,
  database: process.env.REPORT_PGDATABASE,
  ssl: /^true$/i.test(process.env.REPORT_PGSSL || "")
});

pool.on("error", (err) => console.error("[reporting-db] pool error", err));

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL statement_timeout TO ${Number(process.env.REPORT_QUERY_TIMEOUT_MS || 30000)}`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
