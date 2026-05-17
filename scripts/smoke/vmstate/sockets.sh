#!/usr/bin/env bash
# Vmstate socket smoke repros (#366).

set -euo pipefail
# shellcheck source=./common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

vmstate_smoke_init sockets

section "SOCKET-1 listening TCP accepts after restore with a fresh port forward"
TCP_GUEST_PORT=18080
TCP_SRC_HOST_PORT=$(pick_port)
TCP_REST_HOST_PORT=$(pick_port)
while [[ "$TCP_REST_HOST_PORT" == "$TCP_SRC_HOST_PORT" ]]; do
  TCP_REST_HOST_PORT=$(pick_port)
done
TCP_NAME="vmstate-tcp-listen-$$"
TCP_LOG="$FIXTURE/tcp-listen-source.log"
TCP_SNAP="$FIXTURE/tcp-listen.snap"
TCP_SNAP_LOG="$FIXTURE/tcp-listen-snapshot.log"
TCP_RESTORE_NO_PORT="vmstate-tcp-no-port-$$"
TCP_RESTORE_NO_PORT_LOG="$FIXTURE/tcp-listen-restore-no-port.log"
TCP_RESTORE_WITH_PORT="vmstate-tcp-with-port-$$"
TCP_RESTORE_WITH_PORT_LOG="$FIXTURE/tcp-listen-restore-with-port.log"

boot_bg "$TCP_NAME" "$TCP_LOG" \
  -p "$TCP_SRC_HOST_PORT:$TCP_GUEST_PORT" \
  --mount "$HELPERS_DIR:/mnt/helpers" -- \
  /mnt/helpers/vmstate-socket-probe tcp-listen "$TCP_GUEST_PORT" source >/dev/null
if ! wait_for_vm "$TCP_NAME" 45 || ! wait_log "$TCP_LOG" "VMSTATE_SOCKET_READY kind=tcp-listen" 45; then
  tail -120 "$TCP_LOG" >&2 || true
  fail "tcp-listen source did not become ready"
fi
pass "source listener is ready"
if ! tcp_exchange "$TCP_SRC_HOST_PORT" before-snapshot 8000 | grep -q "VMSTATE_TCP_OK label=source"; then
  tail -120 "$TCP_LOG" >&2 || true
  fail "host could not reach source listener through initial port forward"
fi
pass "host reaches source listener through $TCP_SRC_HOST_PORT:$TCP_GUEST_PORT"

snapshot_vm "$TCP_NAME" "$TCP_SNAP" "$TCP_SNAP_LOG"
pass "snapshot captured listening TCP workload"

restore_bg "$TCP_RESTORE_NO_PORT_LOG" "$TCP_SNAP" --name "$TCP_RESTORE_NO_PORT" >/dev/null
register_vm_name "$TCP_RESTORE_NO_PORT"
if ! wait_for_vm "$TCP_RESTORE_NO_PORT" 60; then
  tail -120 "$TCP_RESTORE_NO_PORT_LOG" >&2 || true
  fail "no-port restored VM never registered"
fi
if ! wait_for_reseed "$TCP_RESTORE_NO_PORT" 60; then
  tail -120 "$TCP_RESTORE_NO_PORT_LOG" >&2 || true
  fail "no-port restored VM did not report vmstate entropy reseed marker"
fi
NO_PORTS=$(json_ports_for_name "$TCP_RESTORE_NO_PORT")
if [[ "$NO_PORTS" != "[]" ]]; then
  fail "restored VM inherited port forwards: $NO_PORTS"
fi
pass "restored VM did not inherit source port forwards"

restore_bg "$TCP_RESTORE_WITH_PORT_LOG" "$TCP_SNAP" --name "$TCP_RESTORE_WITH_PORT" -p "$TCP_REST_HOST_PORT:$TCP_GUEST_PORT" >/dev/null
register_vm_name "$TCP_RESTORE_WITH_PORT"
if ! wait_for_vm "$TCP_RESTORE_WITH_PORT" 60; then
  tail -120 "$TCP_RESTORE_WITH_PORT_LOG" >&2 || true
  fail "with-port restored VM never registered"
fi
if ! wait_for_reseed "$TCP_RESTORE_WITH_PORT" 60; then
  tail -120 "$TCP_RESTORE_WITH_PORT_LOG" >&2 || true
  fail "with-port restored VM did not report vmstate entropy reseed marker"
fi
if ! tcp_exchange "$TCP_REST_HOST_PORT" after-restore 8000 | grep -q "VMSTATE_TCP_OK label=source"; then
  tail -120 "$TCP_RESTORE_WITH_PORT_LOG" >&2 || true
  fail "host could not reach restored listener through fresh port forward"
fi
pass "host reaches restored listener through fresh $TCP_REST_HOST_PORT:$TCP_GUEST_PORT forward"

section "SOCKET-2 in-guest Unix socketpair survives restore"
UDS_NAME="vmstate-uds-pair-$$"
UDS_LOG="$FIXTURE/uds-source.log"
UDS_SNAP="$FIXTURE/uds.snap"
UDS_SNAP_LOG="$FIXTURE/uds-snapshot.log"
UDS_RESTORE_LOG="$FIXTURE/uds-restore.log"
boot_bg "$UDS_NAME" "$UDS_LOG" \
  --mount "$HELPERS_DIR:/mnt/helpers" -- \
  /mnt/helpers/vmstate-socket-probe uds-pair >/dev/null
if ! wait_for_vm "$UDS_NAME" 45 || ! wait_log "$UDS_LOG" "VMSTATE_SOCKET_READY kind=uds-pair" 45; then
  tail -120 "$UDS_LOG" >&2 || true
  fail "uds-pair source did not become ready"
fi
pass "UDS socketpair created before snapshot"
snapshot_vm "$UDS_NAME" "$UDS_SNAP" "$UDS_SNAP_LOG"
restore_bg "$UDS_RESTORE_LOG" "$UDS_SNAP" >/dev/null
UDS_RESTORED=""
if ! wait_for_restore_child "$UDS_NAME" UDS_RESTORED 60; then
  tail -120 "$UDS_RESTORE_LOG" >&2 || true
  fail "UDS restored VM never registered"
fi
if ! wait_for_reseed "$UDS_RESTORED" 60; then
  tail -120 "$UDS_RESTORE_LOG" >&2 || true
  fail "UDS restored VM did not report vmstate entropy reseed marker"
fi
cli exec "$UDS_RESTORED" -- touch /tmp/vmstate-socket-go >/dev/null
if ! wait_log "$UDS_RESTORE_LOG" "VMSTATE_SOCKET_UDS_OK" 30; then
  tail -120 "$UDS_RESTORE_LOG" >&2 || true
  fail "restored UDS socketpair did not pass data"
fi
pass "restored in-guest Unix socketpair passes data"

section "SOCKET-3 established outbound TCP closes in restored VM while source stays usable"
ECHO_PORT=$(pick_port)
DUMMY_HOST_PORT=$(pick_port)
while [[ "$DUMMY_HOST_PORT" == "$ECHO_PORT" ]]; do
  DUMMY_HOST_PORT=$(pick_port)
done
ECHO_LOG="$FIXTURE/host-echo.log"
start_host_echo_server "$ECHO_PORT" "$ECHO_LOG" >/dev/null
ACTIVE_NAME="vmstate-active-tcp-$$"
ACTIVE_LOG="$FIXTURE/active-tcp-source.log"
ACTIVE_SNAP="$FIXTURE/active-tcp.snap"
ACTIVE_SNAP_LOG="$FIXTURE/active-tcp-snapshot.log"
ACTIVE_RESTORE_LOG="$FIXTURE/active-tcp-restore.log"
boot_bg "$ACTIVE_NAME" "$ACTIVE_LOG" \
  -p "$DUMMY_HOST_PORT:9" \
  --mount "$HELPERS_DIR:/mnt/helpers" -- \
  /mnt/helpers/vmstate-socket-probe tcp-client-stale 192.168.127.254 "$ECHO_PORT" active >/dev/null
if ! wait_for_vm "$ACTIVE_NAME" 45 || ! wait_log "$ACTIVE_LOG" "VMSTATE_SOCKET_READY kind=tcp-client-stale" 45; then
  tail -160 "$ACTIVE_LOG" >&2 || true
  tail -80 "$ECHO_LOG" >&2 || true
  fail "active TCP source did not establish outbound connection"
fi
pass "source established outbound TCP connection before snapshot"
snapshot_vm "$ACTIVE_NAME" "$ACTIVE_SNAP" "$ACTIVE_SNAP_LOG"
restore_bg "$ACTIVE_RESTORE_LOG" "$ACTIVE_SNAP" >/dev/null
ACTIVE_RESTORED=""
if ! wait_for_restore_child "$ACTIVE_NAME" ACTIVE_RESTORED 60; then
  tail -120 "$ACTIVE_RESTORE_LOG" >&2 || true
  fail "active TCP restored VM never registered"
fi
if ! wait_for_reseed "$ACTIVE_RESTORED" 60; then
  tail -120 "$ACTIVE_RESTORE_LOG" >&2 || true
  fail "active TCP restored VM did not report vmstate entropy reseed marker"
fi
cli exec "$ACTIVE_NAME" -- touch /tmp/vmstate-socket-go >/dev/null
if ! wait_log "$ACTIVE_LOG" "VMSTATE_SOCKET_STALE_STILL_OPEN label=active" 30; then
  tail -160 "$ACTIVE_LOG" >&2 || true
  tail -80 "$ECHO_LOG" >&2 || true
  fail "source's pre-snapshot TCP connection did not remain usable"
fi
pass "source's original TCP connection remains usable"
cli exec "$ACTIVE_RESTORED" -- touch /tmp/vmstate-socket-go >/dev/null
if ! wait_log "$ACTIVE_RESTORE_LOG" "VMSTATE_SOCKET_STALE_CLOSED label=active" 30; then
  tail -160 "$ACTIVE_RESTORE_LOG" >&2 || true
  tail -80 "$ECHO_LOG" >&2 || true
  fail "restored VM did not close old established TCP stream cleanly"
fi
pass "restored VM reports old established TCP stream closed within timeout"

section "socket smoke complete"
pass "vmstate socket smoke repros passed"
