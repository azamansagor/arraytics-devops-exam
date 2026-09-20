# SCENARIO A — Answers

> Exam token: `root-vmi3536696-1788597274-30dab396`

> Paths and names follow the shared-server convention documented in the root README:
> `/srv/app` -> `/srv/app_zaman`, `alice` -> `alice_zaman`, `myapp` -> `myapp_zaman`,
> ports 3000/3001 -> 3110/3111, nginx 80 -> 8111.

---

## A1 - Team access

### The access model I built

| Path | Owner:Group | Mode | Why |
| --- | --- | --- | --- |
| `/srv/app_zaman` | root:root | 755 | everyone can traverse in |
| `src/` | root:zaman_devs | 2775 | devs write; setgid keeps new files in `zaman_devs` |
| `config/` | root:zaman_ops | 2775 | only ops writes; devs and auditor read |
| `logs/` | root:zaman_devs | 2775 | devs write, everyone reads |
| `secrets/` | root:zaman_ops | 750 + ACL `g:zaman_auditor:r-x` | ops only, plus list-access for dan |
| `secrets/db-password.txt` | root:zaman_ops | 640 | ops reads, nobody else |
| `backups/` | carol_zaman:zaman_ops | 3775 + `chattr +i` on the files | carol owns it but cannot delete |

`carol_zaman` is in `zaman_ops` (primary) **and** `zaman_devs` (secondary), because the
brief says she needs everything devs can do plus more.

### Task 2 - why dan can list the folder but cannot read the file

I gave the `zaman_auditor` group `r-x` on the `secrets` **directory** only, not on the
file. The `r` lets dan see the filenames in that directory and the `x` lets him step into
it, which is what `ls -l` needs to read each file's owner, size and mode. The file itself
is still `640 root:zaman_ops`, and dan is not root and not in `zaman_ops`, so when he
runs `cat` the kernel checks the file's own permission bits separately and refuses him.
So listing a directory and reading a file inside it are two different permission checks,
and I only opened the first one.

### Task 3 - why the sticky bit alone was not enough

The sticky bit on a directory allows deletion by the file's owner, **the directory's
owner**, or root. carol *is* the directory owner, so sticky did not stop her - I checked
this first by deleting `backup3.tar` as carol while the sticky bit was set, and it went
through. The fix was `chattr +i` on the backup files, a
filesystem-level attribute that sits above the permission system: `unlink()` returns
`EPERM` for every user including root until `chattr -i` clears it.

Honest limitation: `chattr +i` protects the *existing files*, not the directory. carol
can still create new files in `backups/` because she has write on the directory - she
just cannot delete or modify the ones already there. Making the directory itself
immutable would also block writing new backups, which is not what we want.

### Task 4 - how sudo was scoped

`/etc/sudoers.d/zaman-myapp` grants `%zaman_devs` and `%zaman_ops` exactly five literal
`systemctl` commands against the `myapp_zaman` unit. No wildcards, no shell, no package
manager. `sudo -l` as alice lists those five and nothing else.

Note the two refusals look different, and the reason matters:

- `sudo apt update` as alice -> `not allowed to execute` - sudo rejected the command.
- `sudo su -` as alice -> `a password is required` - alice *is* in sudoers, but `NOPASSWD`
  only covers the five listed commands, so anything else makes sudo try to authenticate
  her first. She has no password, so it stops there.
- `sudo -n systemctl restart myapp_zaman` as dan -> `a password is required`. dan is not
  in sudoers at all, but modern sudo authenticates the user *before* it will say whether
  a command is permitted, so a non-sudoer never reaches the "not in the sudoers file"
  message when `-n` stops it at the password step. The refusal is real either way;
  `sudo -l -U dan_zaman` run as root states it outright.

### Evidence map

| # | User | Command | Expected | Screenshot |
| --- | --- | --- | --- | --- |
| 1 | alice_zaman | `echo test >> /srv/app_zaman/src/main.js` | works | `a1-proof-alice.png` |
| 2 | alice_zaman | `cat /srv/app_zaman/logs/app.log` | works | `a1-proof-alice.png` |
| 3 | alice_zaman | `sudo systemctl restart myapp_zaman` | works | `a1-proof-alice.png` |
| 4 | alice_zaman | `cat /srv/app_zaman/secrets/db-password.txt` | Permission denied | `a1-proof-alice.png` |
| 5 | alice_zaman | `sudo apt update` | refused by sudo | `a1-proof-alice.png` |
| 6 | carol_zaman | `echo x >> /srv/app_zaman/config/app.conf` | works | `a1-proof-carol.png` |
| 7 | carol_zaman | `cat /srv/app_zaman/secrets/db-password.txt` | works | `a1-proof-carol.png` |
| 8 | carol_zaman | `rm -f /srv/app_zaman/backups/backup1.tar` | fails | `a1-proof-carol.png` |
| 9 | dan_zaman | `ls -l /srv/app_zaman/secrets/` | shows filenames | `a1-proof-dan.png` |
| 10 | dan_zaman | `cat /srv/app_zaman/secrets/db-password.txt` | Permission denied | `a1-proof-dan.png` |
| 11 | dan_zaman | `echo x >> /srv/app_zaman/src/main.js` | Permission denied | `a1-proof-dan.png` |
| 12 | dan_zaman | `sudo systemctl restart myapp_zaman` | refused | `a1-proof-dan.png` |

Supporting screenshots:

| File | Shows |
| --- | --- |
| `a1-task1-users-perms.png` | groups, users, directory ownership and modes |
| `a1-task2-dan-cannot-cat.png` | dan listing but not reading the secrets file |
| `a1-task3-carol-cannot-delete.png` | carol blocked by the immutable attribute, with `lsattr` |
| `a1-task4-alice-limited-sudo.png` | alice restarting the service, refused on `apt` and `su` |

### Problems hit along the way

- Port 3100 was already taken by another candidate's node process on this shared VPS
  (`ss -lntp | grep 3100`), so the service sat in `activating` and auto-restarted. Moved
  to 3110. Ports 8110 and 9190 were also taken; nginx will use 8111.
- `EXAM_TOKEN` was empty after `su - <user>` because the export only existed in root's
  `.bashrc`. Fixed by appending the literal token to each user's `.bashrc` - with single
  quotes, since the first attempt used double quotes and root's shell expanded the empty
  variable into `export EXAM_TOKEN=""`.

---

## A2 - Who is using my port?

Ports 8080 and 9090 from the brief are already taken on this shared VPS, so this section
uses **8180** and **9191**, per the convention table in the root README.

### Task 5 - Identify the process

Nobody hands you the PID; the port is all you start with, so the first step is turning
one into the other:

```bash
PID=$(ss -lptnH 'sport = :8180' | grep -oP 'pid=\K[0-9]+' | head -1)
```

| Question | Answer | How |
| --- | --- | --- |
| Which PID holds it | `1864110` | `ss -lptn 'sport = :8180'` |
| Which program | `/usr/bin/python3.12` | `readlink -f /proc/$PID/exe` |
| Which user | `root` | `ps -o user= -p $PID` |
| Started when | `Sun Sep 20 15:31:54 2026` | `ps -o lstart= -p $PID` |
| Full command line | `python3 -m http.server 8180` | `tr '\0' ' ' < /proc/$PID/cmdline` |
| Working directory | `/root` | `readlink -f /proc/$PID/cwd` |

`/proc/$PID/exe` rather than the `ps` output on purpose. `ps` shows the command line,
which a process can rewrite; `exe` is a kernel symlink to the actual binary on disk and
cannot be faked from inside the process. For an unknown process on an inherited server
that distinction matters.

`cwd` is not in the brief's list but answers the next question anyone would ask: a
`python3 -m http.server` is serving *some* directory, and this one is serving `/root`.

### Task 6 - The permission difference

Run as an unprivileged user and as root:

```
=== as alice_zaman ===
LISTEN  0  5  0.0.0.0:8180  0.0.0.0:*
-- lsof as alice_zaman --
(printed nothing)

=== as root ===
LISTEN  0  5  0.0.0.0:8180  0.0.0.0:*  users:(("python3",pid=1864110,fd=3))
-- lsof as root --
python3  1864110  root  3u  IPv4  325475426  0t0  TCP *:8180 (LISTEN)
```

alice sees **that** the port is taken but not **by what**. The Process column is blank and
`lsof` prints nothing at all, not even a header.

The reason is that these are two different lookups wearing one command. The listening
socket itself is public information — the kernel exposes every socket in `/proc/net/tcp`,
readable by anyone. Attaching a socket to a *process* is a second step: the tool walks
`/proc/<pid>/fd/` for every process looking for a descriptor with a matching inode, and
that directory is readable only by the process owner and root. alice can enumerate
sockets and can enumerate PIDs; she cannot join the two.

This is deliberate, not an oversight. Process-to-port mapping tells you what software is
running, on which port, as whom — reconnaissance an unprivileged account has no need for.

One wrinkle worth recording, because it made the first attempt meaningless: I was logged
in as root, so running the commands "without sudo" and "with sudo" gave identical output.
`sudo` cannot elevate someone who is already root. Demonstrating the difference required
a genuinely unprivileged user, which is what `alice_zaman` from A1 is for.

### Task 7 - Decide and act

**Started manually, from a login shell.** Three independent signals agree:

```
PID      PPID     USER   CMD
1864110  1710263  root   python3 -m http.server 8180
parent : -bash

-- cgroup --
0::/user.slice/user-0.slice/session-37276.scope

-- systemctl status 1864110 --
session-37276.scope - Session 37276 of User root
  Loaded: loaded (/run/systemd/transient/session-37276.scope; transient)
  Transient: yes

-- cron --
none
```

- The parent is `-bash`. A systemd service is parented by PID 1; a cron job by `CRON`.
- The cgroup is `user.slice/.../session-37276.scope`, the slice systemd puts interactive
  logins in. A managed service lives under `system.slice/<name>.service`.
- `systemctl status <pid>` does resolve to a unit, which is easy to misread as "systemd
  started it". It did not: the unit is a **transient scope** systemd created to track a
  login session. `Transient: yes` is the word that settles it — nothing on disk defines
  this, and it disappears when the session ends.
- No cron file mentions the port.

**If it had been a systemd service, what would `kill -9 <pid>` do?**

The process would die and the port would be free for roughly a second. Then systemd's
`Restart=` would start a replacement, which would bind the same port, and you would be
looking at a fresh PID holding 8180 wondering whether the kill worked. Worse, `Restart=`
counts that as a failure, so repeated kills eventually trip `StartLimitBurst` and leave
the unit `failed` — an outage caused by the attempt to free a port.

The right sequence for a service is `systemctl stop <unit>` so systemd stops supervising
it, then `systemctl disable <unit>` if it should not come back at the next boot.

Here it was a plain process, so plain `SIGTERM` was correct:

```
kill 1864110
port 8180: FREE
```

`kill` and not `kill -9`: SIGTERM lets the process close listeners and flush state.
SIGKILL cannot be caught, so the process gets no chance to shut down cleanly, and its
socket can linger in `TIME_WAIT` and refuse the next bind.

### Task 8 - The remote access problem

My own server on 8180, bound only to loopback:

```
-- where is it actually listening? --
LISTEN  0  5  127.0.0.1:8180  0.0.0.0:*  users:(("python3",pid=1900187,fd=3))

-- from the server, via loopback --
  127.0.0.1:8180      -> 200
-- from the server, via its own public IP --
  169.58.246.108:8180 -> connection refused
```

From my laptop:

```
* connect to 169.58.246.108 port 8180 failed: Connection refused
curl: (7) Failed to connect to 169.58.246.108 port 8180 after 3302 ms
```

The `ss` line is the whole explanation: `127.0.0.1:8180`, not `0.0.0.0:8180`. The socket
is bound to the loopback interface only, so packets arriving on the public interface have
nothing to be delivered to — even packets the server sends to its own public address, as
the third line shows.

#### Timed out versus connection refused

| | What happened on the wire | What it rules out |
| --- | --- | --- |
| **Connection refused** | The SYN arrived and the kernel answered with RST | Routing and firewalls are fine. Nothing is listening *on that interface and port* |
| **Timed out** | Nothing came back at all | Something is silently discarding packets: a firewall `DROP`, a security group, wrong routing, or the wrong host entirely |

They point in opposite directions, and reading one as the other wastes hours.

**Refused** means the packet reached the machine and the machine said no — so stop
checking firewalls and run `ss -lntp` on the server. Usually the process is not running,
is on a different port, or is bound to `127.0.0.1` as it was here.

**Timed out** means nothing answered, so the server may not even have seen the request.
Look at what sits between: firewall rules, cloud security groups, routing. Task 54 in
Scenario C is the same distinction one layer up — `curl` returning `000` there meant no
connection at all, while `400` meant the application had received the request and
declined it.

Refused is the better news of the two: it proves the path works.

### Evidence

| File | Shows |
| --- | --- |
| `a2-task5-identify.png` | PID discovered from the port, then binary, user, start time, command line and cwd |
| `a2-task6-permissions.png` | the same commands as `alice_zaman` and as root, side by side |
| `a2-task7-decide-and-kill.png` | parent `-bash`, the session scope cgroup, `Transient: yes`, no cron, and the port free after SIGTERM |
| `a2-task8-remote-access.png` | bound to `127.0.0.1`, 200 over loopback, refused over the public IP, and the same refusal from my laptop |

---

## A3 - A bash script you would actually use

Script: [`configs/healthcheck.sh`](configs/healthcheck.sh) · Config:
[`configs/checks.conf`](configs/checks.conf) · Log: `/var/log/healthcheck_zaman.log`

### Task 9 - The script

```
healthcheck  config=./checks.conf  2026-09-20 19:51:51

  notes-api-swarm        OK    200 in 0.06s
  notes-api-ready        OK    200 in 0.54s
  myapp-a1               OK    200 in 0.17s
  notes-api-wrongcode    FAIL  expected 418, got 200 after 0.02s
  nginx                  FAIL  expected 200, got 000 after 0.09s

  disk /                 OK    33% used (32G of 96G)

summary  3 passed, 2 failed
exit code: 1
```

Two of those failures are deliberate and they fail differently on purpose:
`notes-api-wrongcode` points at a healthy endpoint with the wrong expected code, and
`nginx` points at port 8111 where nothing listens yet. One is a monitoring mistake and the
other is a real outage, and the report has to be able to tell them apart.

#### The seven requirements, and the decisions behind four of them

| # | Requirement | How |
| --- | --- | --- |
| 1 | Config path as argument, default `./checks.conf` | `CONFIG="${1:-./checks.conf}"` |
| 2 | Skip blanks and comments | trimmed, then `[[ -z ]]` and `[[ == \#* ]]` |
| 3 | curl, 3 second timeout, check the code | `curl -s -o /dev/null -m 3 -w '%{http_code}'` |
| 4 | Warn if `/` is over 80% | `df -P /`, compared against `DISK_WARN_PCT` |
| 5 | Coloured summary, detail to the log | ANSI only on a terminal; timestamped lines appended |
| 6 | Exit 0 / 1 / 2 | 2 before anything runs, 1 if any check failed |
| 7 | Not twice at once | `flock -n` on a held file descriptor |

The four that are not obvious:

**No `set -e`.** A failing curl is the case this script exists to report. With `-e` the run
aborts at the first failure, and a summary printed after checking two of five services
looks exactly like a pass. The shell's habit of treating any non-zero as fatal is wrong
for a program whose job is to collect non-zeros.

**`flock` on a file descriptor, not a PID file.** `exec 9>"$LOCK_FILE"` then `flock -n 9`.
The lock is held by the descriptor, and **the kernel releases it when the process dies,
however it dies** - crash, `kill -9`, the box rebooting mid-run. A PID file has to be
cleaned up by the process that wrote it, so a run killed at the wrong moment leaves one
behind and every later run exits thinking a copy is still going. A monitoring script that
silently stops monitoring is worse than no monitoring script.

The second copy exits **0**, not 1. It did not fail; it declined to duplicate work. Exiting
non-zero would mail cron an error every five minutes during exactly the slow period when
the operator is already busy.

**Colour only when `[[ -t 1 ]]`.** Under cron stdout is a pipe into a mail spool or a
file, and escape codes land there as literal `^[[0;32m`. The test asks whether a terminal
is attached rather than assuming.

**Disk warns, it does not fail.** A full disk is a real problem and not "a service is
down". Folding both into exit 1 would produce an alert that cannot say which happened, so
the disk line reports `WARN` and leaves the exit code to the service checks.

#### Two details in the checking itself

`curl -m 3` bounds the **whole request**, not just the connection. A server that accepts
the connection and then never answers - the hung-but-alive case A4 Task 15 is about - is
covered by `-m` and would not be by `--connect-timeout` alone.

A code of `000` is recorded as distinct from every HTTP status, because curl returning no
response at all is a different problem from returning the wrong one. `000` means refused,
unresolvable, or timed out; `418` means something answered and disagreed. The log keeps
both as they are rather than flattening them to "failed", which is the same distinction
A2 Task 8 and C2 Task 54 both turned on.

### Task 10 - Break it on purpose

Both cases behaved correctly first time, because requirements 3 and 6 exist precisely to
anticipate them. What is worth recording is what each guard is holding back.

**1. A config file that does not exist**

```
$ ./healthcheck.sh /does/not/exist.conf
FATAL config file missing or unreadable: /does/not/exist.conf
exit code: 2   (expected 2)
```

The check is `[[ ! -f ... || ! -r ... ]]` before anything else runs, and it logs before
exiting so the failure is visible to whoever reads the log rather than only to whoever ran
the command.

Without it the `while read` loop would simply read nothing, report zero checks, and exit
**0** - a monitoring script announcing that everything is fine because it looked at
nothing. That is the failure mode the separate exit code exists to prevent, and it is why
"config unusable" is a different number from "a service is down".

**2. A URL that does not resolve at all**

Added `bad|http://doesnotexist.invalid/|200`:

```
  bad                    FAIL  expected 200, got 000 after 0.02s
summary  3 passed, 3 failed
real  0m0.879s
exit code: 1   (expected 1, and it must not hang)
```

No hang, no crash, and the whole run still finished in under a second. DNS failed fast
here, but `-m 3` is what makes the bound guaranteed rather than lucky - a host that
resolves and then black-holes packets would sit there indefinitely without it, and with
twenty such entries a run could outlast the five-minute cron interval entirely.

**3. A malformed line** - not asked for, added because a config file edited by hand will
eventually contain one:

```
  this line has no pipes at all MALFORMED  this line has no pipes at all
summary  3 passed, 4 failed
```

Counted as a failure and reported with the offending text, rather than being skipped
silently or crashing on an unbound variable. A silently ignored config line is how a
service stops being monitored without anyone noticing.

**What I changed:** nothing in the script. Both required cases passed on the first
attempt, and saying otherwise would be inventing a struggle. The malformed-line handling
was written in from the start for the same reason - a config file is input, and input is
untrusted even when you wrote it yourself.

### Task 11 - In cron

```
*/5 * * * * /root/arraytics-devops-exam/scenario-a/configs/healthcheck.sh \
            /root/arraytics-devops-exam/scenario-a/configs/checks.conf >/dev/null 2>&1
```

Two runs, five minutes apart, both triggered by cron:

```
2026-09-20T19:55:06+0200 RUN started, config=/root/arraytics-devops-exam/.../checks.conf
2026-09-20T20:00:01+0200 RUN started, config=/root/arraytics-devops-exam/.../checks.conf
```

**How you can tell cron ran them and I did not.** The log records the config path it was
given. Cron passes an absolute path; my manual runs passed `./checks.conf` from inside the
directory. The two are distinguishable in the log without trusting the timestamps or my
word for it - which is the kind of thing worth building in before you need it.

Absolute paths in the crontab line for the same reason everything else about cron needs
them: cron does not run from your home directory and does not read your shell profile.
`./healthcheck.sh` in a crontab is a file not found.

#### Timings under cron are visibly worse

```
19:55:22  OK  notes-api-ready  ... time=2.29s
20:00:05  OK  notes-api-swarm  ... time=2.89s
```

Against 0.06-0.54s when run by hand. The cause is on the crontab itself - see below - and
it is a good argument for the 3 second timeout: at 2.89s one of these was half a second
from being reported as a failed service when nothing was wrong with it.

#### The crontab is shared, and that is a hazard

`crontab -l` on this VPS returns **four candidates' entries in one file**, because root's
crontab is shared like everything else here:

```
*/5 * * * * /srv/app/scripts/healthcheck.sh ...                        # abdur
*/5 * * * * /srv/ashik/app/scenario-a/configs/healthcheck.sh ...       # ashik
*/5 * * * * /root/exam-repo/scenario-a/configs/healthcheck.sh ...      # someone else
*/5 * * * * /root/arraytics-devops-exam/... ...                        # mine
```

Two consequences.

**Mine was installed with `crontab -l | { cat; echo NEW; } | crontab -`**, which preserves
what is already there. `crontab -e`, the command everyone reaches for, opens the whole
shared file - and anyone who pastes their own line over the contents deletes three other
people's work without a confirmation prompt. This is the same shape as B4, where
`docker stack deploy ... notes` would have replaced a stranger's running service because
Swarm treats a name collision as an update.

**Four healthcheck scripts now fire at the same instant**, every five minutes, each opening
several connections. That is the 2.89s above: the machine is not slow, it is briefly busy
with everyone's monitoring at once. Real systems hit this too, which is why staggering
(`*/5` versus `1-59/5`) or a random initial delay exists - the failure mode is a
monitoring fleet that synchronises and becomes the load spike it was meant to observe.

### Evidence

| File | Shows |
| --- | --- |
| `a3-task9-script-run.png` | the coloured report with passing and failing services, the disk line, and `exit code: 1` |
| `a3-task9-lock.png` | two copies started together, one summary printed, `SKIP another run still in progress` in the log |
| `a3-task10-break-tests.png` | `exit 2` on a missing config, `000` on an unresolvable host with the run still finishing in 0.879s, and a malformed line counted rather than crashing |
| `a3-task11-cron.png` | the crontab entry and two cron-triggered runs at 19:55:06 and 20:00:01 |
