#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-semantic-ping.XXXXXX")}"
mkdir -p "$WORK"

node --input-type=module - "$WORK" <<'NODE'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProductClaimRegistry,
  createProductSemanticPingContinuation,
  filterProductClaimRegistry,
} from './packages/runtime/dist/index.js';
import profiles from './scripts/portable-machine-proof-profiles.json' with { type: 'json' };

const work = process.argv[2];
const accepted = createProductSemanticPingContinuation({
  sourceArch: 'arm64',
  targetArch: 'amd64',
  destination: '198.51.100.10',
  intervalMs: 1000,
  identifier: 4242,
  nextSequence: 8,
  sent: 8,
  received: 7,
  lost: 1,
  receiveQueue: 'empty',
  activeRecvmsg: false,
  rawSocketState: 'none',
  verifierEchoReplies: 2,
});
if (accepted.state !== 'completed') throw new Error('semantic ping accepted profile refused');
if (accepted.summary.continuedState.firstTargetSequence !== 8) throw new Error('sequence boundary drifted');
if (accepted.summary.continuedState.sentAfterVerifier !== 10) throw new Error('sent counter did not advance');
if (accepted.summary.shortcutInspection.sourceIsaEmulationUsed !== false) throw new Error('source ISA emulation shortcut surfaced');
writeFileSync(join(work, 'accepted.json'), `${JSON.stringify(accepted, null, 2)}\n`);

const unread = createProductSemanticPingContinuation({
  sourceArch: 'arm64',
  targetArch: 'amd64',
  destination: '198.51.100.10',
  intervalMs: 1000,
  identifier: 4242,
  nextSequence: 8,
  sent: 8,
  received: 7,
  lost: 1,
  receiveQueue: 'unread-replies',
  activeRecvmsg: false,
  rawSocketState: 'none',
  verifierEchoReplies: 2,
});
if (unread.state !== 'refused') throw new Error('unread receive queue did not refuse');
if (unread.refusal.expectedRefusalCode !== 'semantic-ping-unread-receive-queue-unsupported') {
  throw new Error(`wrong unread refusal: ${unread.refusal.expectedRefusalCode}`);
}
writeFileSync(join(work, 'unread-refusal.json'), `${JSON.stringify(unread, null, 2)}\n`);

const raw = createProductSemanticPingContinuation({
  sourceArch: 'arm64',
  targetArch: 'amd64',
  destination: '198.51.100.10',
  intervalMs: 1000,
  identifier: 4242,
  nextSequence: 8,
  sent: 8,
  received: 7,
  lost: 1,
  receiveQueue: 'empty',
  activeRecvmsg: false,
  rawSocketState: 'present',
  verifierEchoReplies: 2,
});
if (raw.state !== 'refused') throw new Error('raw socket kernel state did not refuse');
if (raw.refusal.expectedRefusalCode !== 'semantic-ping-raw-socket-state-unsupported') {
  throw new Error(`wrong raw socket refusal: ${raw.refusal.expectedRefusalCode}`);
}
writeFileSync(join(work, 'raw-socket-refusal.json'), `${JSON.stringify(raw, null, 2)}\n`);

const registry = buildProductClaimRegistry(profiles);
const level2 = filterProductClaimRegistry(registry.entries, {
  supportLevel: 'level-2-semantic-continuation',
  profile: 'ping-sequence-counter-semantic-continuation-v1',
});
if (level2.length !== 1) throw new Error(`support discovery selected ${level2.length} Level 2 profiles`);
if (level2[0].productStatus !== 'implemented-product-support') throw new Error('Level 2 ping is not implemented product support');
writeFileSync(join(work, 'support-discovery.json'), `${JSON.stringify(level2[0], null, 2)}\n`);
NODE

node "$ROOT/scripts/product-claim-registry-matrix.mjs" \
  --level level-2-semantic-continuation \
  --profile ping-sequence-counter-semantic-continuation-v1 \
  --summary "$WORK/product-claim-registry-level2.json"

node "$ROOT/packages/cli/dist/cli.js" support \
  --level level-2-semantic-continuation \
  --profile ping-sequence-counter-semantic-continuation-v1 \
  --json >"$WORK/cli-support-level2.json"

node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (data.count !== 1) throw new Error(`expected one Level 2 entry, got ${data.count}`); const entry=data.entries[0]; if (entry.supportLevel !== "level-2-semantic-continuation" || entry.productStatus !== "implemented-product-support") throw new Error("CLI support did not report implemented Level 2 ping");' "$WORK/cli-support-level2.json"

echo "semantic ping continuation smoke passed: $WORK"
