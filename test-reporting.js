const { Client } = require("pg");
require("dotenv").config();

(async () => {
  const client = new Client({
    host: process.env.REPORT_PGHOST || "192.168.1.205",   // use the server’s IP/DNS
    port: Number(process.env.REPORT_PGPORT || 5432),
    user: process.env.REPORT_PGUSER || "mare_readonly",
    password: process.env.REPORT_PGPASSWORD || "<password>",
    database: process.env.REPORT_PGDATABASE || "<DBNAME>",
    ssl: false // set true if your server requires SSL
  });

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
  } finally {
    await client.end();
  }
})();