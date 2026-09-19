#!/bin/sh
set -eu

SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"

# The Docker socket on Linux is usually root:docker 0660, and the host docker
# group's GID is not guaranteed to match a group inside this image.  At startup
# (while PID 1 is root), add the unprivileged node user to the socket's actual
# group, then drop privileges before starting MEDIARR.
if [ -S "$SOCKET" ]; then
  GID="$(stat -c '%g' "$SOCKET" 2>/dev/null || true)"
  if [ -n "$GID" ]; then
    GROUP="$(getent group "$GID" 2>/dev/null | cut -d: -f1 || true)"
    if [ -z "$GROUP" ]; then
      GROUP="dockersock"
      groupadd -g "$GID" "$GROUP" 2>/dev/null || true
      GROUP="$(getent group "$GID" 2>/dev/null | cut -d: -f1 || echo dockersock)"
    fi
    usermod -aG "$GROUP" node 2>/dev/null || true
  fi
fi

exec gosu node "$@"