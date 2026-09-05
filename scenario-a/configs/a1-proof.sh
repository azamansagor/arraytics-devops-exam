#!/usr/bin/env bash
# Scenario A / A1 — the 12 proof checks.
# Run on the VPS as root:  bash a1-proof.sh alice | carol | dan | all
# Prints the exam token + date first, so the whole screenshot is valid evidence.

: "${EXAM_TOKEN:?EXAM_TOKEN is not set - run: source ~/.bashrc}"

hdr() {
  echo
  echo "=================================================================="
  echo "$EXAM_TOKEN | $(date)"
  echo "A1 proof - $1"
  echo "=================================================================="
}

# $1 = check number, $2 = user, $3 = command, $4 = what we expect
chk() {
  echo
  echo "--- [$1] as $2: $3"
  echo "    expected: $4"
  su - "$2" -c "$3" 2>&1 | sed 's/^/    /'
  echo "    exit=${PIPESTATUS[0]}"
}

alice_checks() {
  hdr "alice + bob (devs)"
  chk 1 alice 'echo test >> /srv/app/src/main.js && tail -1 /srv/app/src/main.js' 'works'
  chk 2 alice 'cat /srv/app/logs/app.log'                                        'works'
  chk 3 alice 'sudo -n systemctl restart myapp && sudo -n systemctl is-active myapp' 'works'
  chk 4 alice 'cat /srv/app/secrets/db-password.txt'                              'Permission denied'
  chk 5 alice 'sudo -n apt update'                                                'refused by sudo'
}

carol_checks() {
  hdr "carol (ops)"
  chk 6 carol 'echo x >> /srv/app/config/app.conf && tail -1 /srv/app/config/app.conf' 'works'
  chk 7 carol 'cat /srv/app/secrets/db-password.txt'                              'works'
  chk 8 carol 'rm -f /srv/app/backups/backup1.tar'                                'fails - Operation not permitted'
  echo
  echo "    context: carol owns the directory, yet cannot delete -"
  ls -ld /srv/app/backups | sed 's/^/    /'
  lsattr /srv/app/backups/ 2>/dev/null | sed 's/^/    /'
}

dan_checks() {
  hdr "dan (auditor)"
  chk  9 dan 'ls -l /srv/app/secrets/'                'filenames visible'
  chk 10 dan 'cat /srv/app/secrets/db-password.txt'   'Permission denied'
  chk 11 dan 'echo x >> /srv/app/src/main.js'         'Permission denied'
  chk 12 dan 'sudo -n systemctl restart myapp'        'refused - dan is not a sudoer'
}

case "${1:-all}" in
  alice|bob) alice_checks ;;
  carol)     carol_checks ;;
  dan)       dan_checks   ;;
  all)       alice_checks; carol_checks; dan_checks ;;
  *) echo "usage: $0 [alice|carol|dan|all]"; exit 2 ;;
esac

echo
echo "--- permission model as configured ---"
ls -ld /srv/app /srv/app/*
echo
getfacl -p /srv/app/secrets 2>/dev/null
echo
for u in alice bob carol dan; do id "$u"; done
