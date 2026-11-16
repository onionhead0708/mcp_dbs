#!/bin/sh
# Starts (or stops) the throwaway SSH + Postgres pair for test/ssh.integration.test.js.
#
#   scripts/ssh-test-env.sh up <dir>     # writes keys, known_hosts and env.sh into <dir>
#   . <dir>/env.sh && npm test
#   scripts/ssh-test-env.sh down
#
# Postgres is reachable only from inside the Docker network, as a database
# behind a bastion would be. Every key and password here is throwaway.
set -eu
NET=mcpdbs-tunnel-net
SSHD=mcpdbs-tunnel-sshd
PG=mcpdbs-tunnel-pg
PORT=${SSH_TEST_PORT:-52222}

if [ "${1:-}" = "down" ]; then
  docker rm -f "$SSHD" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  exit 0
fi
[ "${1:-}" = "up" ] && [ -n "${2:-}" ] || { echo "usage: $0 up <dir> | down" >&2; exit 2; }
DIR=$(cd "$2" && pwd)

ssh-keygen -q -t ed25519 -N 'tunnel test passphrase' -C mcp-dbs-test -f "$DIR/id_encrypted"
ssh-keygen -q -t ed25519 -N '' -C mcp-dbs-test -f "$DIR/id_plain"
cat "$DIR/id_encrypted.pub" "$DIR/id_plain.pub" > "$DIR/authorized_keys"

docker network create "$NET" >/dev/null
docker run -d --rm --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=tunnel-pg-pw postgres:16-alpine >/dev/null
docker run -d --rm --name "$SSHD" --network "$NET" -p "127.0.0.1:$PORT:22" \
  -v "$DIR/authorized_keys:/keys/authorized_keys:ro" alpine:3.20 sh -c '
    apk add --no-cache openssh-server >/dev/null &&
    ssh-keygen -A >/dev/null &&
    adduser -D tester && sed -i "s/^tester:!/tester:*/" /etc/shadow &&
    mkdir -p /home/tester/.ssh && cp /keys/authorized_keys /home/tester/.ssh/ &&
    chown -R tester /home/tester/.ssh && chmod 700 /home/tester/.ssh && chmod 600 /home/tester/.ssh/authorized_keys &&
    exec /usr/sbin/sshd -D -e -o AllowTcpForwarding=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no' >/dev/null

i=0
until ssh-keyscan -p "$PORT" -t ed25519 127.0.0.1 > "$DIR/known_hosts" 2>/dev/null && [ -s "$DIR/known_hosts" ]; do
  i=$((i + 1)); [ $i -gt 60 ] && { echo "sshd did not come up" >&2; docker logs "$SSHD" >&2; exit 1; }; sleep 1
done
i=0
until docker exec "$PG" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 60 ] && { echo "postgres did not come up" >&2; exit 1; }; sleep 1
done
chmod 600 "$DIR/id_encrypted" "$DIR/id_plain"
cat > "$DIR/env.sh" <<ENV
export SSH_TEST_PORT=$PORT
export SSH_TEST_DIR='$DIR'
export SSH_TEST_PASSPHRASE='tunnel test passphrase'
export SSH_TEST_DB_HOST=$PG
export SSH_TEST_DB_PASSWORD=tunnel-pg-pw
ENV
echo "ready: . $DIR/env.sh"
