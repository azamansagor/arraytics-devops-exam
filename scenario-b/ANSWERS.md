# SCENARIO B — Answers

> Exam token: `root-vmi3536696-1788597274-30dab396`

> Names follow the shared-server convention in the root README: the image is
> `notes-api-zaman`, containers are suffixed `-zaman`, and published ports avoid the
> ones already taken on this VPS.

---

## The application

`scenario-b/app/` is a multi-tenant Notes API — Express and node-postgres, Postgres
behind it. Express because the N+1 example in the brief is written in it, so the planted
problem transfers as written instead of being translated into another stack.

Tenancy is enforced in SQL, not in JavaScript. The `X-Tenant` header resolves to an
integer id once, and every statement carries `WHERE tenant_id = $n`. Asking for another
tenant's note by id returns 404 rather than that tenant's note, because the tenant is in
the `WHERE` clause and not checked afterwards in application code.

`seed.js` creates 5 tenants, 50,000 notes and 150,000 tags using `generate_series` inside
Postgres rather than looping inserts from Node — fifty thousand round trips would take
minutes, one set-based statement takes seconds. acme gets 30,000 of the notes so tenant
skew is visible in `/api/stats` later. Bodies are built from real words, including `abc`,
because the C2 load test searches for exactly that and a query matching nothing would
still scan every row but would not be a realistic search.

No credentials anywhere in the repo. `DB_PASSWORD` has no default at all and the process
refuses to start without it.

### The four deliberate problems, and where they live

| # | Problem | Where |
| --- | --- | --- |
| 1 | N+1 query — one query for the page, then one per note for its tags | `server.js`, `GET /api/notes` |
| 2 | Unindexed search — `LIKE '%' \|\| $2 \|\| '%'`, leading wildcard | `server.js`, `GET /api/search` |
| 3 | No index on `tags.note_id` | `schema.sql`, named in a comment as omitted on purpose |
| 4 | Unbounded `?limit=` passed straight to SQL | `server.js`, `GET /api/notes` |

Each is commented in place with why it is there, so it reads as a decision rather than an
oversight. Problem 3 is the one that would otherwise look like ignorance: Postgres does
not index the referencing side of a foreign key automatically, so every tag lookup by
`note_id` is a sequential scan.

Measured locally before containerising, against the seeded database:

| Request | Time |
| --- | --- |
| `GET /api/notes?limit=5` | 0.55 s |
| `GET /api/notes?limit=200` | 0.95 s |
| `GET /api/search?q=abc` | 0.20 s |
| `GET /api/stats` | 0.25 s |

Worth being honest about the first two: 40x the queries cost well under 2x the time,
because Postgres was on the same machine and a round trip was essentially free. The N+1
is real but nearly invisible at zero network latency — which is exactly why it has to be
measured again once the database is across a network. That is the B3 story.

---

## B1 — Build the Docker image

### Task 21 — Multi-stage Dockerfile

Dockerfile: [`docker/Dockerfile`](docker/Dockerfile). Built from the repo root with the
app folder as context:

```bash
docker build -f scenario-b/docker/Dockerfile -t notes-api-zaman:multi scenario-b/app
```

**Two stages.** The build stage runs `npm ci --omit=dev` and keeps whatever npm writes
while working — its cache, its metadata, the lockfile bookkeeping. The runtime stage
starts again from a clean `node:22-alpine` and receives only the resolved `node_modules`
tree and the source files. No package manager ever runs in the image that ships.

`npm ci` rather than `npm install`: it installs exactly what the lockfile pins and fails
if the two disagree, instead of quietly resolving something newer at build time.

**No build tools.** `node:22-alpine` has no C toolchain to begin with, and nothing is
installed on top of it:

```
$ docker run --rm notes-api-zaman:multi sh -c 'which gcc make python3 g++ || echo ...'
no build tools in final image
```

**Non-root.** The alpine base already ships an unprivileged `node` user at uid 1000, so
there is no `useradd` layer. Files are chowned during `COPY --chown=node:node` rather
than by a `chown -R` afterwards, which would duplicate the whole tree into a second
layer.

```
$ docker run --rm notes-api-zaman:multi whoami
node
$ docker run --rm notes-api-zaman:multi id
uid=1000(node) gid=1000(node) groups=1000(node),1000(node)
```

**Healthcheck.**

```docker
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:${PORT}/healthz" || exit 1
```

`wget` comes from busybox in the alpine base, so nothing has to be installed to make the
check work — adding `curl` would mean a package manager in the final image.

It polls `/healthz`, which deliberately does not touch the database. A check that queried
Postgres would report unhealthy during a database blip and have Docker, or later ECS,
restart a container that was working perfectly. Liveness answers "is this process
alive"; `/readyz` is the one that queries the database and is what a load balancer target
group should poll.

Proof it actually runs, rather than merely being declared:

```
$ docker ps --filter name=hc-zaman
STATUS: Up 11 minutes (healthy)

$ docker inspect --format='{{json .State.Health}}' hc-zaman | python3 -m json.tool
"Status": "healthy", "FailingStreak": 0,
"Log": [ { "ExitCode": 0,
           "Output": "{\"status\":\"ok\",\"instance\":\"78b776f66208\",\"uptime\":596.8}" }, ... ]
```

Five successive checks, every one `ExitCode: 0`, each carrying the real JSON body. The
`instance` field is the container id, which is also what Task 51 relies on to prove
requests are being spread across tasks.

One thing that trips this up: the container needs `-e DB_PASSWORD=...` even for this
test. `db.js` refuses to start without it, so without the variable the container exits
immediately and never reaches a health state. It does not need a reachable database —
`/healthz` never queries one — it only needs the variable to exist.

**CMD is exec form**, `CMD ["node", "server.js"]`, so node is PID 1 and receives SIGTERM
directly. In shell form `/bin/sh` would be PID 1, the signal would stop there, and the
graceful shutdown in `server.js` would never run — which is what quietly breaks
zero-downtime rolling updates later.

#### Evidence

| File | Shows |
| --- | --- |
| `b1-task21-nonroot.png` | token + date, `whoami` → `node`, `id` → uid 1000, no build tools |
| `b1-task21-healthcheck.png` | token + date, `docker ps` showing `(healthy)`, and the health log with five `ExitCode: 0` entries |
