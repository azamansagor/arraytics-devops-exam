-- Schema for the multi-tenant Notes API.
--
-- Multi-tenant here means one database shared by several customers, so every
-- row that belongs to a customer carries tenant_id and every query filters on it.

DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS tenants;

CREATE TABLE tenants (
  id   SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL          -- e.g. 'acme', 'globex'
);

CREATE TABLE notes (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE tags (
  id      SERIAL PRIMARY KEY,
  note_id INT NOT NULL REFERENCES notes(id),
  name    TEXT NOT NULL
);

-- Indexes, and the ones deliberately left out.
--
-- notes.tenant_id is indexed: every endpoint filters by tenant, and without it
-- even a correct query scans the whole table.
CREATE INDEX idx_notes_tenant_id ON notes(tenant_id);

-- NOT created, on purpose (deliberate problem 3 in the exam brief):
--   CREATE INDEX idx_tags_note_id ON tags(note_id);
-- Postgres does not index the referencing side of a foreign key automatically,
-- so every tag lookup by note_id is a sequential scan. This is what makes
-- /api/stats and the N+1 loop in /api/notes slow enough to show up in B3.
--
-- Also NOT created (deliberate problem 2): any index that would help
--   WHERE body LIKE '%word%'
-- A leading wildcard cannot use a normal btree index anyway; the fix would be a
-- trigram or full-text index, and adding one is out of scope until B3.
