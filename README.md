# DevOps Practical Exam — Submission

**Name:** MD. ASHRAFUZZAMAN
**Exam Token:** `root-vmi3536696-1788597274-30dab396`
**Server IP:** 169.58.246.108

## Shared server — naming convention

The exam VPS is shared with other candidates, so every name in the spec is suffixed or
prefixed with `zaman` to avoid collisions. Wherever the exam text says the left column,
this submission uses the right column.

| Exam spec | This submission |
| --- | --- |
| `/srv/app` | `/srv/app_zaman` |
| groups `devs`, `ops`, `auditor` | `zaman_devs`, `zaman_ops`, `zaman_auditor` |
| users `alice`, `bob`, `carol`, `dan` | `alice_zaman`, `bob_zaman`, `carol_zaman`, `dan_zaman` |
| `myapp.service` | `myapp_zaman.service` |
| app ports 3000/3001/3002 | 3110/3111/3112 |
| nginx on port 80 | nginx on port 8111 (80 is taken on the shared host) |
| A2 test ports 8080/9090 | 8180 / 9191 |
| service account | `myappuser_zaman` |
| sudoers file | `/etc/sudoers.d/zaman-myapp` |
| `/var/log/healthcheck.log` | `/var/log/healthcheck_zaman.log` |

## Hosted links
| What | URL |
| --- | --- |
| App (via nginx) | |
| Grafana dashboard | |
| GitHub Packages / Docker Hub image | |
| ALB DNS (Scenario C) | |
| Tenant subdomains | |

## Repo map
| Path | Contents |
| --- | --- |
| `AI_PROMPTS.md` | AI prompt log (bonus, 10 marks) |
| `TIMELINE.md` | Work diary |
| `INCOMPLETE.md` | Everything not finished, honestly listed |
| `scenario-a/` | Inherited server: users/ACL, ports, bash, systemd, nginx |
| `scenario-b/` | Notes API: Docker, Compose, Prometheus/Grafana, Swarm, CI/CD |
| `scenario-c/` | AWS: IAM, ECS, S3, multi-tenancy, cleanup |
