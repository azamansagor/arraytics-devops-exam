# SCENARIO A — Answers

> Exam token: `root-vmi3536696-1788597274-30dab396`

---

## A1 — Team access

### Access model

| Path | Owner:Group | Mode | Why |
| --- | --- | --- | --- |
| `/srv/app` | root:root | 755 | everyone can traverse in |
| `/srv/app/src` | root:devs | 2775 | devs write; setgid so new files stay in `devs` |
| `/srv/app/config` | root:ops | 2775 | only ops writes; devs + auditor read |
| `/srv/app/logs` | root:devs | 2775 | devs write, everyone reads |
| `/srv/app/secrets` | root:ops | 750 + ACL `g:auditor:r-x` | ops only, plus list-access for dan |
| `/srv/app/secrets/db-password.txt` | root:ops | 640 | ops reads, nobody else |
| `/srv/app/backups` | carol:ops | 3775 + `chattr +i` on files | carol owns it but cannot delete |

carol is in `ops` (primary) **and** `devs` (secondary), because the brief says she needs
everything devs can do plus more.

### Task 2 — why dan can list the folder but not read the file

<!-- TODO: rewrite this in your own words before submitting — the examiner will ask you
     to explain it live if it reads like it was pasted. -->

Draft to rewrite: directory permissions and file permissions are two separate checks.
An ACL entry of `r-x` on `/srv/app/secrets` lets dan read the directory's contents (the
list of names) and search it (`x`, so `ls -l` can `stat` each entry and print mode, owner
and size). None of that touches the file. When dan then runs `cat db-password.txt` the
kernel does a second, independent check against that file's own mode, `-rw-r-----
root:ops` — dan is not root and not in `ops`, so the "other" bits apply, and they are
empty. Result: he sees the name and metadata, never the bytes.

### Task 3 — why the sticky bit alone was not enough

The sticky bit on a directory restricts deletion to the file's owner, **the directory's
owner**, or root. carol *is* the directory owner, so sticky would still have let her
`rm`. The files are therefore made immutable with `chattr +i`, which makes `unlink`
return `EPERM` for everyone — including root — until the attribute is cleared.

### Task 4 — sudo scope

`/etc/sudoers.d/myapp-restart` grants `%devs` and `%ops` exactly five literal
`systemctl` commands against the `myapp` unit, with no wildcards, no shell and no
package manager. Because sudo matches the command line literally, even
`systemctl restart myapp.service` (with the `.service` suffix) is refused — only the
listed forms work.

### Evidence

| # | User | Command | Expected | File |
| --- | --- | --- | --- | --- |
| 1 | alice | `echo test >> /srv/app/src/main.js` | works | |
| 2 | alice | `cat /srv/app/logs/app.log` | works | |
| 3 | alice | `sudo systemctl restart myapp` | works | |
| 4 | alice | `cat /srv/app/secrets/db-password.txt` | Permission denied | |
| 5 | alice | `sudo apt update` | refused by sudo | |
| 6 | carol | `echo x >> /srv/app/config/app.conf` | works | |
| 7 | carol | `cat /srv/app/secrets/db-password.txt` | works | |
| 8 | carol | `rm -f /srv/app/backups/backup1.tar` | fails | |
| 9 | dan | `ls -l /srv/app/secrets/` | shows filenames | |
| 10 | dan | `cat /srv/app/secrets/db-password.txt` | Permission denied | |
| 11 | dan | `echo x >> /srv/app/src/main.js` | Permission denied | |
| 12 | dan | `sudo systemctl restart myapp` | refused | |
