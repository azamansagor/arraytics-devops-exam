# Not Finished / Partially Done

> Exam token: `root-vmi3536696-1788597274-30dab396`

A task failed but correctly diagnosed earns up to 60%. A task skipped silently earns 0.
So everything unfinished is here, including the parts that are finished but whose result
is not the one the brief expects.

## What is complete

| Section | Marks | Status |
| --- | --- | --- |
| A1 access model | 20 | done |
| A2 port investigation | 12 | done |
| B1 image build | 18 | done |
| B4 Swarm | 26 | done |
| B5 tasks 42, 43, 46 | 12 | done |
| C1 IAM | 8 | done |
| C2 ECS deployment | 36 | done |
| C3 S3 | 20 | done |
| C5 cleanup | 4 | done |

---

## Done, but the result is not what the brief predicts

These are finished and written up. They are listed here because reading the answer
quickly could look like a failure, and the difference is worth naming.

| Task | What the brief expects | What actually happened | Why |
| --- | --- | --- | --- |
| **B5 Task 42** — caching | "Your first run is slow because it downloads dependencies. Cache them. State the improvement." | There is **no improvement**. 7s without a working cache, 13s with one. | The premise does not hold at this size. `npm ci` installs four packages in seconds; the cache moves the whole layer graph including a 180 MB base image. Transport costs more than the work it replaces. Measured, reported, configuration kept — because that reverses the moment a native dependency appears. |
| **B4 Task 35** — nodes | "Multi-node scores better" | **Single node.** | One VPS, and it is shared with six other candidates. No second machine was available. |
| **B4 Task 38** — rollback | Tasks in `Failed` or `Rejected` state | Task showed **`Complete`** | The SIGTERM handler added for Task 37 catches the stop signal and exits 0, so Swarm records a normal completion. The rollback fired anyway, because the update monitor judges health within its window, not exit codes. |
| **B4 Tasks 36–40** — measurement path | Requests to the published port | Requests through the **service VIP** from inside the overlay network | The ingress routing mesh does not deliver on this host: `ss` shows dockerd listening with connections stacking in the accept queue while every replica is `(healthy)` and answers from inside its own container. Swarm has two load balancers and only one failed. Not fixable from inside my own stack on a shared host. |
| **B5 Task 43** — multi-arch | Optional, explain if skipped | **Skipped** | One x86_64 VPS and Fargate's `X86_64` platform, both declared explicitly. Would matter for Apple Silicon development, a move to Graviton, or shipping to hardware I do not control — reasoning written up in `scenario-b/ANSWERS.md`. |
| **C5 Task 63** — cleanup | Nothing left running | One **EC2 instance remains** | It is not mine. Tagged `ashik-admin-pw`, launched sixteen hours before I had an IAM user in this shared account, and a `c7i.2xlarge` in a scenario that used Fargate exclusively. Deleting another person's running instance is not recoverable and being told to clean up my own resources is not authorisation to remove theirs. Evidence and billing submitted together. |

---

## Not attempted

Ran out of time. Nothing below was started, so there is no partial work to claim — these
are listed so the gap is explicit rather than left for the marker to discover.

| Task | Marks | What it needed | What I would do first with more time |
| --- | --- | --- | --- |
| **A3** — `healthcheck.sh`, cron | 12 | A bash script reading a config file, colour output, exit codes 0/1/2, a lock against concurrent runs, and a crontab entry | This is the cheapest remaining block and needs nothing but the VPS. The lock is the part worth care: a `flock` on a lockfile rather than a PID file, since a PID file left by a killed process blocks every later run forever |
| **A4** — systemd | 22 | A small app with `/crash`, `/hang`, `/slow`, a unit with a restart limit and ordering, journalctl queries, and a watchdog timer for the hung-but-alive case | Write the small app first — A5 needs the same one running twice on different ports, so the two blocks share it. The watchdog is the interesting half: `Restart=on-failure` cannot see a process that is alive and not answering |
| **A5** — nginx | 16 | Reverse proxy with real client IP, load balancing across two backends, passive failover timing, a 504 and its fix, rate limiting | Depends on A4's app. The `/slow` and 504 question is the one I would want to answer properly — raising `proxy_read_timeout` is the reflex and the wrong fix, because it converts a fast failure into held worker connections |
| **B2** — Compose, volumes, debugging | 18 | A four-service compose file, proof that `depends_on` alone is insufficient, volume persistence and recovery, and four self-inflicted faults diagnosed | The four drills are each self-contained and would come first — exit 137 and OOM, DNS across networks, a bind mount hiding an image directory, and binding to `127.0.0.1` inside a container. All four have already appeared in this submission in other forms |
| **B3** — Prometheus and Grafana | 32 | Six instrumented metrics, Prometheus scraping, five minutes of shaped load, nine dashboard panels, a firing alert, and one planted problem fixed with before/after proof | The largest remaining block and the one I most regret not reaching, because the four planted problems were built for it. The N+1 detector panel — `db_queries_per_request` showing 21 for `/api/notes` against 1–2 elsewhere — is the panel the whole application was shaped around |
| **B5 Task 41** — PR pipeline | 6 | `pr.yml` with three real tests, a Docker build, and curling `/healthz` against the built image; one failing run and one passing | The tests do not exist yet, which is the honest blocker. `/healthz` returning 200 is the given example and three tests is a low bar, but writing tests I have not written is not something to fake |
| **B5 Tasks 44, 45** | 12 | Deploy to the VPS Swarm behind a GitHub environment approval gate, then break the pipeline three ways and prove production survived | The Swarm stack and the GHCR image both exist, so this is the closest of the unattempted blocks. The trust policy already allows `repo:...:environment:*` precisely so a gated job can assume the AWS role |
| **C4** — multi-tenancy by subdomain | 26 | Wildcard DNS, Host-based routing to one app instance, automatic tenant provisioning, a custom domain, and four isolation questions | Planned to run on the VPS with nginx and `nip.io` for wildcard DNS — real public resolution, no domain purchase, and none of the 3 marks lost for simulating with `/etc/hosts`. The header-spoofing question in Task 62 is a genuine hole in the current app: `X-Tenant` is client-supplied and nginx would have to overwrite it |

---

## One thing I would change about how I worked

Scenario C was done first and took the longest, largely because AWS console defaults and
an unverified account produced failures that looked like configuration errors. Scenario A
and the Docker half of B moved several times faster per mark, because everything was on
one machine and every result was immediate.

With the time again I would have done A2, A3, B1 and B2 first — roughly 60 marks of
fast, self-contained work — and reached AWS with the application already containerised
and understood.
