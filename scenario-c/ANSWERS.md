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
| ECS service | `notes-api-svc-zaman` |
| IAM user | `exam-deployer-zaman` |
| Custom IAM policy | `exam-deployer-policy-zaman` |

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
