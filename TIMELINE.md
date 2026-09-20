# Work Timeline

> Exam token: `root-vmi3536696-1788597274-30dab396`

Times are the exam VPS clock (CEST), which is what the screenshots show. I work from
Bangladesh, four hours ahead, so the overnight sessions below are daytime for me.

| Date / time | What I worked on | Where I got stuck | Outcome |
| --- | --- | --- | --- |
| **Sep 5** | Repo skeleton — README with the shared-server naming table, `.gitignore` covering secrets, the three scenario folders | Nothing yet. Decided early that every name gets a `zaman` suffix because the VPS is shared | Structure committed |
| **Sep 5** | **A1** — users, groups, ACL on `secrets/`, immutable backups, scoped sudoers | Port 3100 already taken by another candidate's node process. `EXAM_TOKEN` empty after `su -` because the export only existed in root's `.bashrc`, and the first fix used double quotes so the shell expanded an empty variable | A1 complete, 20 marks. Moved to 3110 |
| **Sep 19 17:00–18:10** | **C1** — IAM user, ARN-scoped policy, Policy Simulator | Planned `ap-southeast-1`; the account has 17 Regions disabled. Had to rewrite every ARN for `us-east-1`, because a policy `Resource` embeds the Region. CloudShell refused to start (account verification), and the CLI had no caller with `iam:SimulatePrincipalPolicy` | C1 complete, 8 marks. Simulator run from the console instead |
| **Sep 19 18:10–21:40** | **The Notes API** — Express, `pg`, seeder, the four planted problems | No direct marks, but nothing in B or C could start without it. Seeded 50,000 notes and 150,000 tags with `generate_series` after deciding looped inserts would take minutes | App + seeder committed. Unblocked 160 marks |
| **Sep 19 21:40–22:00** | **B1 Task 21** — multi-stage Dockerfile, non-root, healthcheck | Container died instantly during the healthcheck test: `db.js` refuses to start without `DB_PASSWORD`, even though `/healthz` never queries the database | 6 marks. Healthy after `-e DB_PASSWORD=` |
| **Sep 19 21:50–22:00** | **C2 Task 49** — push to ECR | Nothing. The C1 policy did exactly what it was written for | 4 marks |
| **Sep 19 22:20–23:00** | **C2 Task 50** — task definition with a Postgres sidecar | Ran the task successfully in `sturdy-bat-1hn1tx`, a cluster AWS had named for me. Would have failed silently in Task 53 | 8 marks after moving it to `exam-cluster-zaman` |
| **Sep 20 01:20–02:00** | **C2 Task 51** — ALB, target group, ECS service | Three separate traps: the console refuses to convert a CIDR security-group rule into a group reference, healthy targets received nothing because the ALB and ECS had been given different Availability Zones, and the service picked up a generated name with a random suffix | 8 marks. Pointed the C1 policy at the generated name rather than rebuild a healthy service |
| **Sep 20 02:00–03:15** | **C2 Task 52** — autoscaling, triggered and measured | The scaling policy had not actually saved, so 99% CPU produced nothing. Then the brief's load command generated no load at all — no `X-Tenant` header means an instant 400. Then Europe-to-us-east-1 latency capped throughput at 91 req/s | 6 marks. Measured ~7 minutes from CPU crossing 50% to a new task serving |
| **Sep 20 03:15–04:30** | **C2 Task 53** — OIDC deploy pipeline | `Not authorized to perform sts:AssumeRoleWithWebIdentity`, three times, with no detail. Stopped guessing and printed the token's claims: GitHub now embeds numeric ids in the subject | 8 marks. Debug step left in the workflow |
| **Sep 20 04:30–05:00** | **C2 Task 54** — break the health check and debug it | Expected 404 from the unknown path, got 400 — the tenant middleware rejects it before the router sees it. Also read `000` from curl as a failure when it meant no connection at all, from using the task's private IP | 2 marks. C2 complete at 36 |
| **Sep 20 06:20–07:00** | **C3 Tasks 55–56** — presigned upload, download, expiry | Content-Type must match what the URL was signed with, or S3 returns `SignatureDoesNotMatch` on a perfectly valid URL | 9 marks |
| *(break)* | | | |
| **Sep 20 14:40–15:05** | **C3 Tasks 57–58** — public vs private prefixes, tenant isolation | `iam:PassRole` refused the new task role — my own C1 policy working as designed. Widened it by naming the second role rather than using `*` | 11 marks. C3 complete at 20 |
| **Sep 20 15:15–15:25** | **C5** — tear everything down | One EC2 instance survived the cleanup. Checked its tags before touching it: `ashik-admin-pw`, launched sixteen hours before I had an IAM user here. Left it alone | 4 marks. Scenario C complete at 68/94 |
| **Sep 20 15:30–15:45** | **A2** — port investigation | First attempt at the sudo comparison proved nothing: logged in as root, `sudo` is a no-op. Needed an unprivileged user, which A1 had already created | 12 marks. Scenario A floor cleared at 39% |
| **Sep 20 15:50–16:30** | **B1 Tasks 22–25** — size, caching, layers, secrets | The secret scan found nothing — and could not have found anything, because `docker save` gzips its layer blobs. Rewrote it to decompress each layer and validated it against the brief's own `COPY .env` / `rm` trap first | 12 marks. B1 complete at 18 |
| **Sep 20 16:30–17:15** | **B5 Tasks 42, 43, 46** — GHCR pipeline, caching, safeguards | `type=gha` restored nothing at all while still paying to export. Switched to a registry cache, which works — and then measured that caching is still slower at this project's size | 12 marks, and an honest negative result |
| **Sep 20 17:19–19:05** | **B4** — Swarm | Almost ran `docker stack deploy ... notes` on a swarm already carrying six other candidates' stacks, one of which owned `notes_app`. The ingress mesh does not deliver on this host, so everything was measured through the service VIP instead | 26 marks. Zero failures across a rolling update (583 requests) and a scale-down (148). Scenario B floor cleared at 45% |
| **Sep 20 19:05–21:30** | `AI_PROMPTS.md`, `INCOMPLETE.md`, this file | Nothing — writing up what had already happened | Submission documented |

## Where the time went

Scenario C took roughly eleven hours for 68 marks. Scenario A's port investigation took
fifteen minutes for 12, and B1's remaining four tasks forty minutes for 12.

The difference is not difficulty. AWS work is slow because the feedback loop is slow — a
task takes four minutes to start, an alarm needs three minutes of datapoints, a scale-in
waits fifteen — and because console defaults and an unverified account produce failures
that look like configuration errors. Local work on one machine gives an answer in
seconds.

Given the time again I would have done A2, A3, B1 and B2 first and arrived at AWS with the
application already containerised and understood. That is written up at the end of
`INCOMPLETE.md`.
