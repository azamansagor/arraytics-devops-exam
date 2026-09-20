# AI Prompt Log

> Exam token: `root-vmi3536696-1788597274-30dab396`

I used Claude throughout this exam, mostly as a pair to think out loud with rather than
as an answer machine. These are the eight exchanges where the first answer was wrong,
incomplete, or right in general and wrong on this machine — which is the only part worth
writing down.

A pattern runs through most of them: **the generic answer describes the documented case,
and the documented case is not the one in front of you.** A shared VPS, an unverified AWS
account, a registry that rejects a default, a subject claim that changed format. Every one
of these cost time, and every one was found by looking at what the system actually said
rather than at what it was supposed to say.

---

## Entry 1 — The AWS region that did not exist for me

**Stuck on:** Writing the C1 IAM policy. I had chosen `ap-southeast-1` because Singapore
is closest to Bangladesh, and written the policy ARNs against it.

**Prompt sent:**

```
I'm writing a scoped IAM policy for an ECR repo and ECS service. Region ap-southeast-1,
account 750069566598. Here's my policy JSON — check it.
```

**Answer I got:** The policy was reviewed and improved — resource-level ARNs, a comment
about why `ecr:GetAuthorizationToken` must be `*`. Nothing about the region, because
nothing about the region looked wrong.

**What actually fixed it:** The console refused to switch to Singapore: 17 Regions are not
enabled on this account, which is an opt-in setting with a propagation delay. I moved
everything to `us-east-1`.

The part that mattered was not the move but the consequence. **An IAM policy `Resource`
ARN contains the Region.** A policy written for `ap-southeast-1` would have been accepted
happily and then never matched anything in `us-east-1` — every push failing with
`AccessDenied` for a reason that reads like a permissions problem and is actually a
geography problem. I had to rewrite every ARN, not just change a dropdown.

**Lesson:** ask what a value is embedded in before changing it. Region is not just where
things run; it is part of the name of everything that runs there.

---

## Entry 2 — Accepting the console's default name, twice

**Stuck on:** Nothing, which was the problem. Task 50 asked me to run an ECS task and it
worked first time.

**Prompt sent:**

```
Task ran fine, here are the screenshots — check them and let's move to Task 51.
```

**Answer I got:** The screenshots were checked and the breadcrumb read
`Clusters › sturdy-bat-1hn1tx › Tasks`. My task was running in a cluster AWS had named
for me, not in `exam-cluster-zaman`.

**What actually fixed it:** Stopping the task, creating the cluster properly, and
re-running. Then the same thing happened again one task later — the ECS service wizard
filled the name field with `notes-api-zaman-service-jgt41c68` and I did not override it.

Both would have worked indefinitely and then failed in Task 53, where the CI/CD pipeline
calls `ecs:UpdateService` against an ARN that names the cluster and service:

```
arn:aws:ecs:us-east-1:...:service/exam-cluster-zaman/notes-api-svc-zaman
```

An `AccessDenied` from a pipeline looks like an OIDC problem, or a policy problem, or a
trust problem. It does not look like a name typed by a wizard two hours earlier.

**Lesson:** the moment a name appears in an IAM policy it stops being a label and becomes
part of a contract. Console defaults know nothing about that contract. The second time I
chose to point the policy at the generated name rather than rebuild a healthy service —
and wrote down that the random suffix means recreating the service breaks the policy
silently.

---

## Entry 3 — "Not authorized" with nothing else to go on

**Stuck on:** The GitHub Actions deploy failing at the first AWS step, every run:

```
Error: Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

**Prompt sent:**

```
OIDC role assumption fails. Trust policy has the documented subject
repo:azamansagor/arraytics-devops-exam:ref:refs/heads/main, audience sts.amazonaws.com,
identity provider exists. Repo name matches exactly. What's wrong?
```

**Answer I got:** A list of the usual suspects — check the provider, check the audience,
check the role ARN secret for trailing whitespace. All reasonable. All wrong here, and I
checked each one.

**What actually fixed it:** Instead of guessing a fourth time, adding a step that decodes
the OIDC token and prints its claims:

```json
{
  "sub": "repo:azamansagor@10332423/arraytics-devops-exam@1357889649:ref:refs/heads/main",
  "aud": "sts.amazonaws.com"
}
```

GitHub now embeds immutable numeric ids in the subject — `@10332423` for the owner,
`@1357889649` for the repository. My pattern could never have matched.

**Lesson:** two lessons. First, **IAM returns the same message whether the subject, the
audience or the role ARN is wrong, and that is deliberate** — naming the failed condition
would tell an unauthenticated caller which half of the claim to guess next. Second, when
an error refuses to discriminate, stop reasoning about it and print the input. One run
with the claims in the log beat three rounds of editing policy on a hunch.

The id-based form is also stricter, not looser: names can be released and re-registered,
ids cannot.

---

## Entry 4 — A load test that generated no load

**Stuck on:** Task 52. CPU had to cross 50% to trigger autoscaling. It peaked at 20% and
nothing scaled.

**Prompt sent:**

```
Ran the load test from the brief for 5 minutes, CPU only reached 20%, no scaling.
Is the target tracking policy wrong?
```

**Answer I got:** First suggestions were about the policy — check the alarm, check the
metric, check min/max. The policy was fine.

**What actually fixed it:** Three separate problems, none of them autoscaling.

1. **`hey` would not install.** The S3 download in the brief returns 403; the binary now
   lives on GitHub releases. Ended up using ApacheBench, already on the box.
2. **The brief's URL produces no load at all.** It is `/api/search?q=abc` with no headers,
   and this API requires `X-Tenant`. Without it the app returns 400 immediately — no
   tenant lookup, no query, no CPU. Five minutes at 50 concurrent moved nothing.
3. **Driving us-east-1 from a European VPS is its own bottleneck.** At ~100ms per round
   trip with no keep-alive, 50 connections spend their time waiting on the network rather
   than on Postgres — 91 requests per second, with connection setup costing as much as the
   work.

Adding `-k`, raising concurrency to 200, and switching to `/api/stats` — which scans
150,000 unindexed tag rows and returns a single row, so it is maximum CPU for minimum
bandwidth — took CPU to 99.57%.

**Lesson:** when a load test does not load, suspect the test before the system. And pick
the endpoint by what it costs the server versus what it sends back over the wire, not by
what the instructions happened to name.

---

## Entry 5 — A permission that refused, correctly

**Stuck on:** Registering a new ECS task definition with an S3 task role attached:

```
AccessDeniedException: not authorized to perform: iam:PassRole on resource:
arn:aws:iam::750069566598:role/notes-api-task-role-zaman
```

**Prompt sent:**

```
PassRole denied when adding a task role to the task definition. My policy already has
iam:PassRole. What's the fix?
```

**Answer I got:** The correct fix, and importantly *not* the obvious one — the obvious one
is to widen `Resource` to `*` and move on, and that is what a lot of answers to this
question say.

**What actually fixed it:** Adding the second role **by name** to the existing statement,
keeping the `iam:PassedToService` condition:

```json
"Resource": [
  "arn:aws:iam::...:role/ecsTaskExecutionRole",
  "arn:aws:iam::...:role/notes-api-task-role-zaman"
]
```

**Lesson:** this error was my own policy working. `iam:PassRole` is the permission that
turns "can write a task definition" into "can assume any role in this account" — a task
definition names a role, and ECS then runs with it. Open it to `*` and a deploy user can
hand itself an admin role through a container.

Being blocked by a control I wrote two days earlier, for exactly the reason I wrote it,
was the most useful thing that happened in Scenario C.

---

## Entry 6 — The 404 that was a 400

**Stuck on:** Task 54, where I deliberately pointed the ALB health check at a path the app
does not serve. I expected the target group to report 404.

**Prompt sent:**

```
Broke the health check path as planned. Target group says
"Health checks failed with these codes: [400]". Why 400 and not 404?
```

**Answer I got:** The question was correctly answered — but only because I asked it. My
own prediction, written into the plan, had said 404.

**What actually fixed it:** Nothing needed fixing; the understanding needed fixing.
`resolveTenant` runs as middleware **ahead of the routes** and exempts exactly three
paths. Anything else without an `X-Tenant` header is rejected there, before the router is
consulted. The ALB sends no such header, so the request never reached the point where it
could have been a 404.

**Lesson:** the consequence is the useful part. **Any endpoint behind that middleware is
unusable as a health check, whatever its own behaviour.** Pointing the check at
`/api/stats` — a route that works perfectly — would fail identically, for a reason that
has nothing to do with that route. That is a property of middleware ordering and it is
invisible if you only read the route handlers, which is where everyone looks first.

---

## Entry 7 — A secret scan that could not have found anything

**Stuck on:** Task 25, proving no secrets are in the image.

**Prompt sent:**

```
How do I prove there are no secrets baked into my Docker image?
```

**Answer I got:** `docker save` the image, extract the tar, `grep` it. Ran it, found
nothing, and was about to write that down as proof.

**What actually fixed it:** The layer blobs inside a `docker save` tar are **gzip
compressed**. A plain `grep` cannot see file contents. It would have found nothing if the
image had been full of passwords — **a negative result from a test that cannot produce a
positive one is not evidence.**

The rewrite decompresses every layer before searching, and — the part I would not have
thought of unprompted — was validated against a deliberately poisoned image first, the
`COPY .env` then `rm` trap from the brief. The scanner found the password in a layer of an
image whose running container shows an empty directory. Only then was its silence on my
own image worth anything.

Running it properly then produced three hits, all false positives:
`AWS_SECRET_ACCESS_KEY` is a variable *name* written in the AWS SDK's own source, the
`AKIA` fragments are TypeScript docs and coincidental bytes in the `node` binary, and
`BEGIN PRIVATE KEY` is npm's documentation.

**Lesson:** two. **Validate a detector against a known positive before trusting a
negative.** And **searching an image for the names of secrets is the wrong test** — every
SDK contains the name of the credential it reads, so the search is guaranteed to hit in
any image with dependencies. Search for values, key shapes, and the paths credentials
live at.

---

## Entry 8 — The stack deploy that would have deleted someone else's work

**Stuck on:** Nothing yet. I was about to run the command the brief gives for B4:

```bash
docker stack deploy -c stack.yml notes
```

**Prompt sent:**

```
Swarm is already active on this VPS and port 3110 is busy. Should I just deploy?
```

**Answer I got:** Check what is already there first. That check is the entry.

**What actually fixed it:** `docker service ls` showed six other candidates' stacks on the
same swarm — `abdur_notes`, `ashik_notes`, `badhon_notes`, `faheem_notes`, `notes_alamin`
— and one bare `notes_app` on port 3200, belonging to someone else.

Deploying as `notes` would have replaced that running service with my image. **Swarm
treats a name collision as an update, not a conflict.** No prompt, no error, no warning —
the existing service simply starts running a stranger's code, and neither of us would
have known why.

Renamed to `zaman_notes` and published on 3111, since 3110 was held by my own
`myapp_zaman.service` from A1 and 3120, 3140, 3200, 5151, 8400 and 30104 by others.

**Lesson:** a shared host silently changes what a documented command means. The brief was
written for a machine with one occupant. Thirty seconds of `docker service ls` was the
difference between a deployment and an incident — and it would have been *my* fault while
looking like *their* outage.

---

## Entry 9 — A cache that was configured, working, and still not worth it

**Stuck on:** Task 42, measuring the benefit of build caching.

**Prompt sent:**

```
Added cache-from/cache-to type=gha to the workflow. Cold run 7s, warm run 14s.
The warm one is slower. Is that expected?
```

**Answer I got:** Plausible explanations about cache export overhead. Partly right,
entirely unverified.

**What actually fixed it:** Searching the warm run's build log for `CACHED` returned
**nothing**. `type=gha` was restoring nothing at all while still paying to export —
7s became 14s in exchange for no benefit whatsoever. Switching to a registry cache stored
in GHCR fixed the restore, visible both as four `CACHED` layers in the log and as a
`buildcache` tag in the Packages tab.

And then the honest result: with the cache genuinely working, the step takes **13s against
7s without one.** The brief assumes the first run is slow because it downloads
dependencies. Here `npm ci` installs four packages in seconds while the cache moves the
entire layer graph including a 180 MB base image. Transport costs more than the work it
replaces.

I also misread the first run after switching — it showed no hits either, which looked like
another failure. It was the run doing the writing.

**Lesson:** **verify a cache, do not configure it and assume.** Two cheap checks: `CACHED`
in the build log, and the cache artifact in the registry. And a measured pessimisation
reported honestly is worth more than an unmeasured optimisation claimed — the
configuration stays because the arithmetic reverses the moment a native dependency is
added, but that is now a stated reason rather than a hope.
