#!/usr/bin/env bash
# Exam token: root-vmi3536696-1788597274-30dab396
#
# Forced command for the GitHub Actions deploy key. Installed on the VPS at
# /usr/local/bin/zaman-deploy.sh and named in ~/.ssh/authorized_keys as:
#
#   command="/usr/local/bin/zaman-deploy.sh",no-agent-forwarding,\
#   no-port-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-actions-deploy
#
# With command= set, sshd ignores whatever the client asked to run and executes
# this instead, putting the client's request in SSH_ORIGINAL_COMMAND. So the key
# cannot open a shell, cannot read a file, cannot forward a port, and cannot touch
# any service but the one named below - whatever the caller sends.
#
# That matters because the private half lives in a GitHub secret. A plain root key
# there would mean anyone who can run a workflow in this repository owns the whole
# machine, including six other candidates' stacks. This key can move one service
# to one image in one registry.

set -euo pipefail

SERVICE="zaman_notes_app"
IMAGE_REPO="ghcr.io/azamansagor/notes-api-zaman"
LOG="/var/log/zaman-deploy.log"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" | tee -a "$LOG"; }

REQUESTED="${SSH_ORIGINAL_COMMAND:-}"
# Take the last whitespace-separated word, so the caller may send a bare sha or
# something conversational; only the sha is ever used.
TAG="${REQUESTED##* }"

# The whitelist. A 40 character lowercase hex sha and nothing else - no tags, no
# `latest`, no shell metacharacters, nothing that could carry a second command
# through into the docker invocation below.
if [[ ! "$TAG" =~ ^[0-9a-f]{40}$ ]]; then
  log "REFUSED not a commit sha: '${REQUESTED}'"
  echo "refused: expected a 40-character commit sha, got '${REQUESTED}'" >&2
  exit 2
fi

log "DEPLOY $SERVICE -> $IMAGE_REPO:$TAG"

# --detach=false so ssh does not return until Swarm has converged or given up.
# Detached, the deploy step would go green the moment the API accepted the
# request, which is before a single replica has been replaced - the same trap as
# wait-for-service-stability in the AWS pipeline.
if docker service update \
      --image "${IMAGE_REPO}:${TAG}" \
      --detach=false \
      "$SERVICE"; then
  log "OK deploy converged"
  docker service ps "$SERVICE" --filter desired-state=running \
    --format "table {{.Name}}\t{{.Image}}\t{{.CurrentState}}"
  exit 0
fi

log "FAIL deploy did not converge; swarm keeps the previous version running"
exit 1
