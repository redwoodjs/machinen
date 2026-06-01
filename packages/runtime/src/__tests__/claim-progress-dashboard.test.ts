import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type ClaimProgressDetailRow = Record<string, unknown>;

type ClaimProgressTrack = {
  id: string;
  status: string;
  currentClaim: Record<string, unknown>;
  nextClaim: Record<string, unknown> | null;
  evidence: string[];
  refusals: string[];
  evidenceRows: ClaimProgressDetailRow[];
  refusalRows: ClaimProgressDetailRow[];
  nextSteps: ClaimProgressDetailRow[];
};

type ClaimProgressDashboard = {
  kind: "machinen.claim-progress-dashboard";
  version: 2;
  tracks: ClaimProgressTrack[];
};

describe("claim progress dashboard", () => {
  it("keeps the automatic dashboard JSON aligned with the dashboard HTML", () => {
    const dashboard = JSON.parse(
      readFileSync(resolve("docs/snapshot/claim-progress.json"), "utf8"),
    ) as ClaimProgressDashboard;
    const html = readFileSync(resolve("docs/snapshot/claim-progress.html"), "utf8");

    expect(dashboard).toMatchObject({
      kind: "machinen.claim-progress-dashboard",
      version: 2,
    });
    expect(dashboard.tracks.map((track) => track.id)).toEqual([
      "node-service",
      "arbitrary-process",
      "postgres",
      "bun",
    ]);
    expect(dashboard.tracks.find((track) => track.id === "node-service")).toMatchObject({
      status: "claimed",
      currentClaim: {
        productSupport: 100,
        broadSupport: 100,
        arbitraryProcessCrossArchRestore: 0,
      },
    });
    const arbitraryProcess = dashboard.tracks.find((track) => track.id === "arbitrary-process");
    expect(arbitraryProcess).toMatchObject({
      status: "seed-candidate",
      currentClaim: { arbitraryProcessCrossArchRestore: 0 },
      nextClaim: { arbitraryProcessCrossArchRestore: 1, claimChangeAllowed: false },
    });
    expect(arbitraryProcess?.evidenceRows.map((row) => row.id)).toContain(
      "native-ping-socket-resource",
    );
    expect(dashboard.tracks.every((track) => track.evidenceRows.length > 0)).toBe(true);
    expect(dashboard.tracks.every((track) => track.refusalRows.length > 0)).toBe(true);
    const embeddedJson =
      /<script id="embedded-claim-progress" type="application\/json">\n([\s\S]*?)\n    <\/script>/u.exec(
        html,
      )?.[1];
    expect(embeddedJson).toBeDefined();
    expect(JSON.parse(embeddedJson ?? "{}")).toEqual(dashboard);
    expect(html).toContain("claim-progress.json");
    expect(html).toContain("Track summary");
    expect(html).toContain("Evidence detail");
    expect(html).toContain("Refusal boundaries");
    expect(html).toContain("Next steps");
    expect(html).not.toContain("Load JSON file");
    expect(html).not.toContain("Refresh JSON");
  });
});
