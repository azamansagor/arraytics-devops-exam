# SCENARIO C — Answers

> Exam token: `root-vmi3536696-1788597274-30dab396`

## Names and region used in this submission

This AWS account is shared-safe by suffixing `zaman`, same convention as scenarios A and B.

| Thing | Name |
| --- | --- |
| Region | `us-east-1` (N. Virginia) |
| Account ID | `750069566598` |
| ECR repository | `notes-api-zaman` |
| ECS cluster | `exam-cluster-zaman` |
| ECS service | `notes-api-zaman-service-jgt41c68` (see note below) |
| IAM user | `exam-deployer-zaman` |
| Custom IAM policy | `exam-deployer-policy-zaman` |

### A note on the ECS service name

I planned to call the service `notes-api-svc-zaman`, and that is the name the C1 policy
and the Task 48 simulator run were written against. When C2 created it, the ECS console
filled the Service name field with its own default, `notes-api-zaman-service-jgt41c68`,
and I did not override it.

ECS service names cannot be changed after creation, so the choice was to delete a
working, healthy service and rebuild it — including re-seeding both tasks — or to point
the policy at the name that actually exists. I updated the policy, because the name is
arbitrary and the service is not.

What does not change is the principle: the `Resource` still names one specific service in
one specific cluster, not `"*"`. The Task 48 evidence shows the ARN as it stood at the
time of that test; the action, the policy statement and the result are unchanged, only
the last segment of the ARN differs.

The cost of this shortcut is worth stating: the console's suffix is random, so if this
service is ever deleted and recreated the name changes again and the policy silently
stops matching. A deliberate name would not have that property. That is the argument for
naming things yourself, and it is the second time in this scenario that accepting a
console default has cost me something — the first was the cluster, in Task 50.

### Why not `ap-southeast-1`

I planned to run everything in `ap-southeast-1` (Singapore) because it is closest. The
account refused it: 17 Regions are not enabled on this account and Singapore is one of
them. Opt-in Regions have to be enabled from Account settings first, and that is an
account-level action with a propagation delay, so rather than block on it I moved the
whole scenario to `us-east-1`, which is enabled by default and cannot be disabled.

This matters beyond convenience: an IAM policy `Resource` ARN contains the Region, so a
policy written for `ap-southeast-1` would never match a repository created in
`us-east-1` and every push would fail with `AccessDenied`. ECR, ECS, the ALB and S3 for
this scenario are therefore all in `us-east-1` — a task definition cannot pull an image
from a repository in a Region it was not given.

---

## C1 — IAM basics

### Task 47 — A user with limited permissions

Policy JSON: [`iam/exam-deployer-policy-zaman.json`](iam/exam-deployer-policy-zaman.json)

`exam-deployer-zaman` is a CLI-only user — no console password, no access to the AWS
Management Console at all — with exactly one customer-managed policy attached and no AWS
managed policy. It can push to one repository and update one service. Nothing else.

#### Why three statements still use `Resource: "*"`

JSON has no comment syntax and IAM rejects unknown keys, so the reason is carried in each
`Sid`, which is the only free-text field IAM keeps:

| Sid | Why `*` is unavoidable |
| --- | --- |
| `EcrGetAuthTokenStarBecauseNoResourceLevelSupport` | `ecr:GetAuthorizationToken` does not support resource-level permissions. It returns an account-wide, 12-hour token used to authenticate the Docker client; it is not an operation *on* a repository, so there is no repository ARN to name. Writing one would not be invalid, it would simply never match, and `docker login` would fail. |
| `EcsRegisterTaskDefinitionStarBecauseNoResourceLevelSupport` | `ecs:RegisterTaskDefinition` creates a resource that does not exist yet. There is no ARN to authorise at evaluation time, so AWS does not support resource-level permissions on it. |
| `EcsRegisterTaskDefinitionStarBecauseNoResourceLevelSupport` (same statement) | `ecs:DescribeTaskDefinition` likewise cannot be scoped to a family or revision ARN. |

Note what is *not* starred. `iam:PassRole` is the dangerous one — a user who can pass any
role to any service can escalate to that role's permissions. It is scoped to the single
`ecsTaskExecutionRole` ARN and further fenced by a condition:

```json
"Condition": { "StringEquals": { "iam:PassedToService": "ecs-tasks.amazonaws.com" } }
```

So `exam-deployer-zaman` may hand that role to ECS tasks and to nothing else — not to
EC2, not to Lambda.

#### Evidence

| # | Command | Expected | Screenshot |
| --- | --- | --- | --- |
| 1 | `aws sts get-caller-identity` | ARN is `user/exam-deployer-zaman` | `c1-task47-whoami.png` |
| 2 | `aws ecr describe-repositories --repository-names notes-api-zaman` | repository found in `us-east-1` | `c1-task47-ecr-push-allowed.png` |
| 3 | `aws ecr get-login-password \| docker login` | `Login Succeeded` | `c1-task47-ecr-push-allowed.png` |
| 4 | `docker push .../notes-api-zaman:c1-permission-test` | `Pushed` + digest | `c1-task47-ecr-push-allowed.png` |
| 5 | `aws s3 ls` | `AccessDenied` on `s3:ListAllMyBuckets` | `c1-task47-denied.png` |

Both the allow and the deny screenshot print the caller ARN before the command, so the
two results are demonstrably the same principal and not two different profiles.

The pushed image for this task is `alpine:3.20` retagged as `c1-permission-test`. The
point being proved here is that the policy permits the push, not that the application is
finished; the real Notes API image goes to the same repository in Task 49.

#### One thing I got wrong first

My first attempt at the deny proof ran as the wrong identity. This box already had a
`default` CLI profile belonging to an unrelated user, `fc-exam-deployer`, so
`aws sts get-caller-identity` with no `--profile` returned that user rather than mine. I
then set `P="--profile exam-deployer-zaman"` but never expanded `$P` into the command, so
the output did not change and it looked like the profile was being ignored. The fix was
to stop passing the flag per command and export `AWS_PROFILE=exam-deployer-zaman` for the
shell, which every screenshot in this task then prints back.

Worth stating plainly: a deny screenshot taken under the wrong profile proves nothing.

### Task 48 — Test your policies

Done with the IAM Policy Simulator in the console, against the user
`exam-deployer-zaman` with `exam-deployer-policy-zaman` selected.

#### The four tests — two allowed, two denied

| Service | Action | Resource simulated | Result | Simulator's reason |
| --- | --- | --- | --- | --- |
| ECR | `PutImage` | `arn:aws:ecr:us-east-1:750069566598:repository/notes-api-zaman` | **Allowed** | Explicit allow in 1 statement |
| ECS | `UpdateService` | `arn:aws:ecs:us-east-1:750069566598:service/exam-cluster-zaman/notes-api-svc-zaman` | **Allowed** | Explicit allow in 1 statement |
| S3 | `DeleteBucket` | `arn:aws:s3:::any-bucket-zaman` | **Denied** | Implicit deny due to no statement(s) matching |
| IAM | `CreateUser` | `*` | **Denied** | Implicit deny due to no statement(s) matching |

Screenshot: `c1-task48-simulator-round1.png`

Note the wording the simulator itself uses for the two refusals: *implicit deny due to no
statement matching*. There is no `"Effect": "Deny"` anywhere in my policy and none is
needed. IAM denies by default, so a permission is refused simply by never being granted.
An explicit `Deny` is only needed to carve an exception out of a broader `Allow`.

The resource ARN matters in this test and is easy to get wrong: the simulator defaults to
`*`, and because my policy is scoped to one repository and one service, leaving that
default in place makes even `ecr:PutImage` come back denied. That is the policy working,
not failing.

#### Why the CLI route was not available

`aws iam simulate-principal-policy` needs `iam:SimulatePrincipalPolicy` **on the caller**,
which is a separate principal from the user named in `--policy-source-arn`:

- As `exam-deployer-zaman` it fails — and that is correct. If it could simulate, it would
  hold an IAM permission and Task 47's "nothing else" requirement would be broken.
- The only other credentials on the exam box belong to an unrelated user,
  `fc-exam-deployer`, which has no IAM permissions either.
- CloudShell, which would have run as my console identity, refused to start: *"Your
  account verification is in progress. This may take up to two days for new accounts."*
  The same unverified-account state is why `ap-southeast-1` is disabled.

So the console simulator was the route that worked, which is the first option the task
offers anyway.

#### Cross-checked against real API calls

I also ran the equivalent calls for real as `exam-deployer-zaman`, and every one agreed
with the simulator:

| Command | Result |
| --- | --- |
| `aws ecr describe-images --repository-name notes-api-zaman` | lists `c1-permission-test` |
| `aws ecs describe-services --cluster exam-cluster-zaman --services notes-api-svc-zaman` | `ClusterNotFoundException` |
| `aws ecr describe-images --repository-name someone-else-repo` | `AccessDeniedException` on `ecr:DescribeImages` |
| `aws iam list-users` | `AccessDenied` on `iam:ListUsers` |
| `aws s3 ls` | `AccessDenied` on `s3:ListAllMyBuckets` |

Two of these are worth reading carefully.

**`ClusterNotFoundException` is an allow, not a denial.** IAM authorises a request before
the service looks for the resource. `AccessDenied` means IAM refused and the call never
reached ECS; `ClusterNotFoundException` means IAM permitted it and ECS could not find
`exam-cluster-zaman`, because it does not exist yet — it gets created in C2. Two failures
at two different layers, and only the first is a permissions answer.

**The two `describe-images` calls are the proof that `Resource` is doing work.** Same
action, same user, same Region; only the repository differs, and the answers are
opposite. A policy listing the same actions against `Resource: "*"` would have allowed
both.

#### Evidence

| File | Shows |
| --- | --- |
| `c1-task48-simulator-round1.png` | Policy Simulator: identity, policy selected, and all four results with reasons |

Honest note: the real-API cross-check above was run in the terminal but not captured as a
screenshot, so the simulator output is the evidence for this task. The same denials do
appear, token-stamped, in `c1-task47-denied.png`.

---

## C2 — Get your app running on AWS

### Task 49 — Push your image to ECR

The image is the real Notes API from Scenario B, built from
[`../scenario-b/docker/Dockerfile`](../scenario-b/docker/Dockerfile), not a placeholder.
Pushed as `exam-deployer-zaman`, the scoped user from C1 — the caller ARN is printed in
the screenshot immediately above the push, so this is also the end-to-end proof that the
policy written in Task 47 permits exactly what it was meant to.

```
750069566598.dkr.ecr.us-east-1.amazonaws.com/notes-api-zaman:v1
digest sha256:31c20be1fc51afe5e568cd0518316dcb399fd4091f7dfba3712157b542c0f1a5
```

#### Tag and size

| Source | Reported size |
| --- | --- |
| ECR (`describe-images`, `imageSizeInBytes`) | 61,607,847 bytes |
| ECR console, `v1` | 61.61 MB |
| `docker images`, content size | 61.6 MB |
| `docker images`, disk usage | 245 MB |

The gap between 61.6 MB and 245 MB is not an error and is worth being able to explain:
**ECR stores and reports compressed layers, while disk usage is the extracted tree.**
Pulling this image moves about 62 MB over the network and occupies about 245 MB once
unpacked. Task 22 compares image sizes, so the comparison there has to stay on one side
of that line rather than mixing the two numbers.

#### Why the repository lists four entries for two images

The console shows `v1` as an **Image Index** plus two untagged rows — one `Image` of the
same 61.61 MB, and one `Other` of 0.00 MB:

| Tag | Type | Size |
| --- | --- | --- |
| `v1` | Image Index | 61.61 MB |
| – | Image | 61.61 MB |
| – | Other | 0.00 MB |
| `c1-permission-test` | Image | 3.63 MB |

BuildKit pushes an OCI image index rather than a bare manifest. The index is what carries
the `v1` tag; it points at the actual platform image and at a small attestation manifest
describing how the image was built. The two untagged rows are those referenced objects,
not duplicate or orphaned uploads — deleting them would break the tag.

`c1-permission-test` is the retagged `alpine` from Task 47, left in place deliberately:
it is the evidence for that task, and `exam-deployer-zaman` has no
`ecr:BatchDeleteImage` permission to remove it even if I wanted to.

#### Evidence

| File | Shows |
| --- | --- |
| `c2-task49-ecr-push.png` | token + date, caller ARN, `docker images`, `Login Succeeded`, every layer `Pushed`, final digest |
| `c2-task49-ecr-image-tag-size.png` | token + date, `describe-images` table with tag `v1` and 61,607,847 bytes |
| `c2-task49-ecr-console.png` | ECR console listing `v1` with its size and type |

### Task 50 — Task definition

Committed at [`ecs/task-definition-zaman.json`](ecs/task-definition-zaman.json) with the
account id replaced by `ACCOUNT_ID`, substituted with `sed` at register time and rendered
to `/tmp` rather than back into the repo.

Registered by `exam-deployer-zaman`, which produced `notes-api-zaman:2`.

#### What the task definition contains

| Required | Where |
| --- | --- |
| Container from ECR | `notes-api` and `db-init` both run `.../notes-api-zaman:v2` |
| Port mapping 3000 | `portMappings` on `notes-api` |
| CloudWatch logs | `awslogs` driver on all three containers, group `/ecs/notes-api-zaman`, one stream prefix each |
| Container health check | `healthCheck` on `notes-api` (wget `/healthz`) and on `postgres` (`pg_isready`) |
| DB connection env vars | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_POOL_MAX` in `environment`; `DB_PASSWORD` in `secrets` |

#### Three containers, and the order they have to start in

Postgres runs as a sidecar in the same task. Under `awsvpc` all containers in a task
share one network namespace, so the app reaches the database at `127.0.0.1:5432` — no
service discovery, no DNS.

```
postgres  ──HEALTHY──▶  db-init  ──SUCCESS──▶  notes-api
```

- `postgres` is essential, with `pg_isready` as its health check.
- `db-init` runs `node migrate.js && node seed.js` and is **not** essential, so the task
  survives it exiting. It waits on `condition: HEALTHY`.
- `notes-api` waits on `condition: SUCCESS`, so it only starts once the schema exists and
  the data is loaded.

Without that chain the app would open on an empty database and crash-loop, and the
symptom would look like an application bug rather than a startup ordering one.

`db-init` showing **Stopped, exit code 0** in the console is the expected steady state,
not a failure. It is also the thing to check first if the app never starts: a non-zero
exit there means seeding failed and `notes-api` is correctly refusing to come up.

#### Keeping the password out of a committed file

This file is committed, so a literal `POSTGRES_PASSWORD` in it would be a credential in
the repository — an instant zero for the whole scenario under the exam rules.

The password lives in SSM Parameter Store as a SecureString at
`/notes-api-zaman/db-password`. The task definition carries only its ARN, in the
`secrets` block rather than `environment`, and ECS resolves it at task start using the
execution role. That role's inline policy names the one parameter:

```json
"Action": "ssm:GetParameters",
"Resource": "arn:aws:ssm:us-east-1:ACCOUNT_ID:parameter/notes-api-zaman/db-password"
```

Not `ssm:*`, and not every parameter in the account — the same scoping rule as the C1
policy. The value never appears in the repo, in the task definition, or in `docker
inspect` output.

#### Why the container health check uses /healthz and not /readyz

`/readyz` queries the database; `/healthz` only reports that the process is alive.

A container health check is a *restart* trigger. Pointing it at `/readyz` would mean a
database hiccup marks the container unhealthy and ECS replaces a container that was
working perfectly — and since the database is a sidecar in the same task, replacing the
task would destroy the very database it was waiting for. `/readyz` belongs on the load
balancer target group, where a failing instance is taken out of rotation rather than
killed. That is where it goes in Task 51.

#### Sizing

512 CPU units and 1024 MiB, above the 256/512 the brief calls sufficient, because this
task carries Postgres and a seeding run as well as the app. Deliberately not larger:
half a vCPU is easy to saturate, which is what makes the CPU-driven autoscaling in Task
52 actually trigger.

#### The honest limitation of the sidecar approach

Each task carries its own Postgres with no volume attached. So:

- the data dies with the task,
- two tasks behind a load balancer do not share data — each seeds its own copy,
- every scale-out event pays the seeding cost before the new task can serve traffic.

For a real multi-tenant service this is wrong, and RDS is the right answer: one database,
many stateless tasks. I chose the sidecar because the brief's cost warning pushes towards
it and because it keeps the whole scenario inside one task definition. It is a
demonstration shape, not a production one, and it is worth saying so rather than letting
it pass as a design.

#### What I got wrong the first time

I ran the task and it worked — in the wrong cluster. ECS had created one named
`sturdy-bat-1hn1tx` and it was selected by default, so the task landed there instead of
`exam-cluster-zaman`.

It would have worked fine and failed later. The C1 policy scopes `ecs:UpdateService` to
`arn:aws:ecs:us-east-1:ACCOUNT_ID:service/exam-cluster-zaman/notes-api-svc-zaman`, so a
service created in `sturdy-bat-1hn1tx` would have made the CI/CD deploy in Task 53 return
`AccessDenied` for a reason that looks nothing like a cluster name. Stopped the task,
created `exam-cluster-zaman` properly as Fargate-only, and re-ran it there.

The general shape of the mistake: an IAM policy ARN encodes names, so every name in it is
load-bearing. Getting one wrong does not fail where you made the mistake.

#### Evidence

| File | Shows |
| --- | --- |
| `c2-task50-register-taskdef.png` | token + date, `register-task-definition` returning family, revision 2, and the three container names |
| `c2-task50-task-running.png` | `exam-cluster-zaman`, task `Running` and `Healthy` on `notes-api-zaman:2`, Fargate, with the containers listed |
| `c2-task50-cloudwatch-logs.png` | log group `/ecs/notes-api-zaman`, stream `notes-api/notes-api/3867a73d...`, the app's own startup line |
| `c2-task50-task-responding.png` | token + date, `/healthz`, `/readyz` returning `ready`, and `/api/stats` returning 30,000 notes |

`/readyz` answering `ready` is the proof the app reached the sidecar Postgres, and
`notes: 30000` is the proof `db-init` seeded it. The hostname
`ip-172-31-68-220.ec2.internal` is the same in the CloudWatch line and in the curl
responses, so both screenshots are demonstrably the same task.

### Task 51 — Service behind a load balancer

```
http://notes-api-alb-zaman-1925549638.us-east-1.elb.amazonaws.com
```

An internet-facing ALB on port 80 forwards to target group `notes-api-tg-zaman`, which
the ECS service registers two Fargate tasks into.

| Piece | Setting |
| --- | --- |
| Target group type | **IP** — Fargate uses `awsvpc`, so every task has its own ENI and there is no instance to register |
| Target port | 3000 |
| Target group health check | `/readyz`, interval 15s, healthy threshold 2 |
| Service | `notes-api-zaman-service-jgt41c68`, desired 2, Fargate |
| Health check grace period | 300s |

#### Proof that requests reach different tasks

Twelve requests through the ALB, and a count over twenty:

```
{"status":"ok","instance":"ip-172-31-25-251.ec2.internal","uptime":811.69}
{"status":"ok","instance":"ip-172-31-44-152.ec2.internal","uptime":838.13}
{"status":"ok","instance":"ip-172-31-44-152.ec2.internal","uptime":839.30}
{"status":"ok","instance":"ip-172-31-25-251.ec2.internal","uptime":814.37}
...
--- distribution over 20 requests ---
  10 ip-172-31-25-251.ec2.internal
  10 ip-172-31-44-152.ec2.internal
```

Ten and ten. The two hostnames are the two task ENI addresses, and they match the two
registered targets in the target group screenshot — `172.31.25.251` in `us-east-1c` and
`172.31.44.152` in `us-east-1d`. The `uptime` values also drift independently, which is
what you would expect from two separate processes and not from one answering twice.

#### Two health checks, two different jobs

This is the part worth being precise about, because the same application exposes both:

| | Endpoint | Consequence of failing |
| --- | --- | --- |
| Container health check (task definition) | `/healthz` | ECS **kills and replaces** the container |
| Target group health check (ALB) | `/readyz` | ALB **stops sending traffic** to that target |

`/readyz` queries the database, `/healthz` does not. A database blip should take an
instance out of rotation, not destroy it — and here destroying the task would destroy the
sidecar Postgres along with it. Putting the database-touching check on the load balancer
and the process-only check on the container is what keeps those two outcomes apart.

#### Security groups: the ALB is the only thing that may reach port 3000

Two groups, chained:

- `notes-api-alb-sg` — inbound HTTP 80 from `0.0.0.0/0`. This is a public API and the URL
  has to be openable, so that is deliberate. The instant-zero rule concerns port 22,
  which is not open here at all.
- `notes-api-zaman-sg` on the tasks — inbound 3000 from **the ALB's security group id**,
  plus a separate rule from the exam VPS `169.58.246.108/32` for direct debugging.

Port 3000 is not open to the internet. Naming a security group as the source rather than
a CIDR matters: AWS does not memorise an address, it means "any ENI carrying that group".
ALB node addresses change and new ones appear as it scales, and AWS gives no guarantee
about them, so a CIDR rule would need chasing. A group reference follows on its own.

One console detail worth recording: an existing rule whose source is an IPv4 CIDR cannot
be switched to a group reference — *"You may not specify a referenced group id for an
existing IPv4 CIDR rule."* It has to be added as a new rule, which is why there are two.

#### Why the grace period is 300 seconds and not the default

The default is 0. A task here needs to pull two images, start Postgres, wait for
`pg_isready`, then apply the schema and seed 50,000 notes and 150,000 tags before the app
even listens — roughly 90 to 120 seconds. With a grace period of 0 the ALB starts health
checking immediately, marks the target unhealthy, ECS replaces the task, and the
replacement does the same thing forever.

The failure looks exactly like a broken application. It is impatience.

#### The problem I hit: healthy targets receiving no traffic

After creating the service, the target group reported:

> *Targets are not within enabled Availability Zones. Unused target zones: us-east-1c, us-east-1d*

Both targets were registered and both were healthy, and none of them received a request.
An ALB can only route into Availability Zones it has a subnet in, and I had given the ALB
two AZs while ECS placed the tasks in two others — the ECS console defaults to every
subnet in the VPC, so the scheduler used AZs the ALB could not reach.

Fixed by adding all the default VPC's subnets to the ALB (Network mapping → Edit
subnets), which changes nothing about the running tasks. Restricting the service's
subnets instead would have worked too, but at the cost of a redeploy and a re-seed.

The shape of this failure is worth remembering because every component reports itself
healthy: ECS says the tasks are running, the target group says the targets are healthy,
and the ALB returns 503. Nothing is broken; two lists of Availability Zones simply do not
overlap.

#### Evidence

| File | Shows |
| --- | --- |
| `c2-task51-alb-different-tasks.png` | token + date, twelve alternating responses through the ALB, and a 10/10 split over twenty |
| `c2-task51-target-group-healthy.png` | target type IP, port 3000, two targets healthy in `us-east-1c` and `us-east-1d` |
| `c2-task51-service-running.png` | service Active, 2 desired / 2 running, both tasks Healthy on `notes-api-zaman:2` |
| `c2-task51-app-through-alb.png` | the real API through the ALB, not just health endpoints |
| `c2-task51-deployer-can-see-service.png` | `exam-deployer-zaman` calling `describe-services` successfully — the C1 policy and the live service name now agree |
