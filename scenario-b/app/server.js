const os = require('os');
const express = require('express');
const { pool, query } = require('./db');
const s3 = require('./s3');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);

// Which container answered. Task 51 puts several tasks behind an ALB and asks for
// proof that requests really are spread across them, so every response carries the
// hostname - inside a container that is the container id.
const INSTANCE = process.env.HOSTNAME || os.hostname();
app.use((req, res, next) => {
  res.set('X-Served-By', INSTANCE);
  next();
});

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------
// One database, several customers. The tenant arrives as a header and every query
// below filters on the id it resolves to. The slug never reaches SQL as text - it
// is looked up once and only the integer id is used afterwards.

const tenantCache = new Map();

async function resolveTenant(req, res, next) {
  // /healthz, /readyz and /metrics are infrastructure endpoints. A load balancer
  // health check does not know or care about tenants.
  if (req.path === '/healthz' || req.path === '/readyz' || req.path === '/metrics') {
    return next();
  }

  const slug = req.get('X-Tenant');
  if (!slug) {
    return res.status(400).json({ error: 'X-Tenant header is required' });
  }

  try {
    if (!tenantCache.has(slug)) {
      const { rows } = await query('SELECT id FROM tenants WHERE slug = $1', [slug]);
      if (rows.length === 0) {
        return res.status(404).json({ error: `unknown tenant '${slug}'` });
      }
      tenantCache.set(slug, rows[0].id);
    }
    req.tenantId = tenantCache.get(slug);
    req.tenantSlug = slug;
    next();
  } catch (err) {
    next(err);
  }
}

app.use(resolveTenant);

// ---------------------------------------------------------------------------
// Health endpoints
// ---------------------------------------------------------------------------

// Liveness: is the process up. Nothing else. If this touched the database, a
// database blip would make ECS kill and restart perfectly healthy containers.
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', instance: INSTANCE, uptime: process.uptime() });
});

// Readiness: can this instance actually serve traffic, which means the database
// has to answer. This is the one the load balancer target group should use.
app.get('/readyz', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ready', instance: INSTANCE });
  } catch (err) {
    res.status(503).json({ status: 'not ready', instance: INSTANCE, error: err.message });
  }
});

// Built in B3.
app.get('/metrics', (req, res) => {
  res.status(501).type('text/plain').send('# metrics are added in B3\n');
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

app.post('/api/notes', async (req, res, next) => {
  const { title, body, tags } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO notes (tenant_id, title, body) VALUES ($1, $2, $3) RETURNING *',
      [req.tenantId, title, body]
    );
    const note = rows[0];

    if (Array.isArray(tags) && tags.length > 0) {
      await client.query(
        'INSERT INTO tags (note_id, name) SELECT $1, unnest($2::text[])',
        [note.id, tags]
      );
      note.tags = tags;
    } else {
      note.tags = [];
    }

    await client.query('COMMIT');
    res.status(201).json(note);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/notes - DELIBERATELY BAD, two problems live here on purpose.
//
// Problem 1, the N+1 query: one query fetches the page of notes, then the loop
// below issues one more query per note to fetch its tags. With limit=20 that is
// 21 round trips where 2 would do. The correct version is a JOIN, or a single
// WHERE note_id = ANY($1). Not fixed until B3 asks for it.
//
// Problem 4, the unbounded limit: whatever ?limit= says is passed straight to
// SQL, so ?limit=50000 returns fifty thousand rows and then runs fifty thousand
// tag queries on top. There is no cap here on purpose.
app.get('/api/notes', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Number(req.query.limit) || 20;   // no clamp - problem 4
    const offset = (page - 1) * limit;

    const notes = await query(
      'SELECT * FROM notes WHERE tenant_id = $1 ORDER BY id LIMIT $2 OFFSET $3',
      [req.tenantId, limit, offset]
    );                                              // 1 query

    for (const note of notes.rows) {                // then N more queries
      const tags = await query('SELECT name FROM tags WHERE note_id = $1', [note.id]);
      note.tags = tags.rows.map((t) => t.name);
    }

    res.json({ page, limit, count: notes.rows.length, notes: notes.rows });
  } catch (err) {
    next(err);
  }
});

app.get('/api/notes/:id', async (req, res, next) => {
  try {
    // tenant_id is in the WHERE clause, not checked afterwards in JavaScript.
    // Asking for another tenant's note id returns 404, not that tenant's note.
    const { rows } = await query(
      'SELECT * FROM notes WHERE id = $1 AND tenant_id = $2',
      [req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'note not found' });

    const note = rows[0];
    const tags = await query('SELECT name FROM tags WHERE note_id = $1', [note.id]);
    note.tags = tags.rows.map((t) => t.name);
    res.json(note);
  } catch (err) {
    next(err);
  }
});

// GET /api/search - DELIBERATELY BAD.
//
// Problem 2, the unindexed search: a LIKE with a leading wildcard cannot use a
// btree index, so Postgres reads every row for this tenant on every request.
// This is the endpoint the C2 load test points at precisely because it burns CPU.
// The fix would be a trigram (pg_trgm) or full-text index. Not yet.
app.get('/api/search', async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'q is required' });

    const { rows } = await query(
      `SELECT id, title, body, created_at FROM notes
       WHERE tenant_id = $1 AND body LIKE '%' || $2 || '%'
       ORDER BY id LIMIT 50`,
      [req.tenantId, q]
    );
    res.json({ q, count: rows.length, results: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats - joins all three tables.
//
// Slow by design: counting tags means joining tags on note_id, and there is no
// index on tags.note_id (problem 3), so this is a sequential scan of 150,000 rows.
//
// Scoped to the calling tenant rather than reporting every tenant at once. The
// brief's hard rule is that every query filters by tenant, and an endpoint that
// hands one customer the row counts of every other customer is a tenant isolation
// leak, however convenient it would be for a dashboard.
app.get('/api/stats', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.slug,
              count(DISTINCT n.id) AS notes,
              count(g.id)          AS tags
       FROM tenants t
       LEFT JOIN notes n ON n.tenant_id = t.id
       LEFT JOIN tags  g ON g.note_id   = n.id
       WHERE t.id = $1
       GROUP BY t.slug`,
      [req.tenantId]
    );
    res.json(rows[0] || { slug: req.tenantSlug, notes: 0, tags: 0 });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Attachments (S3)
// ---------------------------------------------------------------------------
//
// The API never proxies file bytes. It signs a URL and the client talks to S3
// directly, so a 2 GB upload does not occupy a node process or a database
// connection for its duration. The bucket stays private: nothing here grants
// standing access, only a URL that expires.

// POST /api/attachments/upload-url  { filename, contentType, visibility? }
app.post('/api/attachments/upload-url', async (req, res, next) => {
  try {
    const { filename, contentType, visibility } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename is required' });

    // The client proposes a filename; the server decides the key. A client that
    // chose its own key could write into another tenant's prefix, and every
    // isolation check downstream reads that prefix.
    const key = s3.buildKey(req.tenantSlug, filename, visibility);
    const uploadUrl = await s3.presignUpload(key, contentType);

    res.status(201).json({
      key,
      uploadUrl,
      expiresIn: s3.UPLOAD_EXPIRY_SECONDS,
      method: 'PUT',
      visibility: visibility === 'public' ? 'public' : 'private',
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/attachments/<key>/download-url
//
// The key contains slashes, so the wildcard captures everything between the
// prefix and the suffix. ?key= is accepted too, for callers that would rather
// not escape a path.
app.get(['/api/attachments/*/download-url', '/api/attachments/download-url'], async (req, res, next) => {
  try {
    const key = req.params[0] || req.query.key;
    if (!key) return res.status(400).json({ error: 'key is required' });

    // Task 58. The check is here, before anything is signed, because a presigned
    // URL carries the signer's authority: once issued, S3 will honour it without
    // any further reference to who asked. There is no second chance to say no.
    if (!s3.ownsKey(req.tenantSlug, key)) {
      return res.status(403).json({
        error: 'forbidden',
        detail: `tenant '${req.tenantSlug}' may not access '${key}'`,
      });
    }

    const downloadUrl = await s3.presignDownload(key);
    res.json({ key, downloadUrl, expiresIn: s3.DOWNLOAD_EXPIRY_SECONDS });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------

app.use((req, res) => res.status(404).json({ error: 'not found' }));

app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err.message);
  res.status(500).json({ error: 'internal error' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`notes-api listening on ${PORT} as ${INSTANCE}`);
});

// ECS sends SIGTERM and then waits before SIGKILL. Closing the listener first lets
// in-flight requests finish, which is what makes the rolling update in B4 and C2
// actually zero-downtime instead of merely looking like it.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
// touched 2026-09-20T14:34:22Z to measure warm cache
