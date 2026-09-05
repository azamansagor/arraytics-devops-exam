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
