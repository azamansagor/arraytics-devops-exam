#!/usr/bin/env bash
# Exam token: root-vmi3536696-1788597274-30dab396
#
# healthcheck.sh - check every service listed in a config file, print a summary,
# and append the detail to a log.
#
#   ./healthcheck.sh [config-file]        default: ./checks.conf
#
# Exit codes:
#   0  everything passed
#   1  at least one service failed
#   2  the config file is missing or unreadable
#
# Note there is no `set -e`. A failing curl is the normal case this script exists
# to report, and -e would abort the run on the first one - checking nine services
# and stopping at the second is worse than useless, because the summary would
# look like a pass.

set -uo pipefail

CONFIG="${1:-./checks.conf}"
LOG_FILE="${HEALTHCHECK_LOG:-/var/log/healthcheck_zaman.log}"
LOCK_FILE="${HEALTHCHECK_LOCK:-/var/lock/healthcheck_zaman.lock}"
CURL_TIMEOUT=3
DISK_WARN_PCT=80

# ---------------------------------------------------------------------------
# Only colour when a human is watching.
#
# cron pipes stdout into a mail spool or a file, and escape codes there become
# literal ^[[0;32m in whatever reads the log next. -t 1 asks the shell whether
# stdout is a terminal, which is the difference between the two cases.
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'
  BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; BOLD=''; RESET=''
fi

log() {
  # A log line nobody can write is not worth killing the run over, so failures
  # here are swallowed - the terminal summary still gets printed.
  printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# ---------------------------------------------------------------------------
# One at a time.
#
# cron does not care that the previous run is still going. If a URL is timing
# out at 3 seconds and there are twenty of them, a run can outlast the five
# minute interval and copies start piling up, each holding connections open -
# which makes the thing being monitored slower.
#
# flock on a file descriptor rather than a PID file, because the kernel releases
# it when the process dies however it dies. A PID file written by a process that
# was then killed -9 stays behind and blocks every later run forever.
# ---------------------------------------------------------------------------
exec 9>"$LOCK_FILE" 2>/dev/null || {
  echo "${RED}FATAL${RESET} cannot open lock file: $LOCK_FILE" >&2
  exit 2
}
if ! flock -n 9; then
  log "SKIP another run still in progress, exiting quietly"
  exit 0
fi

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
if [[ ! -f "$CONFIG" || ! -r "$CONFIG" ]]; then
  echo "${RED}FATAL${RESET} config file missing or unreadable: ${BOLD}${CONFIG}${RESET}" >&2
  log "FATAL config file missing or unreadable: $CONFIG"
  exit 2
fi

log "RUN started, config=$CONFIG"
echo "${BOLD}healthcheck${RESET}  config=${CONFIG}  $(date '+%Y-%m-%d %H:%M:%S')"
echo

failed=0
passed=0

while IFS= read -r line || [[ -n "$line" ]]; do
  line="$(trim "$line")"
  [[ -z "$line" ]] && continue          # blank lines
  [[ "$line" == \#* ]] && continue      # comments

  IFS='|' read -r name url expected <<< "$line"
  name="$(trim "${name:-}")"
  url="$(trim "${url:-}")"
  expected="$(trim "${expected:-}")"

  if [[ -z "$name" || -z "$url" || -z "$expected" ]]; then
    printf '  %-22s %sMALFORMED%s  %s\n' "${name:-?}" "$RED" "$RESET" "$line"
    log "MALFORMED line: $line"
    failed=$((failed + 1))
    continue
  fi

  # -m covers the whole request, not just the connect, so a server that accepts
  # the connection and then never answers is bounded too. A code of 000 means
  # curl got no HTTP response at all - refused, unresolvable, or timed out.
  start=$(date +%s.%N)
  code="$(curl -s -o /dev/null -m "$CURL_TIMEOUT" -w '%{http_code}' "$url" 2>/dev/null)"
  [[ -z "$code" ]] && code="000"
  elapsed="$(awk -v s="$start" -v e="$(date +%s.%N)" 'BEGIN{printf "%.2f", e-s}')"

  if [[ "$code" == "$expected" ]]; then
    printf '  %-22s %sOK%s    %s in %ss\n' "$name" "$GREEN" "$RESET" "$code" "$elapsed"
    log "OK   $name $url expected=$expected got=$code time=${elapsed}s"
    passed=$((passed + 1))
  else
    printf '  %-22s %sFAIL%s  expected %s, got %s after %ss\n' \
      "$name" "$RED" "$RESET" "$expected" "$code" "$elapsed"
    log "FAIL $name $url expected=$expected got=$code time=${elapsed}s"
    failed=$((failed + 1))
  fi
done < "$CONFIG"

# ---------------------------------------------------------------------------
# Disk
#
# A warning, not a failure. A full disk is a real problem but it is not "a
# service is down", and folding it into the same exit code would mean an alert
# that cannot tell you which of the two happened.
# ---------------------------------------------------------------------------
echo
disk_pct="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
disk_used="$(df -Ph / | awk 'NR==2 {print $3" of "$2}')"

if [[ -n "$disk_pct" ]] && (( disk_pct > DISK_WARN_PCT )); then
  printf '  %-22s %sWARN%s  %s%% used (%s), over %s%%\n' \
    "disk /" "$YELLOW" "$RESET" "$disk_pct" "$disk_used" "$DISK_WARN_PCT"
  log "WARN disk / at ${disk_pct}% ($disk_used), threshold ${DISK_WARN_PCT}%"
else
  printf '  %-22s %sOK%s    %s%% used (%s)\n' \
    "disk /" "$GREEN" "$RESET" "${disk_pct:-?}" "$disk_used"
  log "OK   disk / at ${disk_pct:-?}% ($disk_used)"
fi

# ---------------------------------------------------------------------------
echo
if (( failed > 0 )); then
  echo "${BOLD}summary${RESET}  ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}"
  log "DONE passed=$passed failed=$failed exit=1"
  exit 1
fi

echo "${BOLD}summary${RESET}  ${GREEN}${passed} passed${RESET}, 0 failed"
log "DONE passed=$passed failed=0 exit=0"
exit 0
