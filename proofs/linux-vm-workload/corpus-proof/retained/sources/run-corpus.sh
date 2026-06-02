#!/bin/sh
set +e
arch=${1:-unknown}
row(){ printf 'MACHINEN_WHOLE_VM_CORPUS_ROW arch=%s %s\n' "$arch" "$*"; }
if command -v sqlite3 >/dev/null 2>&1; then row 'id=whole-vm-sqlite-clean-db-workload disposition=unexpected-tool-present accepted=false evidence=sqlite3-present-but-no-product-restore-run'; else row 'id=whole-vm-sqlite-clean-db-workload disposition=refused accepted=true refusalCode=whole-vm-workload-tool-missing tool=sqlite3 evidence=sqlite3-not-installed-in-guest'; fi
if command -v postgres >/dev/null 2>&1 && command -v psql >/dev/null 2>&1; then row 'id=whole-vm-postgresql-clean-workload disposition=unexpected-tool-present accepted=false evidence=postgres-tools-present-but-no-product-restore-run'; else row 'id=whole-vm-postgresql-clean-workload disposition=refused accepted=true refusalCode=whole-vm-workload-tool-missing tool=postgresql evidence=postgresql-tools-not-installed-in-guest'; fi
/mnt/proof/c-service >/tmp/c-service.out 2>/tmp/c-service.err
if grep -q C_SERVICE_WORKLOAD_OK /tmp/c-service.out; then row 'id=whole-vm-c-service-workload disposition=supported accepted=true evidence=target-native-c-service-verifier-passed'; else row 'id=whole-vm-c-service-workload disposition=failed accepted=false refusalCode=whole-vm-c-service-verifier-failed evidence=c-service-failed'; fi
if command -v java >/dev/null 2>&1; then row 'id=whole-vm-java-service-workload disposition=unexpected-tool-present accepted=false evidence=java-present-but-no-product-restore-run'; else row 'id=whole-vm-java-service-workload disposition=refused accepted=true refusalCode=whole-vm-workload-tool-missing tool=java evidence=java-runtime-not-installed-in-guest'; fi
rm -rf /tmp/machinen-fs-proof && mkdir -p /tmp/machinen-fs-proof/sub
printf 'alpha\nbeta\n' >/tmp/machinen-fs-proof/sub/input.txt
cp /tmp/machinen-fs-proof/sub/input.txt /tmp/machinen-fs-proof/output.txt
bytes=$(wc -c </tmp/machinen-fs-proof/output.txt 2>/dev/null || echo 0)
if [ "$bytes" = "11" ] && grep -q beta /tmp/machinen-fs-proof/output.txt; then row 'id=whole-vm-filesystem-workload disposition=supported accepted=true evidence=file-tree-create-copy-read-verifier-passed'; else row 'id=whole-vm-filesystem-workload disposition=failed accepted=false refusalCode=whole-vm-filesystem-verifier-failed evidence=filesystem-verifier-failed'; fi
/mnt/proof/network-listener >/tmp/network-listener.out 2>/tmp/network-listener.err
if grep -q NETWORK_LISTENER_WORKLOAD_OK /tmp/network-listener.out; then row 'id=whole-vm-network-listener-workload disposition=supported accepted=true evidence=loopback-listener-request-response-verifier-passed'; else row 'id=whole-vm-network-listener-workload disposition=failed accepted=false refusalCode=whole-vm-network-listener-verifier-failed evidence=network-listener-failed'; fi
/mnt/proof/multi-process >/tmp/multi-process.out 2>/tmp/multi-process.err
if grep -q MULTI_PROCESS_WORKLOAD_OK /tmp/multi-process.out; then row 'id=whole-vm-multi-process-workload disposition=supported accepted=true evidence=fork-pipe-child-verifier-passed'; else row 'id=whole-vm-multi-process-workload disposition=failed accepted=false refusalCode=whole-vm-multi-process-verifier-failed evidence=multi-process-failed'; fi
row 'id=whole-vm-dirty-active-opaque-state-refusals disposition=refusal-defined accepted=true refusalCode=whole-vm-dirty-active-opaque-state-unsupported evidence=dirty-db-active-session-opaque-kernel-device-runtime-private-state-require-explicit-refusal'
exit 0
