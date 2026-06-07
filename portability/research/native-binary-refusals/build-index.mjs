#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(root, "refusals.json");
const indexPath = join(root, "index.json");
const htmlPath = join(root, "index.html");
const stageOrder = new Map([
  ["1-refused", 1],
  ["2-proved-fixture", 2],
  ["2-classified-unaccepted-shape", 2.5],
  ["3-detectable-proved-shape", 3],
  ["4-supported-subset", 4],
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assertRows(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) {
      throw new Error(`missing or duplicate row id: ${row.id}`);
    }
    ids.add(row.id);
    assertLifecycle(row);
    if (!Array.isArray(row.refusalCodes) || row.refusalCodes.length === 0) {
      throw new Error(`${row.id} needs explicit refusal codes`);
    }
    if (row.supportDecision === "supported-subset" && row.lifecycleStage !== "4-supported-subset") {
      throw new Error(`${row.id} cannot claim support before stage 4`);
    }
  }
}

function assertLifecycle(row) {
  const stage = stageOrder.get(row.lifecycleStage);
  if (!stage) {
    throw new Error(`${row.id} has unknown lifecycle stage: ${row.lifecycleStage}`);
  }
  if (stage >= 2 && (row.proof?.evidence ?? []).length === 0) {
    throw new Error(`${row.id} is stage ${row.lifecycleStage} but has no proof evidence`);
  }
  if (stage < 2 && row.proof?.status !== "missing") {
    throw new Error(`${row.id} cannot have proof status before stage 2`);
  }
  if (stage >= 3 && row.detection?.status === "missing") {
    throw new Error(`${row.id} is stage ${row.lifecycleStage} but has no detector`);
  }
  if (stage < 4 && row.supportDecision === "supported-subset") {
    throw new Error(`${row.id} cannot be supported before stage 4`);
  }
  if (stage === 4 && row.supportDecision !== "supported-subset") {
    throw new Error(`${row.id} is stage 4 but does not claim a supported subset`);
  }
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key];
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function buildIndex(source) {
  assertRows(source.rows);
  return {
    kind: "machinen.research.native-binary-refusal-index",
    version: 1,
    generatedFrom: "refusals.json",
    track: source.track,
    lifecycle: source.lifecycle,
    supportRule: source.supportRule,
    claimGuard: source.claimGuard,
    summary: {
      rowCount: source.rows.length,
      refusedRows: source.rows.filter((row) => row.lifecycleStage === "1-refused").length,
      provedFixtureRows: source.rows.filter((row) => row.lifecycleStage === "2-proved-fixture")
        .length,
      classifiedRows: source.rows.filter(
        (row) => row.lifecycleStage === "2-classified-unaccepted-shape",
      ).length,
      detectableRows: source.rows.filter(
        (row) => row.lifecycleStage === "3-detectable-proved-shape",
      ).length,
      supportedSubsetRows: source.rows.filter((row) => row.lifecycleStage === "4-supported-subset")
        .length,
      byLifecycleStage: countBy(source.rows, "lifecycleStage"),
      byStatus: countBy(source.rows, "status"),
    },
    rows: source.rows,
  };
}

function evidenceLinks(items) {
  if (items.length === 0) {
    return "—";
  }
  return items
    .map(
      (item) => `<a href="../../../${escapeHtml(item)}">${escapeHtml(item.split("/").at(-1))}</a>`,
    )
    .join("<br>");
}

function codeList(items) {
  return items.length === 0
    ? "—"
    : items.map((item) => `<code>${escapeHtml(item)}</code>`).join("<br>");
}

function lifecycleHtml(lifecycle) {
  return lifecycle
    .map(
      (stage) =>
        `<li><code>${escapeHtml(stage.stage)}</code>: <strong>${escapeHtml(stage.label)}</strong><div class="muted">${escapeHtml(stage.meaning)}</div></li>`,
    )
    .join("\n");
}

function rowsHtml(rows) {
  return rows
    .map(
      (row) => `<tr class="stage-${escapeHtml(row.lifecycleStage)}">
<td><code>${escapeHtml(row.id)}</code></td>
<td><strong>${escapeHtml(row.binaryShape)}</strong><div class="muted">${escapeHtml(row.simpleProgram)}</div></td>
<td><span class="pill stage-${escapeHtml(row.lifecycleStage)}">${escapeHtml(row.lifecycleStage)}</span><div class="muted">${escapeHtml(row.supportDecision)}</div></td>
<td><strong>${escapeHtml(row.proof.status)}</strong><div class="muted">${evidenceLinks(row.proof.evidence)}</div></td>
<td><strong>${escapeHtml(row.detection.status)}</strong><div class="muted">${escapeHtml(row.detection.required)}</div></td>
<td><strong>${escapeHtml(row.refusal.status)}</strong><div class="muted">${codeList(row.refusalCodes)}</div></td>
<td>${escapeHtml(row.nextGate)}</td>
<td><span class="pill refused">${escapeHtml(row.directions["arm64-to-amd64"])}</span><br><span class="pill refused">${escapeHtml(row.directions["amd64-to-arm64"])}</span></td>
</tr>`,
    )
    .join("\n");
}

function buildHtml(index) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Machinen native binary refusal matrix</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #16202a; }
    table { border-collapse: collapse; width: 100%; font-size: 0.92rem; }
    th, td { border: 1px solid #d7dee8; padding: 0.55rem; vertical-align: top; }
    th { background: #f4f7fb; text-align: left; }
    .cards { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
    .card { border: 1px solid #d7dee8; border-radius: 0.6rem; padding: 0.8rem 1rem; background: #fbfcfe; }
    .muted { color: #5f6f83; font-size: 0.82rem; margin-top: 0.25rem; }
    .pill { border-radius: 999px; padding: 0.18rem 0.5rem; font-weight: 700; display: inline-block; }
    .stage-1-refused { background: #ffe0e0; color: #8a1f1f; }
    .stage-2-proved-fixture { background: #fff2c6; color: #785a00; }
    .stage-2-classified-unaccepted-shape { background: #f1e8ff; color: #5b2b91; }
    .stage-3-detectable-proved-shape { background: #e8f0ff; color: #234b8f; }
    .stage-4-supported-subset { background: #dff7e8; color: #0c6830; }
    .refused { background: #e8f0ff; color: #234b8f; margin-bottom: 0.25rem; }
    code { background: #f4f7fb; padding: 0.12rem 0.25rem; border-radius: 0.25rem; }
    ul { margin: 0.25rem 0; padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>Native binary proof/detection/refusal/support matrix</h1>
  <p>This tracks simple binary shapes. A fixture proof is not support. Support starts only when detection and fail-closed refusals exist too.</p>
  <div class="cards">
    <div class="card"><strong>${index.summary.rowCount}</strong><div class="muted">binary shapes</div></div>
    <div class="card"><strong>${index.summary.refusedRows}</strong><div class="muted">stage 1 refused</div></div>
    <div class="card"><strong>${index.summary.provedFixtureRows}</strong><div class="muted">stage 2 proved fixture</div></div>
    <div class="card"><strong>${index.summary.classifiedRows}</strong><div class="muted">classified not accepted</div></div>
    <div class="card"><strong>${index.summary.detectableRows}</strong><div class="muted">stage 3 detectable</div></div>
    <div class="card"><strong>${index.summary.supportedSubsetRows}</strong><div class="muted">stage 4 supported subset</div></div>
  </div>
  <h2>Lifecycle</h2>
  <ol>
${lifecycleHtml(index.lifecycle)}
  </ol>
  <h2>Support rule</h2>
  <p><strong>${escapeHtml(index.supportRule)}</strong></p>
  <h2>Claim guard</h2>
  <ul>
    <li>arbitrary process restore claimed: <code>${escapeHtml(index.claimGuard.arbitraryProcessRestoreClaimed)}</code></li>
    <li>raw VM replay used: <code>${escapeHtml(index.claimGuard.rawVmReplayUsed)}</code></li>
    <li>source-ISA emulation used: <code>${escapeHtml(index.claimGuard.sourceIsaEmulationUsed)}</code></li>
    <li>metadata-only success: <code>${escapeHtml(index.claimGuard.metadataOnlySuccess)}</code></li>
  </ul>
  <table>
    <thead><tr><th>Row</th><th>Binary shape</th><th>Lifecycle / support</th><th>Proof</th><th>Detection</th><th>Refusal</th><th>Next gate</th><th>Directions</th></tr></thead>
    <tbody>
${rowsHtml(index.rows)}
    </tbody>
  </table>
  <script id="embedded-native-binary-refusal-index" type="application/json">
${JSON.stringify(index, null, 2)}
  </script>
</body>
</html>
`;
}

function formatOutputs() {
  const result = spawnSync("pnpm", ["exec", "oxfmt", indexPath, htmlPath], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`oxfmt failed: ${result.stderr || result.stdout}`);
  }
}

const source = readJson(sourcePath);
const index = buildIndex(source);
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
writeFileSync(htmlPath, buildHtml(index));
formatOutputs();
console.log(JSON.stringify(index.summary, null, 2));
