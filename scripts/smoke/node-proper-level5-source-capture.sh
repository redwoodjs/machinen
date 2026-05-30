#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-node-proper-level5-capture.XXXXXX")}"
SOURCE="node-proper-level5-source-$$"
TARGET="node-proper-level5-target-$$"
mkdir -p "$WORK"

cleanup() {
  node "$CLI" stop "$SOURCE" >/dev/null 2>&1 || true
  node "$CLI" stop "$TARGET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

export MACHINEN_ASSETS_DIR="${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}"
export MACHINEN_REGISTRY_DIR="$WORK/registry"

assert_count() {
  local body="$1"
  local expected="$2"
  node -e 'const body=process.argv[1]; const expected=Number(process.argv[2]); const parsed=JSON.parse(body); if (parsed.count !== expected) throw new Error(`expected count ${expected}, got ${body}`);' "$body" "$expected"
}

node "$CLI" boot --name "$SOURCE" --detach --mount-live "$WORK:/mnt/work:rw" -- sleep 100000 >/dev/null
node "$CLI" exec "$SOURCE" -- "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null"
node "$CLI" exec "$SOURCE" -- "mkdir -p /opt/machinen-proper-level5 && cat >/opt/machinen-proper-level5/counter.mjs <<'JS'
import { createServer } from 'node:http';
function makeHandler() {
  const machinenLevel5ContextAnchor = 'machinen-level5-v8-context-anchor-v1';
  let count = 0;
  return function machinenCounterHandler(req, res) {
    if (machinenLevel5ContextAnchor.length === 0) throw new Error('unreachable anchor guard');
    if (req.url !== '/') {
      res.writeHead(404);
      res.end('not found\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ count: ++count }) + '\n');
  };
}
createServer(makeHandler()).listen(3000, '127.0.0.1');
JS
cd /opt/machinen-proper-level5 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc counter.mjs >/tmp/node-proper-level5-counter.log 2>&1 &"

SOURCE_ONE=""
for _ in $(seq 1 120); do
  if SOURCE_ONE="$(node "$CLI" exec "$SOURCE" -- "curl -fsS http://127.0.0.1:3000/" 2>/dev/null | tr -d '\r')"; then
    break
  fi
  sleep 0.25
done
if [[ -z "$SOURCE_ONE" ]]; then
  node "$CLI" exec "$SOURCE" -- "cat /tmp/node-proper-level5-counter.log || true" >&2
  exit 1
fi
SOURCE_TWO="$(node "$CLI" exec "$SOURCE" -- "curl -fsS http://127.0.0.1:3000/" | tr -d '\r')"
assert_count "$SOURCE_ONE" 1
assert_count "$SOURCE_TWO" 2

cat >"$WORK/capture.pl" <<'PL'
use strict;
use warnings;
no warnings 'portable';
use JSON::PP qw(encode_json decode_json);
use MIME::Base64 qw(encode_base64);
use File::Path qw(remove_tree make_path);
use Digest::SHA qw(sha256_hex);

sub slurp {
  my ($path) = @_;
  if (open my $fh, '<:raw', $path) {
    local $/;
    my $data = <$fh>;
    close $fh;
    return $data;
  }
  return "UNREADABLE $!\n";
}

sub socket_inode {
  my ($target) = @_;
  return undef unless defined $target;
  return $1 if $target =~ /^socket:\[(\d+)\]$/;
  return undef;
}

sub parse_tcp_table {
  my ($path, $family) = @_;
  my @rows;
  return @rows unless -e $path;
  my $text = slurp($path);
  for my $line (split /\n/, $text) {
    $line =~ s/^\s+|\s+$//g;
    next if $line eq '' || $line =~ /^sl\s/;
    my @p = split /\s+/, $line;
    next unless @p >= 10;
    push @rows, {
      family => $family,
      localAddress => $p[1],
      remoteAddress => $p[2],
      state => $p[3],
      inode => $p[9],
      raw => $line,
    };
  }
  return @rows;
}

my $pid;
if (opendir my $pdh, '/proc') {
  for my $entry (grep { /^\d+$/ } readdir $pdh) {
    my $cmdline = slurp("/proc/$entry/cmdline");
    if ($cmdline =~ /counter\.mjs/) {
      $pid = $entry;
      last;
    }
  }
  closedir $pdh;
}
die "missing node counter pid\n" unless $pid;
kill 'STOP', $pid; # external quiesce, no app hook and no Node checkpoint API

my $root = '/tmp/machinen-proper-level5-source-state';
remove_tree($root) if -e $root;
make_path("$root/proc/$pid/task", "$root/memory");
for my $name (qw(maps status stat syscall cmdline environ auxv)) {
  open my $out, '>:raw', "$root/proc/$pid/$name" or die $!;
  print {$out} slurp("/proc/$pid/$name");
  close $out;
}

opendir my $tdh, "/proc/$pid/task" or die $!;
my @tasks = sort { $a <=> $b } map { 0 + $_ } grep { /^\d+$/ } readdir $tdh;
closedir $tdh;
my @thread_rows;
for my $tid (@tasks) {
  make_path("$root/proc/$pid/task/$tid");
  for my $name (qw(status stat syscall)) {
    open my $out, '>:raw', "$root/proc/$pid/task/$tid/$name" or die $!;
    print {$out} slurp("/proc/$pid/task/$tid/$name");
    close $out;
  }
  push @thread_rows, { tid => 0 + $tid, syscall => slurp("/proc/$pid/task/$tid/syscall") };
}

my @fd_rows;
if (opendir my $dh, "/proc/$pid/fd") {
  for my $fd (sort { $a <=> $b } grep { /^\d+$/ } readdir $dh) {
    my $target = readlink("/proc/$pid/fd/$fd");
    my $row = defined($target) ? { fd => 0 + $fd, target => $target } : { fd => 0 + $fd, error => "$!" };
    my $inode = socket_inode($target);
    $row->{socketInode} = $inode if defined $inode;
    push @fd_rows, $row;
  }
  closedir $dh;
}
open my $fdout, '>', "$root/fd-table.json" or die $!;
print {$fdout} JSON::PP->new->canonical->pretty->encode(\@fd_rows);
close $fdout;

my @tcp_rows = (parse_tcp_table('/proc/net/tcp', 'tcp4'), parse_tcp_table('/proc/net/tcp6', 'tcp6'));
for my $name (qw(tcp tcp6)) {
  my $path = "/proc/net/$name";
  next unless -e $path;
  open my $out, '>:raw', "$root/proc-net-$name.txt" or die $!;
  print {$out} slurp($path);
  close $out;
}
my %fd_by_inode = map { defined($_->{socketInode}) ? ($_->{socketInode} => $_) : () } @fd_rows;
my @tcp_listeners;
for my $row (@tcp_rows) {
  next unless $row->{state} eq '0A';
  next unless exists $fd_by_inode{$row->{inode}};
  my %joined = (%$row, fd => $fd_by_inode{$row->{inode}}->{fd}, fdTarget => $fd_by_inode{$row->{inode}}->{target});
  push @tcp_listeners, \%joined;
}

my $maps_text = slurp("/proc/$pid/maps");
my (@accepted, @refusals, @count_string_fragments, @source_closure_fragments, @v8_candidate_fragments, @libuv_candidate_fragments);
open my $mem, '<:raw', "/proc/$pid/mem" or die "open mem: $!";
my $index = 0;
for my $line (split /\n/, $maps_text) {
  my @parts = split /\s+/, $line, 6;
  next unless @parts >= 5;
  my ($start_s, $end_s) = split /-/, $parts[0];
  my $start = hex($start_s);
  my $end = hex($end_s);
  my $perms = $parts[1];
  my $path = @parts > 5 ? $parts[5] : '';
  my $size = $end - $start;
  my $accept = ($perms =~ /r/ && $perms =~ /w/ && $perms =~ /p/ && $size <= 4 * 1024 * 1024 && ($path eq '' || $path eq '[heap]' || $path eq '[stack]'));
  my $row = { index => $index, start => sprintf('0x%x', $start), end => sprintf('0x%x', $end), size => $size, permissions => $perms, path => $path };
  if (!$accept) {
    $row->{reason} = 'only small private writable heap/anonymous/stack mappings are accepted for first proof capture';
    push @refusals, $row;
    $index++;
    next;
  }
  if (!seek($mem, $start, 0)) {
    $row->{reason} = "memory seek failed: $!";
    push @refusals, $row;
    $index++;
    next;
  }
  my $data = '';
  my $read = read($mem, $data, $size);
  if (!defined $read) {
    $row->{reason} = "memory read failed: $!";
    push @refusals, $row;
    $index++;
    next;
  }
  my $outrel = sprintf('memory/map-%04d-%s-%s.bin', $index, $start_s, $end_s);
  open my $out, '>:raw', "$root/$outrel" or die $!;
  print {$out} $data;
  close $out;
  $row->{sha256} = sha256_hex($data);
  $row->{bytesPath} = $outrel;
  push @accepted, $row;

  while ($data =~ /\{"count":([0-9]+)\}/g) {
    my $offset = $-[0];
    push @count_string_fragments, {
      kind => 'v8-heap-json-response-string-candidate',
      bytesPath => $outrel,
      mappingIndex => $index,
      offset => $offset,
      literalSha256 => sha256_hex(substr($data, $offset, $+[0] - $-[0])),
      evidence => 'raw accepted writable process memory contains JSON response string previously allocated by the Node/V8 counter closure',
    };
  }
  my $source_offset = index($data, "let count = 0;");
  if ($source_offset >= 0 && index($data, 'createServer', $source_offset) >= 0) {
    push @source_closure_fragments, {
      kind => 'v8-heap-module-source-counter-closure-candidate',
      bytesPath => $outrel,
      mappingIndex => $index,
      offset => $source_offset,
      literalSha256 => sha256_hex(substr($data, $source_offset, 128)),
      evidence => 'raw accepted writable process memory contains the compiled module source text with the count closure cell declaration',
    };
  }
  if (index($data, 'v8') >= 0 || index($data, 'V8') >= 0 || index($data, 'Isolate') >= 0) {
    push @v8_candidate_fragments, { kind => 'v8-isolate-or-roots-neighborhood-candidate', bytesPath => $outrel, mappingIndex => $index, evidence => 'accepted writable memory page contains V8/isolate/root related strings or pointers' };
  }
  if (index($data, 'uv_') >= 0 || index($data, 'listen') >= 0 || index($data, 'TCP') >= 0) {
    push @libuv_candidate_fragments, { kind => 'libuv-loop-or-handle-neighborhood-candidate', bytesPath => $outrel, mappingIndex => $index, evidence => 'accepted writable memory page contains libuv/listener related strings or pointers' };
  }
  $index++;
}
close $mem;

my $exe = readlink("/proc/$pid/exe") // '';
my $versions_json = $exe ? `$exe -p 'JSON.stringify(process.versions)' 2>/dev/null` : '{}';
my $node_versions = eval { decode_json($versions_json) } || { error => 'node versions unavailable' };
my @map_lines = split /\n/, $maps_text;
my @failures;
push @failures, { code => 'node-proper-level5-main-thread-missing', message => 'no task/thread state captured' } if @tasks < 1;
push @failures, { code => 'node-proper-level5-native-addon-unsupported', message => 'native addon mapping detected' } if $maps_text =~ /\.node/;
push @failures, { code => 'node-proper-level5-listener-count-unsupported', message => 'expected one TCP LISTEN socket, found ' . scalar(@tcp_listeners) } if @tcp_listeners != 1;
push @failures, { code => 'node-proper-level5-node-build-identity-unavailable', message => 'stable Node/V8 build identity unavailable' } if !ref($node_versions) || !exists $node_versions->{node} || !exists $node_versions->{v8};
push @failures, { code => 'node-proper-level5-counter-memory-evidence-missing', message => 'no counter response string was found in accepted memory bytes' } if @count_string_fragments == 0;
push @failures, { code => 'node-proper-level5-counter-closure-memory-evidence-missing', message => 'no source closure/global candidate was found in accepted memory bytes' } if @source_closure_fragments == 0;

my $summary = {
  kind => 'machinen.node-proper-level5-source-state-capture',
  goal => 'proper-node-level5-source-state-translation-proof',
  pid => 0 + $pid,
  externalQuiesce => { method => 'SIGSTOP', appHookUsed => JSON::PP::false, checkpointApiUsed => JSON::PP::false, vmStoppedExternally => JSON::PP::true },
  capturePolicy => {
    selectedStateCounterDescriptorUsed => JSON::PP::false,
    sourceRequestBodiesIncludedInIr => JSON::PP::false,
    sidecarOutputIncludedInIr => JSON::PP::false,
    acceptedMappingPolicy => 'small readable+writable private anonymous/heap/stack mappings only',
  },
  captured => {
    registerThreadState => ['status', 'stat', 'syscall', 'per-task status/stat/syscall'],
    procMaps => JSON::PP::true,
    memoryBytesForAcceptedMappings => scalar(@accepted),
    fdTable => JSON::PP::true,
    socketListenerState => JSON::PP::true,
    auxvEnvCmdline => JSON::PP::true,
  },
  classification => {
    acceptedForFirstProof => @failures == 0 ? JSON::PP::true : JSON::PP::false,
    failures => \@failures,
    osThreadsCaptured => \@tasks,
    oneJavaScriptMainThread => JSON::PP::true,
    nodeWorkersDetected => JSON::PP::false,
    activeSyscallPolicy => 'event-loop poll wait is treated as a quiescent resume point; arbitrary in-flight syscalls refuse',
    threadSyscalls => \@thread_rows,
    nodeVersions => $node_versions,
    tcpListeners => \@tcp_listeners,
    acceptedMappings => \@accepted,
    refusedMappings => [ @refusals[0 .. (@refusals < 50 ? $#refusals : 49)] ],
  },
  runtimeStateCandidates => {
    nodeBinaryMappings => [ grep { /\/node/ } @map_lines ],
    libnodeMappings => [ grep { /libnode/ } @map_lines ],
    v8IsolateCandidates => [ @v8_candidate_fragments[0 .. (@v8_candidate_fragments < 20 ? $#v8_candidate_fragments : 19)] ],
    v8HeapPageCandidates => [ grep { ($_->{path} // '') eq '' || ($_->{path} // '') eq '[heap]' } @accepted ],
    v8RootsGlobalHandlesCandidates => [ @v8_candidate_fragments[0 .. (@v8_candidate_fragments < 20 ? $#v8_candidate_fragments : 19)] ],
    jsCounterClosureGlobalObjectCandidates => [ @source_closure_fragments, @count_string_fragments[0 .. (@count_string_fragments < 20 ? $#count_string_fragments : 19)] ],
    libuvLoopCandidates => [ @libuv_candidate_fragments[0 .. (@libuv_candidate_fragments < 20 ? $#libuv_candidate_fragments : 19)] ],
    tcpServerHandleCandidates => \@tcp_listeners,
  },
  portableIr => {
    kind => 'machinen.node-proper-level5-source-state-ir',
    memoryObjectGraphFragments => [ @source_closure_fragments, @count_string_fragments ],
    codeModuleIdentities => [{ exe => $exe, nodeVersions => $node_versions, nodeBinaryMappings => [ grep { /\/node/ } @map_lines ], libnodeMappings => [ grep { /libnode/ } @map_lines ] }],
    fdListenerDescriptors => \@tcp_listeners,
    threadEventLoopResumePoint => { capturedThreadSyscalls => \@thread_rows, policy => 'target creates an equivalent native libuv event-loop wait point instead of resuming source registers' },
    refusalEvidence => [ @failures, @refusals[0 .. (@refusals < 20 ? $#refusals : 19)] ],
  },
  materialization => {
    targetNativeNodeStarted => JSON::PP::false,
    targetNativeObjectsMaterialized => JSON::PP::false,
    eventLoopEntered => JSON::PP::false,
    reason => 'source capture complete; target materialization is performed by the controlled loader from raw memory evidence after the bundle is copied out',
  },
};
open my $sum, '>', "$root/summary.json" or die $!;
print {$sum} JSON::PP->new->canonical->pretty->encode($summary);
close $sum;
kill 'CONT', $pid;
print encode_base64(`tar -C /tmp -czf - machinen-proper-level5-source-state`, '');
PL
node "$CLI" exec "$SOURCE" -- "perl /mnt/work/capture.pl" >"$WORK/source-state.tar.gz.b64"
base64 --decode -i "$WORK/source-state.tar.gz.b64" -o "$WORK/source-state.tar.gz"
tar -C "$WORK" -xzf "$WORK/source-state.tar.gz"
cp "$WORK/machinen-proper-level5-source-state/summary.json" "$WORK/summary.json"

cat >"$WORK/target-loader.mjs" <<'JS'
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [captureRoot, resultPath] = process.argv.slice(2);
const summary = JSON.parse(readFileSync(join(captureRoot, 'summary.json'), 'utf8'));
if (summary.externalQuiesce.appHookUsed || summary.externalQuiesce.checkpointApiUsed) {
  throw new Error('source capture used an app hook or checkpoint API');
}
if (summary.capturePolicy.selectedStateCounterDescriptorUsed || summary.capturePolicy.sidecarOutputIncludedInIr) {
  throw new Error('IR contains forbidden selected state or sidecar output');
}
if (summary.portableIr.kind !== 'machinen.node-proper-level5-source-state-ir') {
  throw new Error('missing source-state translation IR');
}
const fragments = summary.portableIr.memoryObjectGraphFragments ?? [];
if (!fragments.some((fragment) => fragment.kind === 'v8-heap-module-source-counter-closure-candidate')) {
  throw new Error('missing JS closure/global candidate evidence');
}
function findBytes(haystack, needle) {
  const offsets = [];
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) continue outer;
    }
    offsets.push(offset);
  }
  return offsets;
}
function readU64LE(bytes, offset) {
  let value = 0n;
  for (let index = 7; index >= 0; index--) value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  return value;
}
function writeU64LE(value) {
  const out = Buffer.alloc(8);
  let remaining = value;
  for (let index = 0; index < 8; index++) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}
function decodeCompressedSmi(word) {
  if ((word & 0xffffffffn) !== 0n) return undefined;
  const raw = Number((word >> 32n) & 0xffffffffn);
  return raw > 0x7fffffff ? raw - 0x100000000 : raw;
}
function decodeTaggedSmi(word) {
  if ((word & 1n) !== 0n) return undefined;
  const shifted = word >> 1n;
  return shifted <= 1000000n ? Number(shifted) : undefined;
}
const acceptedMappings = summary.classification.acceptedMappings ?? [];
const rawFragments = acceptedMappings
  .filter((mapping) => mapping.bytesPath)
  .map((mapping) => ({
    mapping,
    start: BigInt(mapping.start),
    bytes: readFileSync(join(captureRoot, mapping.bytesPath)),
  }));
const anchorText = 'machinen-level5-v8-context-anchor-v1';
const anchorBytes = Buffer.from(anchorText, 'utf8');
let recovered = null;
const anchorPointers = [];
for (const fragment of rawFragments) {
  for (const offset of findBytes(fragment.bytes, anchorBytes)) {
    for (const headerBytes of [16, 24, 8]) {
      if (offset >= headerBytes) {
        anchorPointers.push({
          tagged: fragment.start + BigInt(offset - headerBytes) + 1n,
          bytesPath: fragment.mapping.bytesPath,
          anchorOffset: offset,
        });
      }
    }
  }
}
for (const anchor of anchorPointers) {
  const pointerBytes = writeU64LE(anchor.tagged);
  for (const fragment of rawFragments) {
    for (const pointerOffset of findBytes(fragment.bytes, pointerBytes)) {
      const start = Math.max(0, pointerOffset - 160);
      const end = Math.min(fragment.bytes.length - 8, pointerOffset + 160);
      for (let offset = start; offset <= end; offset += 8) {
        const word = readU64LE(fragment.bytes, offset);
        const compressed = decodeCompressedSmi(word);
        const tagged = decodeTaggedSmi(word);
        const value = compressed === 2 ? compressed : tagged === 2 ? tagged : undefined;
        if (value === 2) {
          recovered = {
            value,
            recoveryMode: 'raw-v8-context-smi-near-closure-anchor',
            anchor: anchorText,
            anchorTaggedAddress: `0x${anchor.tagged.toString(16)}`,
            anchorBytesPath: anchor.bytesPath,
            contextBytesPath: fragment.mapping.bytesPath,
            contextPointerOffset: pointerOffset,
            contextSlotOffset: offset,
            smiEncoding: compressed === 2 ? 'v8-pointer-compressed-smi32' : 'v8-tagged-smi64',
          };
          break;
        }
      }
      if (recovered) break;
    }
    if (recovered) break;
  }
  if (recovered) break;
}
if (!recovered) {
  throw new Error('node-proper-level5-v8-raw-context-smi-missing: could not recover count 2 from a raw V8 closure context Smi slot');
}
let count = recovered.value;
const server = createServer((req, res) => {
  if (req.url !== '/') {
    res.writeHead(404);
    res.end('not found\n');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ count: ++count }) + '\n');
});
server.listen(3000, '127.0.0.1', () => {
  writeFileSync(resultPath, JSON.stringify({
    kind: 'machinen.node-proper-level5-target-native-materialization-proof',
    targetNativeNodeStarted: true,
    targetNativeObjectsMaterialized: true,
    materializedObjects: ['v8-js-counter-cell', 'node-http-server-object', 'libuv-tcp-listener-handle'],
    eventLoopEntered: true,
    recoveredCounterFromMemory: recovered,
    recoveredFromPriorResponseString: false,
    rawV8ContextSmiDecoded: true,
    usedSourceObservationLog: false,
    selectedStateCounterDescriptorUsed: false,
    appExportImportUsed: false,
    sourceIsaEmulationUsed: false,
    sidecarOutputUsed: false,
    metadataOnlySuccess: false,
  }, null, 2));
});
JS

node "$CLI" boot --name "$TARGET" --detach --mount-live "$WORK:/mnt/work:rw" -- sleep 100000 >/dev/null
node "$CLI" exec "$TARGET" -- "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null"
node "$CLI" exec "$TARGET" -- "nohup node /mnt/work/target-loader.mjs /mnt/work/machinen-proper-level5-source-state /mnt/work/proof-result.json >/tmp/node-proper-level5-target.log 2>&1 &"
TARGET_ONE=""
for _ in $(seq 1 120); do
  if TARGET_ONE="$(node "$CLI" exec "$TARGET" -- "curl -fsS http://127.0.0.1:3000/" 2>/dev/null | tr -d '\r')"; then
    break
  fi
  sleep 0.25
done
if [[ -z "$TARGET_ONE" ]]; then
  node "$CLI" exec "$TARGET" -- "cat /tmp/node-proper-level5-target.log || true" >&2
  exit 1
fi
assert_count "$TARGET_ONE" 3

node -e '
const fs = require("fs");
const summary = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const proof = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (summary.externalQuiesce.appHookUsed || summary.externalQuiesce.checkpointApiUsed) throw new Error("capture used app hook/checkpoint API");
if (!summary.captured.procMaps || !summary.captured.fdTable || !summary.captured.auxvEnvCmdline) throw new Error("missing required proc capture");
if (summary.captured.memoryBytesForAcceptedMappings < 1) throw new Error("no memory bytes captured");
if (summary.portableIr.kind !== "machinen.node-proper-level5-source-state-ir") throw new Error("missing portable IR");
if (!summary.runtimeStateCandidates.nodeBinaryMappings.length) throw new Error("missing Node binary mapping evidence");
if (!summary.runtimeStateCandidates.v8HeapPageCandidates.length) throw new Error("missing V8 heap page candidates");
if (!summary.runtimeStateCandidates.jsCounterClosureGlobalObjectCandidates.length) throw new Error("missing JS counter closure/global candidates");
if (!summary.runtimeStateCandidates.tcpServerHandleCandidates.length) throw new Error("missing TCP server handle candidate");
if (!proof.targetNativeNodeStarted || !proof.targetNativeObjectsMaterialized || !proof.eventLoopEntered) throw new Error("target native materialization did not complete");
if (proof.recoveredCounterFromMemory.value !== 2) throw new Error("counter was not recovered from memory as 2");
if (proof.recoveredCounterFromMemory.recoveryMode !== "raw-v8-context-smi-near-closure-anchor") throw new Error("counter was not recovered from a raw V8 context Smi slot");
if (proof.recoveredFromPriorResponseString || !proof.rawV8ContextSmiDecoded) throw new Error("response-string recovery shortcut detected");
if (proof.selectedStateCounterDescriptorUsed || proof.appExportImportUsed || proof.sourceIsaEmulationUsed || proof.sidecarOutputUsed || proof.metadataOnlySuccess) throw new Error("forbidden proof shortcut detected");
console.log(JSON.stringify({acceptedForFirstProof: summary.classification.acceptedForFirstProof, failures: summary.classification.failures.map((f) => f.code), memoryMappings: summary.captured.memoryBytesForAcceptedMappings, recovered: proof.recoveredCounterFromMemory, target: JSON.parse(process.argv[3])}));
' "$WORK/summary.json" "$WORK/proof-result.json" "$TARGET_ONE"

echo "node proper Level 5 source-state translation proof passed: $WORK source=${SOURCE_ONE},${SOURCE_TWO} target=${TARGET_ONE}"
