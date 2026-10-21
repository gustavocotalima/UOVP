#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'This runner is CI-only.' >&2; exit 1; }
mkdir -p work
tls_dir=$(mktemp -d)
app_pid=''
proxy_pid=''
cleanup() {
  [[ -z "$proxy_pid" ]] || kill "$proxy_pid" 2>/dev/null || true
  [[ -z "$app_pid" ]] || kill "$app_pid" 2>/dev/null || true
  rm -rf "$tls_dir"
}
trap cleanup EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj '/CN=uovp-ci.test' -addext 'subjectAltName=DNS:uovp-ci.test' \
  -keyout "$tls_dir/key.pem" -out "$tls_dir/cert.pem" 2>/dev/null
pnpm start --hostname 127.0.0.1 >work/e2e-app.log 2>&1 &
app_pid=$!
node scripts/ci/https-proxy.mjs "$tls_dir/key.pem" "$tls_dir/cert.pem" >work/e2e-proxy.log 2>&1 &
proxy_pid=$!
ready=false
for attempt in {1..60}; do
  kill -0 "$app_pid" "$proxy_pid" 2>/dev/null || { cat work/e2e-*.log; exit 1; }
  if curl --insecure --fail --silent --output /dev/null https://uovp-ci.test:8443/login; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || { cat work/e2e-*.log; exit 1; }
pnpm cypress:run
