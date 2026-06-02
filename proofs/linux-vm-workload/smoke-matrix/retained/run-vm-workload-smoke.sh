#!/bin/sh
set +e
row() { printf 'MACHINEN_VM_WORKLOAD_ROW %s\n' "$*"; }
if command -v sqlite3 >/dev/null 2>&1; then
  db=/tmp/machinen-sqlite-smoke.db
  sqlite3 "$db" 'create table t(id integer primary key, name text); insert into t(name) values ("alpha"),("beta");' >/tmp/sqlite.out 2>/tmp/sqlite.err
  got=$(sqlite3 "$db" 'select count(*) from t;' 2>>/tmp/sqlite.err)
  if [ "$got" = "2" ]; then row 'id=vm-sqlite-database-smoke disposition=supported accepted=true evidence=sqlite-count-2'; else row 'id=vm-sqlite-database-smoke disposition=refused accepted=false refusalCode=vm-workload-sqlite-verifier-failed evidence=sqlite-count-mismatch'; fi
else
  row 'id=vm-sqlite-database-smoke disposition=refused accepted=true refusalCode=vm-workload-tool-missing tool=sqlite3 evidence=sqlite3-not-installed-in-guest'
fi
if command -v psql >/dev/null 2>&1 && command -v postgres >/dev/null 2>&1; then
  row 'id=vm-postgresql-database-smoke disposition=supported accepted=false evidence=postgres-tools-present-but-no-server-proof-runner-yet'
else
  row 'id=vm-postgresql-database-smoke disposition=refused accepted=true refusalCode=vm-workload-tool-missing tool=postgresql evidence=postgresql-tools-not-installed-in-guest'
fi
/mnt/proof/simple-c-smoke >/tmp/c.out 2>/tmp/c.err
if grep -q C_SMOKE_OK /tmp/c.out; then row 'id=vm-simple-c-process-smoke disposition=supported accepted=true evidence=target-native-static-c-binary-executed'; else row 'id=vm-simple-c-process-smoke disposition=refused accepted=false refusalCode=vm-workload-c-smoke-failed evidence=c-binary-did-not-run'; fi
if command -v java >/dev/null 2>&1; then
  row 'id=vm-simple-java-process-smoke disposition=supported accepted=false evidence=java-runtime-present-but-no-retained-java-source-yet'
else
  row 'id=vm-simple-java-process-smoke disposition=refused accepted=true refusalCode=vm-workload-tool-missing tool=java evidence=java-runtime-not-installed-in-guest'
fi
/mnt/proof/ebpf-smoke >/tmp/ebpf.out 2>/tmp/ebpf.err; ebpf_status=$?
if [ "$ebpf_status" = "0" ]; then row 'id=vm-ebpf-capability-smoke disposition=supported accepted=true evidence=bpf-map-create-succeeded'; elif [ "$ebpf_status" = "77" ]; then row 'id=vm-ebpf-capability-smoke disposition=refused accepted=true refusalCode=vm-workload-ebpf-insufficient-privileges evidence=bpf-map-create-eperm'; else row 'id=vm-ebpf-capability-smoke disposition=refused accepted=false refusalCode=vm-workload-ebpf-probe-failed evidence=bpf-map-create-unexpected'; fi
/mnt/proof/seccomp-smoke >/tmp/seccomp.out 2>/tmp/seccomp.err
if grep -q 'SECCOMP_SMOKE nnp=0 install=0 getpid=-1 errno=1' /tmp/seccomp.out; then row 'id=vm-seccomp-capability-smoke disposition=supported accepted=true evidence=seccomp-filter-blocked-getpid-with-eperm'; else row 'id=vm-seccomp-capability-smoke disposition=refused accepted=false refusalCode=vm-workload-seccomp-probe-failed evidence=seccomp-filter-did-not-block'; fi
if [ -e /dev/kvm ]; then row 'id=vm-nested-virtualization-smoke disposition=supported accepted=true evidence=/dev/kvm-present'; else row 'id=vm-nested-virtualization-smoke disposition=refused accepted=true refusalCode=vm-workload-nested-virtualization-unavailable evidence=/dev/kvm-missing'; fi
exit 0
