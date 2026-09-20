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
