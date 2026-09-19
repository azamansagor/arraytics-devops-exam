// Seeder for the Notes API.
//
// The exam asks for real data volume: 5 tenants, 50,000 notes spread unevenly,
// 150,000 tags. Volume is the whole point - the deliberate N+1 query and the
// unindexed search only become visible on the dashboards in B3 once there are
// enough rows for them to hurt.
//
// Everything is generated inside Postgres with generate_series rather than looped
// from Node. Fifty thousand single INSERTs over the network would take minutes and
// 150,000 more would take longer; as set-based statements it is a few seconds.
//
//   DB_PASSWORD=... DB_PORT=5433 npm run seed

const { pool, query } = require('./db');

// Bodies are built from real words so that /api/search has something to match.
// 'abc' is in the list on purpose: the load test in C2 hammers /api/search?q=abc,
// and a query that matches nothing would still scan every row but would not look
// like a realistic search.
const WORDS = [
  'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
  'invoice', 'meeting', 'deadline', 'roadmap', 'budget', 'release', 'incident',
  'postgres', 'docker', 'deploy', 'rollback', 'latency', 'abc',
];

const TAG_NAMES = [
  'urgent', 'draft', 'review', 'archived', 'personal', 'work', 'idea',
  'bug', 'feature', 'followup',
];

// Uneven on purpose - acme gets 30,000 and the rest share the remaining 20,000.
// An even split would hide tenant-level differences in the /api/stats endpoint
// and make the "one noisy tenant" story in C4 impossible to show.
const TENANTS = [
  { slug: 'acme', notes: 30000 },
  { slug: 'globex', notes: 8000 },
  { slug: 'initech', notes: 6000 },
  { slug: 'umbrella', notes: 4000 },
  { slug: 'hooli', notes: 2000 },
];

const TOTAL_TAGS = 150000;
const TAG_BATCH = 25000;

async function main() {
  const startedAt = Date.now();

  // Re-runnable: wipe first, and reset the sequences so ids start at 1 again.
  console.log('truncating...');
  await query('TRUNCATE tags, notes, tenants RESTART IDENTITY CASCADE');

  console.log('inserting tenants...');
  for (const t of TENANTS) {
    await query('INSERT INTO tenants (slug) VALUES ($1)', [t.slug]);
  }

  for (const t of TENANTS) {
    const { rows } = await query('SELECT id FROM tenants WHERE slug = $1', [t.slug]);
    const tenantId = rows[0].id;

    process.stdout.write(`inserting ${t.notes} notes for ${t.slug}... `);
    await query(
      `WITH w AS (SELECT $3::text[] AS arr)
       INSERT INTO notes (tenant_id, title, body)
       SELECT $1::int,
              'Note ' || g,
              w.arr[1 + floor(random() * array_length(w.arr, 1))::int] || ' ' ||
              w.arr[1 + floor(random() * array_length(w.arr, 1))::int] || ' ' ||
              md5(random()::text) || ' ' ||
              w.arr[1 + floor(random() * array_length(w.arr, 1))::int] || ' ' ||
              w.arr[1 + floor(random() * array_length(w.arr, 1))::int]
       FROM generate_series(1, $2::int) g, w`,
      [tenantId, t.notes, WORDS]
    );
    console.log('done');
  }

  // Tags are attached to random notes, so some notes get many and some get none.
  // That spread is what makes the N+1 loop in GET /api/notes behave unevenly.
  const { rows: bounds } = await query('SELECT min(id) AS lo, max(id) AS hi FROM notes');
  const { lo, hi } = bounds[0];

  let inserted = 0;
  while (inserted < TOTAL_TAGS) {
    const n = Math.min(TAG_BATCH, TOTAL_TAGS - inserted);
    process.stdout.write(`inserting tags ${inserted + 1}-${inserted + n}... `);
    await query(
      `WITH t AS (SELECT $4::text[] AS arr)
       INSERT INTO tags (note_id, name)
       SELECT $2::int + floor(random() * ($3::int - $2::int + 1))::int,
              t.arr[1 + floor(random() * array_length(t.arr, 1))::int]
       FROM generate_series(1, $1::int) g, t`,
      [n, lo, hi, TAG_NAMES]
    );
    inserted += n;
    console.log('done');
  }

  // ANALYZE so the planner has fresh statistics. Without it Postgres may still
  // believe the tables are empty and pick plans that make the slow endpoints look
  // deceptively fast.
  console.log('analyzing...');
  await query('ANALYZE tenants, notes, tags');

  const counts = await query(
    `SELECT (SELECT count(*) FROM tenants) AS tenants,
            (SELECT count(*) FROM notes)   AS notes,
            (SELECT count(*) FROM tags)    AS tags`
  );
  console.table(counts.rows);

  const perTenant = await query(
    `SELECT t.slug, count(n.id) AS notes
     FROM tenants t LEFT JOIN notes n ON n.tenant_id = t.id
     GROUP BY t.slug ORDER BY notes DESC`
  );
  console.table(perTenant.rows);

  console.log(`seeded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('seed failed:', err.message);
  await pool.end();
  process.exit(1);
});
