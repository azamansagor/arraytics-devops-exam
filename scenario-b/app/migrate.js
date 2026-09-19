// Applies schema.sql to whatever database DB_* points at.
//
// Kept separate from server.js on purpose. Schema changes are a deploy-time step,
// not something an application process should do while starting up - with several
// tasks starting at once, each one racing to create the same tables is how you get
// half-applied schemas. In the ECS task definition this runs as its own
// non-essential container that exits when it is done, and the app container waits
// for it via dependsOn.
//
//   node migrate.js && node seed.js

const fs = require('fs');
const path = require('path');
const { pool, query } = require('./db');

// ECS dependsOn: { condition: HEALTHY } waits for pg_isready, which is close enough
// but not identical to the server being ready for our connection - the health check
// runs inside the postgres container over a unix socket, we arrive over TCP a moment
// later. This retry covers that gap rather than letting the container exit non-zero
// and block the app container behind it.
async function waitForPostgres(attempts = 30, delayMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await query('SELECT 1');
      console.log(`postgres reachable after ${i} attempt(s)`);
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`postgres not ready (${err.code || err.message}), retrying ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function main() {
  await waitForPostgres();

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('applying schema.sql...');
  await query(sql);

  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log('tables now present:', rows.map((r) => r.table_name).join(', '));

  await pool.end();
}

main().catch(async (err) => {
  console.error('migrate failed:', err.message);
  await pool.end();
  process.exit(1);
});
