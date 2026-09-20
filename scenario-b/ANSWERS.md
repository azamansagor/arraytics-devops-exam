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

### Task 22 — Make it smaller

Both measured with `docker image inspect --format '{{.Size}}'`, so the comparison is
like for like:

| Image | Size | `docker images` disk usage |
| --- | --- | --- |
| `notes-api-zaman:naive` | **394 MB** | 1.67 GB |
| `notes-api-zaman:multi` | **58 MB** | 245 MB |
| Reduction | **85%** | |

Well past the 60% the task asks for. The two columns differ because `docker images` now
reports extracted disk usage while `inspect .Size` reports the image content — a
distinction that also came up in C2 Task 49, where ECR reported 61.6 MB against Docker's
245 MB. Mixing the two would make any size claim meaningless, which is why one measure is
used on both sides here.

#### What was removed

```
$ docker run --rm notes-api-zaman:naive whoami
root
$ docker run --rm notes-api-zaman:naive sh -c 'which gcc make python3 git perl'
/usr/bin/gcc
/usr/bin/make
/usr/bin/python3
/usr/bin/git
/usr/bin/perl

$ docker run --rm notes-api-zaman:multi sh -c 'which gcc make python3 git perl || echo ...'
none present
```

The saving is almost entirely the base image. `node:22` is Debian with a full toolchain —
a C compiler, make, python3, git, perl, man pages, a package manager — none of which a
running Node process uses. `node:22-alpine` is musl libc, busybox and Node. The build
stage is also discarded: npm's cache and metadata stay behind in the stage that is thrown
away, and only the resolved `node_modules` tree is copied forward.

#### What was given up by removing it

Smaller is not free, and these are the actual costs:

| Lost | Consequence |
| --- | --- |
| Shell tooling — `curl`, `git`, `ps`, `vim`, `dig` | Debugging a live container is much harder. `docker exec` gets you busybox and little else, so investigating a wedged process means adding tooling to an image you were trying to keep small |
| The C toolchain | Any dependency with a native addon will no longer build. Adding one means changing the base image, not just the lockfile |
| glibc, in favour of musl | Prebuilt native binaries compiled against glibc do not run. This bites specific packages rather than most of them, but it bites silently at runtime rather than at build time |
| root | Deliberate, and the point — but it does mean no `apk add` inside a running container during an incident |

The honest summary: the multi-stage image is better to ship and worse to debug. That is
usually the right trade, because debugging should happen against logs and metrics rather
than by shelling into production — which is what B3 exists to make possible.

### Task 23 — Layer caching

```
=== build 1 ===                          real  1m31.484s
=== build 2: one comment added to server.js ===
  CACHED [build 2/4] WORKDIR /app
  CACHED [build 3/4] COPY package.json package-lock.json ./
  CACHED [build 4/4] RUN npm ci --omit=dev
  CACHED [runtime 3/5] COPY --from=build ... /app/node_modules
  CACHED [runtime 4/5] COPY --chown=node:node package.json ./
        [runtime 5/5] COPY --chown=node:node db.js s3.js server.js ...
                                         real  0m26.977s
```

**91 seconds to 27 seconds**, and the rebuilt layers are exactly the ones that should be.

Docker caches a layer on the instruction plus the checksum of whatever it copies in.
Adding a comment to `server.js` changes the content of one `COPY`, so that layer and
every layer after it are rebuilt, and everything before it is reused.

This is why the Dockerfile copies `package.json` and `package-lock.json` on their own,
before the source:

```docker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY db.js s3.js server.js migrate.js seed.js schema.sql ./
```

The install layer is keyed only on the manifests, so editing application code leaves it
cached. `Dockerfile.naive` does the opposite with `COPY . .` before `npm install`, which
puts the source checksum ahead of the install — every one-character change re-downloads
every dependency. On a CI runner with a cold cache that is the difference between a
30-second build and a five-minute one, on every commit.

### Task 24 — The biggest layer

```
163MB   RUN addgroup -g 1000 node && adduser ... && apk add ... curl node-vX.tar.xz ... make install ...
 28MB   COPY --chown=node:node /app/node_modules ./node_modules
9.08MB  ADD alpine-minirootfs-3.24.2-x86_64.tar.gz
5.48MB  RUN apk add --virtual .build-deps-yarn ... yarn ...
```

**The biggest layer is 163 MB, and it is not one of mine.** It comes from the
`node:22-alpine` base image: the layer that creates the `node` user, fetches the Node
tarball, verifies its GPG signatures and installs the runtime. Of the ~245 MB on disk,
about 178 MB is the base image before this application contributes anything.

**Could it be smaller?** In principle, and not usefully:

- **A distroless or scratch base** would drop busybox and the package manager. But it has
  no shell, and the `HEALTHCHECK` depends on busybox `wget` — the healthcheck would have
  to be rewritten as a Node one-liner, and debugging would become impossible rather than
  merely awkward. A few tens of megabytes is not worth that.
- **Dropping yarn** would save 5.48 MB. It is in the base image and this project uses npm,
  so it is pure dead weight — but removing it means maintaining a custom base image, and
  now every Node security update is my problem instead of Docker's.
- **The 28 MB of `node_modules`** is the part I actually control, and most of it is
  `@aws-sdk/client-s3`. Bundling with esbuild would tree-shake it substantially. That is
  the one change with a real payoff, and it is a build-pipeline change rather than a
  Dockerfile one.

So the largest layer is also the least worth attacking: it is a dependency of the runtime
itself, maintained and patched by someone else, and shared with every other image built
from the same base — so on a host already running one `node:22-alpine` image it costs
nothing extra at all.

### Task 25 — No secrets in the image

This took three attempts, and the first two were wrong in instructive ways.

**Attempt 1 — checking the metadata.** Build history and baked-in environment:

```
=== build history ===        nothing
=== baked-in environment === ["PATH=...","NODE_VERSION=22.23.2","YARN_VERSION=1.22.22",
                              "NODE_ENV=production","PORT=3000"]
```

Clean, but this only proves nothing was passed as `ENV` or `ARG`. A file copied in would
not appear here at all.

**Attempt 2 — grepping the saved image, which proved nothing.** `docker save` produces a
tar whose layer blobs are **gzip-compressed**, so a plain `grep` over the extracted
archive cannot see file contents. It found nothing — and would have found nothing had the
image been full of passwords. A negative result from a test that cannot produce a positive
one is not evidence.

**Attempt 3 — decompress each layer, and validate the scanner against a known-bad image.**

```bash
scan_image() {   # decompress every layer blob, then grep its contents
  docker save "$1" | tar -x -C "$D"
  for b in $(find "$D" -type f); do
    tar -xzOf "$b" 2>/dev/null | grep -aq "$2" && echo "  FOUND in layer $(basename $b)"
  done
}
```

Built the trap from the brief — `COPY .env` then `RUN ... && rm /app/.env` — and ran the
scanner against it:

```
=== trap-demo ===
-- running container sees: --
total 8
drwxr-xr-x 1 root root 4096 .
drwxr-xr-x 1 root root 4096 ..          <- /app is empty
-- scanning its layers: --
  FOUND in layer 37b67c81745ca5fcbeb380613d464f767233698432714ae138e6a7c721f5ea7b
```

The file is gone from the container and present in the image. That is the answer to why
`rm` in a later layer does not help: **an image is a stack of layers, and a layer can only
add.** Deleting a file writes a whiteout marker in the upper layer, which the union
filesystem honours when assembling the container's view. The original layer is untouched,
still shipped, still pulled by anyone with access to the image, and `docker save` hands it
over in plain form. The only fixes are not to copy the secret in at all — multi-stage
builds, `--mount=type=secret`, or runtime injection — or to squash the layers, which loses
caching.

**Then the same scanner against this image**, which is the part that matters:

| Pattern | Result |
| --- | --- |
| `notes_local_dev` (the actual database password) | not found in any layer |
| `supersecret` | not found in any layer |
| `AWS_SECRET_ACCESS_KEY` | **found** |
| `AKIA` | **found** |
| `BEGIN PRIVATE KEY` | **found** |

Three hits, and all three are false positives. Rather than assert that, here is where they
live:

```
=== which files contain AKIA? ===
/app/node_modules/@aws-sdk/nested-clients/dist-types/submodules/sts/commands/AssumeRoleWithWebIdentityCommand.d.ts
/app/node_modules/@aws-sdk/nested-clients/dist-types/submodules/sts/commands/AssumeRoleCommand.d.ts
/usr/local/lib/node_modules/corepack/dist/lib/corepack.cjs
/usr/local/bin/node
--- and what does the match look like? ---
AKIA   AKIA0   AKIA06AAA   AKIA0GB   AKIA0Q

=== which files contain BEGIN PRIVATE KEY? ===
/usr/local/lib/node_modules/npm/man/man7/config.7
/usr/local/lib/node_modules/npm/node_modules/@npmcli/config/lib/definitions/definitions.js
/usr/local/lib/node_modules/npm/docs/content/using-npm/config.md
/usr/local/lib/node_modules/npm/docs/output/using-npm/config.html

=== and the things that would actually matter ===
  no .env in the image
  no .aws credentials directory
```

`AWS_SECRET_ACCESS_KEY` is the **name** of a variable the AWS SDK reads, written in its
own source. The `AKIA` hits are TypeScript type documentation and coincidental byte
sequences in the `node` binary — and none of the matched strings is a 20-character key
ID. `BEGIN PRIVATE KEY` is npm's own documentation for its `key` and `cafile` options.

The general lesson, and the reason this is worth writing down: **scanning an image for the
names of secrets is the wrong test.** Every SDK that reads a credential contains the name
of that credential, so the search is guaranteed to produce hits in any image with
dependencies, and a reviewer who stops at "found" reaches the wrong conclusion. The useful
searches are for secret **values**, for credential **shapes** (`AKIA` followed by sixteen
uppercase characters, a PEM block with a body), and for the **paths** where credentials
conventionally live — `.env`, `.aws/credentials`, `id_rsa`. Those are what were checked,
and none of them is present.

### Evidence

| File | Shows |
| --- | --- |
| `b1-task22-size-comparison.png` | 394 MB against 58 MB, 85% saved, and the toolchain present in one image and absent from the other |
| `b1-task23-layer-caching.png` | `1m31.484s` then `0m26.977s`, with `npm ci` CACHED and only the source `COPY` rebuilt |
| `b1-task24-biggest-layer.png` | `docker history` with the 163 MB base-image Node install as the largest layer |
| `b1-task25-no-secrets.png` | the trap image: `/app` empty in the container, the password found in a layer; and this image clean of the real password |
| `b1-task25-deleted-but-still-there.png` | the trap being built and the deleted file still recoverable |
| `b1-task25-false-positive.png` | exactly which files the three hits came from, and the absence of `.env` and `.aws/` |

---

## B5 — CI/CD with GitHub Actions

Two workflows, both with the exam token in a comment at the top:

| File | Does | Status |
| --- | --- | --- |
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | builds and publishes to GHCR on push to `main` | active |
| [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | built, pushed to ECR and rolled the ECS service | reduced to `workflow_dispatch` after C5 deleted its targets |

### Task 43 — The main branch pipeline

`release.yml` runs on push to `main`, builds once, and publishes three tags:

```
ghcr.io/azamansagor/notes-api-zaman:<git sha>
ghcr.io/azamansagor/notes-api-zaman:v1.1.<run number>
ghcr.io/azamansagor/notes-api-zaman:latest
```

The SHA tag is the operational one. A running container can always be traced back to
exactly one commit, which is what makes an incident answerable. The version tag is for
people reading a changelog. `latest` is a convenience pointer and is deliberately **not**
what the Swarm stack in B4 pins to — a service that follows `latest` cannot tell you what
it is running, and has nothing specific to roll back to.

#### No long-lived credentials, in either pipeline

There is no `AWS_SECRET_ACCESS_KEY` and no static access key anywhere in this repository
or its secrets. Both pipelines authenticate without one, by different mechanisms:

| Pipeline | Registry | How it authenticates |
| --- | --- | --- |
| `release.yml` | GHCR | `GITHUB_TOKEN`, minted per run, scoped by the job's `permissions:` block to `contents: read` and `packages: write`, revoked when the job ends |
| `deploy.yml` | ECR + ECS | GitHub OIDC — the job presents a signed identity token and AWS returns temporary credentials, with the trust policy restricting which repository and ref may ask |

`GITHUB_TOKEN` is not a secret anyone stored. GitHub issues it for one run and invalidates
it afterwards, so there is nothing to leak from the repository settings and nothing to
replay tomorrow. The permissions block matters as much as the token: without it the
default grant is much broader than `packages: write`.

The brief says OIDC in Scenario C earns credit if it also works here. It does — `deploy.yml`
used it for AWS, and the run that deployed `notes-api-zaman:3` printed
`assumed-role/github-actions-deployer-zaman` as its identity. The write-up is in
[`../scenario-c/ANSWERS.md`](../scenario-c/ANSWERS.md), Task 53, including the OIDC subject
claim that cost the most time to get right.

#### Multi-arch

Skipped. `platforms: linux/amd64,linux/arm64` doubles build time and this image only ever
runs on one x86_64 VPS and on Fargate's `X86_64` runtime platform, both of which are
declared explicitly.

It would matter the moment any of these is true: a developer on an Apple Silicon Mac wants
to run the same image locally, deployment moves to Graviton instances for the ~20% price
advantage, or the image ships to anyone whose architecture I do not control. All three are
"pay later" situations rather than "never", which is why the Dockerfile declares
`runtimePlatform` rather than leaving the architecture implicit — the assumption is written
down where it will be found.

### Task 42 — Caching

Configured twice, measured each time, and the result is not the one the brief expects.

| Backend | Cold | Warm | Cache hits |
| --- | --- | --- | --- |
| `type=gha` | **7s** | **14s** | none |
| `type=registry` on GHCR | — | **13s** | 4 layers, including `npm ci` |

*(times are the `Build and push` step, not the whole run, so runner setup and checkout do
not blur the comparison)*

**`type=gha` restored nothing.** Searching the warm run's build log for `CACHED` returned
no results, while the export still ran — so the build went from 7s to 14s and got nothing
back. Caching that silently restores nothing is worse than no caching, because you stop
looking for the problem.

**Registry cache works.** It writes to GHCR as a `buildcache` tag beside the image, so
whether a cache exists is visible in the Packages tab rather than assumed. The warm run
reports:

```
#11 importing cache manifest from ghcr.io/azamansagor/notes-api-zaman:buildcache
#11 inferred cache manifest type: application/vnd.oci.image.manifest.v1+json done
#12 [build 2/4] WORKDIR /app                                        CACHED
#13 [build 3/4] COPY package.json package-lock.json ./              CACHED
#14 [build 4/4] RUN npm ci --omit=dev                               CACHED
#15 [runtime 3/5] COPY --from=build ... /app/node_modules           CACHED
```

`mode=max` rather than `mode=min` because this is a multi-stage build: `mode=min` exports
only the final stage, which would drop the `npm ci` layer — the one layer actually worth
caching.

One misreading on the way: the first run after switching also showed no hits, which looked
like another failure. It was not. Registry cache needs one run to write before any run can
read, and that run was the writer.

#### The improvement, stated honestly

**There is no improvement.** 7s without a working cache against 13s with one.

The brief's premise is that the first run is slow because it downloads all dependencies.
That premise does not hold here: `npm ci` installs four packages and takes a few seconds,
while the cache carries the whole layer graph including the ~180 MB base image. Transport
costs more than the work it replaces.

Caching pays when the cached work is expensive relative to moving the cache — a large
dependency tree, native modules that compile, a multi-minute install. This project has
none of those, and the honest result of measuring is that this optimisation is currently
a pessimisation.

The configuration stays, for one reason: the arithmetic reverses the moment a dependency
with a native build step is added, and by then nobody will be measuring. What changed is
that the assumption is now a number.

**What to take from it:** verify a cache, do not configure it and assume. Two cheap checks
— `CACHED` in the build log, and the cache artifact in the registry.

### Task 46 — One safeguard

Two, both in `release.yml` and `deploy.yml`, each commented in place with what it prevents.

**Concurrency group.**

```yaml
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

The incident it prevents: two commits land on `main` within a minute of each other. Both
runs start, both build, both push, and both move the `latest` tag. Whichever finishes last
wins — **and that is not necessarily the newer commit**, because the older one may have a
warmer cache and finish first. `latest` silently points at the earlier code while both
runs show green, and the first sign of trouble is a bug reappearing in production that was
fixed hours ago. The concurrency group serialises them, so ordering is the ordering of the
commits.

`cancel-in-progress` is left `false` deliberately. Cancelling a publish halfway can leave a
manifest referencing layers that were never fully pushed; a slow queue is better than a
corrupt tag.

**Job timeout.** `timeout-minutes: 20` on `release.yml`, `30` on `deploy.yml`, the latter
larger because `wait-for-service-stability` legitimately takes minutes while ECS seeds new
tasks.

Without it, a wedged step runs until GitHub's six-hour default. On its own that is only
wasted minutes — but combined with the concurrency group it is an outage of the pipeline
itself: the hung run holds the lock, and every subsequent deploy queues behind it for six
hours. The two safeguards interact, which is why both have a bound.

### Evidence

| File | Shows |
| --- | --- |
| `b5-task43-ghcr-packages.png` | the public package with `latest`, `v1.1.2`, `v1.1.1` and SHA tags |
| `b5-task43-no-static-credentials.png` | the GHCR login step using `GITHUB_TOKEN` under `packages: write` |
| `b5-task42-cache-cold-vs-warm.png` | the run list with durations |
| `b5-task42-cache-hits.png` | `Build and push` at 13s with the registry cache imported and four layers CACHED |

### Not attempted

Tasks 41, 44 and 45 are in [`../INCOMPLETE.md`](../INCOMPLETE.md).
