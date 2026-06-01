import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type ClaimProgressTrack = {
  id: string;
  status: string;
  currentClaim: Record<string, unknown>;
  nextClaim: Record<string, unknown> | null;
  evidence: string[];
  refusals: string[];
};

type ClaimProgressDashboard = {
  kind: "machinen.claim-progress-dashboard";
  version: 1;
  tracks: ClaimProgressTrack[];
};

describe("claim progress dashboard", () => {
  it("keeps the refreshable JSON aligned with the dashboard HTML", () => {
    const dashboard = JSON.parse(
      readFileSync(resolve("docs/snapshot/claim-progress.json"), "utf8"),
    ) as ClaimProgressDashboard;
    const html = readFileSync(resolve("docs/snapshot/claim-progress.html"), "utf8");

    expect(dashboard).toMatchObject({
      kind: "machinen.claim-progress-dashboard",
      version: 1,
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
    expect(dashboard.tracks.find((track) => track.id === "arbitrary-process")).toMatchObject({
      status: "seed-candidate",
      currentClaim: { arbitraryProcessCrossArchRestore: 0 },
      nextClaim: { arbitraryProcessCrossArchRestore: 1, claimChangeAllowed: false },
    });
    const embeddedJson =
      /<script id="embedded-claim-progress" type="application\/json">\n([\s\S]*?)\n    <\/script>/u.exec(
        html,
      )?.[1];
    expect(embeddedJson).toBeDefined();
    expect(JSON.parse(embeddedJson ?? "{}")).toEqual(dashboard);
    expect(html).toContain("claim-progress.json");
    expect(html).toContain("Load JSON file");
  });
});
