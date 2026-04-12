#!/bin/sh
set -e

REALM="${TURN_REALM:-tortok.video}"
PORT="${TURN_PORT:-3478}"
SECRET="${TURN_SECRET:-changeme}"
MIN_PORT="${TURN_MIN_PORT:-49152}"
MAX_PORT="${TURN_MAX_PORT:-49200}"

# Detect Fly.io external IP
EXTERNAL_IP="${FLY_PUBLIC_IP:-$(hostname -i 2>/dev/null || echo '0.0.0.0')}"

cat > /tmp/turnserver.conf <<EOF
listening-port=${PORT}
tls-listening-port=5349
min-port=${MIN_PORT}
max-port=${MAX_PORT}
realm=${REALM}
use-auth-secret
static-auth-secret=${SECRET}
no-cli
no-tcp-relay
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
no-multicast-peers
fingerprint
lt-cred-mech
external-ip=${EXTERNAL_IP}
log-file=stdout
EOF

echo "Starting coturn on port ${PORT}, realm ${REALM}, external IP ${EXTERNAL_IP}"
exec turnserver -c /tmp/turnserver.conf
