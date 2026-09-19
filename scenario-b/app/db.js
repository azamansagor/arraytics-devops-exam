const { Pool } = require('pg');

// Every connection detail comes from the environment. The same image has to run
// against a Postgres container on my laptop, against Compose in B2, and against
// whatever database the ECS task definition points at in C2 - so nothing here is
// allowed to be baked in.
//
// DB_PASSWORD deliberately has no default. A password checked into the repo is an
// instant zero for the whole scenario, and a missing one should fail loudly at
// startup rather than silently fall back to something guessable.
if (!process.env.DB_PASSWORD) {
  console.error('DB_PASSWORD is not set. Refusing to start.');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'notes',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'notesdb',
  max: Number(process.env.DB_POOL_MAX || 10),
});

pool.on('error', (err) => {
  console.error('idle postgres client error', err.message);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
