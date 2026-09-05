#!/usr/bin/env bash
# Scenario A / A1 — team access model.
# Run on the VPS as root:   bash a1-setup.sh
#
# Access model:
#   devs    (alice, bob) : edit src, read logs, restart myapp
#   ops     (carol)      : everything devs can do + edit config + read secrets
#   auditor (dan)        : read-only under /srv/app; may LIST secrets, never READ them
set -euo pipefail

echo "== 1. groups =="
for g in devs ops auditor; do
  getent group "$g" >/dev/null || groupadd "$g"
done

echo "== 2. users =="
# $1 = username, $2 = primary group, $3 = optional comma list of extra groups
mkuser() {
  id -u "$1" >/dev/null 2>&1 || useradd -m -s /bin/bash -g "$2" "$1"
  usermod -g "$2" "$1"
  [ -n "${3:-}" ] && usermod -aG "$3" "$1"
  return 0
}
mkuser alice devs
mkuser bob   devs
mkuser carol ops devs      # carol needs everything devs can do, so devs is a secondary group
mkuser dan   auditor

echo "== 3. directory layout =="
mkdir -p /srv/app/{src,config,secrets,logs,backups}
chown root:root /srv/app
chmod 755 /srv/app          # everyone can traverse into /srv/app

# src: devs (and carol via devs) write; everyone else reads.
# 2775 -> setgid, so files created here inherit group 'devs' automatically.
chown root:devs /srv/app/src
chmod 2775      /srv/app/src

# config: only ops writes; devs and auditor read.
chown root:ops /srv/app/config
chmod 2775     /srv/app/config

# logs: devs write (the app appends), everyone reads.
chown root:devs /srv/app/logs
chmod 2775      /srv/app/logs

# secrets: ops only. 750 means "others" (alice, bob, dan) get NOTHING here.
# dan is granted list access separately, by ACL, in step 5.
chown root:ops /srv/app/secrets
chmod 750      /srv/app/secrets

# backups: carol owns it and can write in it, but see step 6 for why she still
# cannot delete the files.  3775 = setgid + sticky bit.
chown carol:ops /srv/app/backups
chmod 3775      /srv/app/backups

echo "== 4. seed files =="
[ -f /srv/app/src/main.js ]              || echo "// app entrypoint"        > /srv/app/src/main.js
[ -f /srv/app/config/app.conf ]          || echo "port=3000"                > /srv/app/config/app.conf
[ -f /srv/app/logs/app.log ]             || echo "app started"              > /srv/app/logs/app.log
[ -f /srv/app/secrets/db-password.txt ]  || echo "S3cr3t-Fake-Passw0rd!"    > /srv/app/secrets/db-password.txt
chown root:devs /srv/app/src/main.js  /srv/app/logs/app.log
chmod 664       /srv/app/src/main.js  /srv/app/logs/app.log
chown root:ops  /srv/app/config/app.conf
chmod 664       /srv/app/config/app.conf
chown root:ops  /srv/app/secrets/db-password.txt
chmod 640       /srv/app/secrets/db-password.txt   # ops reads it; nobody else can

for i in 1 2 3; do
  f=/srv/app/backups/backup${i}.tar
  [ -f "$f" ] || tar -cf "$f" -C /srv/app src 2>/dev/null || : > "$f"
  chown root:ops "$f"
  chmod 644      "$f"
done

echo "== 5. ACL: dan may LIST the secrets folder but not READ the file =="
command -v setfacl >/dev/null || { apt-get update -qq && apt-get install -y -qq acl; }
# r = read the directory (see the filenames)
# x = search the directory (stat each entry, so 'ls -l' can print mode/size)
# No ACL is placed on db-password.txt itself, so the file stays -rw-r----- root:ops
# and dan, who is not in 'ops', is refused when he tries to read it.
setfacl -m g:auditor:r-x /srv/app/secrets

echo "== 6. carol must not be able to delete the backups =="
# The sticky bit alone is NOT enough here: under a sticky directory the
# DIRECTORY OWNER may still delete files, and carol owns /srv/app/backups.
# So the files themselves are made immutable.  Even root gets EPERM until the
# attribute is cleared with 'chattr -i', which is exactly the protection we want.
if chattr +i /srv/app/backups/backup1.tar 2>/dev/null; then
  chattr +i /srv/app/backups/backup2.tar /srv/app/backups/backup3.tar
  echo "   immutable bit set (see: lsattr /srv/app/backups/)"
else
  echo "   !! chattr failed - filesystem does not support the immutable attribute."
  echo "   !! Record this in INCOMPLETE.md and fall back to the sticky bit only."
fi

echo "== 7. dedicated service account for myapp =="
id -u myappuser >/dev/null 2>&1 || \
  useradd --system --no-create-home --shell /usr/sbin/nologin myappuser

echo "== 8. limited sudo for restarting myapp =="
install -m 0644 /dev/stdin /etc/sudoers.d/myapp-restart <<'SUDOERS'
# alice, bob (devs) and carol (ops) may control ONLY the myapp unit.
# No shell, no package manager, no editor, no wildcards.
Cmnd_Alias MYAPP_CTL = /usr/bin/systemctl restart myapp, \
                       /usr/bin/systemctl start myapp,   \
                       /usr/bin/systemctl stop myapp,    \
                       /usr/bin/systemctl status myapp,  \
                       /usr/bin/systemctl is-active myapp
%devs ALL=(root) NOPASSWD: MYAPP_CTL
%ops  ALL=(root) NOPASSWD: MYAPP_CTL
SUDOERS
visudo -cf /etc/sudoers.d/myapp-restart

echo "== 9. placeholder myapp.service (replaced by the real app in A4) =="
install -m 0644 /dev/stdin /etc/systemd/system/myapp.service <<'UNIT'
[Unit]
Description=myapp (A1 placeholder - replaced with the real Node app in A4)
After=network-online.target
Wants=network-online.target

[Service]
User=myappuser
Group=myappuser
WorkingDirectory=/srv/app
ExecStart=/usr/bin/python3 -m http.server 3000 --bind 127.0.0.1
Restart=on-failure
SyslogIdentifier=myapp

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now myapp
systemctl --no-pager --full status myapp | head -5

echo
echo "== done. verify with: bash a1-proof.sh all =="
