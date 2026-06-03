import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type PortableVmManifestPlan = {
  kind: "machinen.portable-vm-manifest-plan";
  version: 1;
  status: "draft-for-validation";
  scope: "cross-architecture-portable-whole-vm-restore-v1";
  claimGuard: Record<string, boolean>;
  productIntent: Record<string, string>;
  workflow: Array<Record<string, unknown>>;
  targetPolicy: { unknownStatePolicy: "refuse-by-default" };
  manifest: Record<string, Array<Record<string, unknown>>>;
  plan: { rows: Array<Record<string, unknown>> };
  summary: Record<string, unknown>;
  validationRules: string[];
};

describe("portable VM manifest/plan dashboard", () => {
  it("keeps the draft JSON structure aligned with the standalone HTML renderer", () => {
    const manifestPlan = JSON.parse(
      readFileSync(resolve("docs/snapshot/portable-vm-manifest-plan.json"), "utf8"),
    ) as PortableVmManifestPlan;
    const html = readFileSync(resolve("docs/snapshot/portable-vm-manifest-plan.html"), "utf8");
    const embeddedJson =
      /<script id="embedded-portable-vm-manifest-plan" type="application\/json">\n([\s\S]*?)\n    <\/script>/u.exec(
        html,
      )?.[1];

    expect(manifestPlan).toMatchObject({
      kind: "machinen.portable-vm-manifest-plan",
      version: 1,
      status: "draft-for-validation",
      scope: "cross-architecture-portable-whole-vm-restore-v1",
    });
    expect(JSON.parse(embeddedJson ?? "{}")).toEqual(manifestPlan);
    expect(manifestPlan.productIntent).toMatchObject({
      goal: expect.stringContaining("Pause a VM"),
      notGoal: expect.stringContaining("raw vCPU replay"),
      nextImplementationStep: expect.stringContaining("guest inventory agent"),
    });
    expect(manifestPlan.workflow.map((step) => step.name)).toEqual([
      "pause/quiesce VM",
      "inventory VM",
      "classify rows",
      "plan restore",
      "restore target-native VM",
      "retain proof artifacts",
    ]);
    expect(manifestPlan.claimGuard).toMatchObject({
      publicClaimAllowed: false,
      arbitraryVmRestoreClaimed: false,
      arbitraryLinuxProcessRestoreClaimed: false,
      rawVmStateReplayAllowed: false,
      crossIsaVcpuReplayAllowed: false,
      sourceIsaEmulationAllowed: false,
      metadataOnlySuccessAllowed: false,
    });
    expect(manifestPlan.targetPolicy.unknownStatePolicy).toBe("refuse-by-default");
    expect(manifestPlan.plan.rows).toHaveLength(8);
    expect(manifestPlan.plan.rows.filter((row) => row.disposition === "refused")).toHaveLength(4);
    for (const row of manifestPlan.plan.rows.filter(
      (candidate) => candidate.disposition === "refused",
    )) {
      expect(row.refusalCode).toEqual(expect.stringMatching(/^portable-vm-/u));
    }
    for (const rows of Object.values(manifestPlan.manifest)) {
      for (const row of rows) {
        expect(row.disposition).toEqual(expect.any(String));
      }
    }
    expect(html).toContain("Portable VM Manifest / VM Portability Plan");
    expect(html).toContain("single-tracking-table");
    expect(html).toContain("tracking-table");
    expect(html).toContain("<th>Section</th>");
    expect(html).toContain("<th>Row / item</th>");
    expect(html).toContain("<th>Disposition / value</th>");
    expect(html).toContain("subheading");
    expect(html).toContain("What are we doing, and why?");
    expect(html).toContain("mixed VM state");
    expect(html).toContain("mostly whole-VM restore");
    expect(html).toContain("Workflow");
    expect(html).toContain("pause/quiesce VM");
    expect(html).toContain("restore target-native VM");
    expect(html).toContain("Claim guard");
    expect(html).toContain("Plan rows");
    expect(html).toContain("Manifest inventory");
    expect(html).toContain("target-native-reconstruction");
    expect(html).toContain("portable-vm-active-db-state-unsupported");
    expect(html).toContain(
      "A manifest/plan alone must not raise a public arbitrary VM restore claim.",
    );
  });

  it("keeps the guest inventory contract and retained generated plan claim-guarded", () => {
    const contract = JSON.parse(
      readFileSync(resolve("docs/snapshot/portable-vm-guest-inventory-contract.json"), "utf8"),
    ) as {
      kind: string;
      version: number;
      requiredTopLevelFields: string[];
      claimGuard: Record<string, boolean>;
    };
    const report = JSON.parse(
      readFileSync(
        resolve(
          "proofs/linux-vm-workload/portable-vm-guest-inventory-plan/retained/portable-vm-guest-inventory-plan-report.json",
        ),
        "utf8",
      ),
    ) as {
      accepted: boolean;
      scope: string;
      publicClaimAllowed: boolean;
      arbitraryVmRestoreClaimed: boolean;
      summary: Record<string, unknown>;
    };
    const generatedPlan = JSON.parse(
      readFileSync(
        resolve(
          "proofs/linux-vm-workload/portable-vm-guest-inventory-plan/retained/portable-vm-manifest-plan.generated.json",
        ),
        "utf8",
      ),
    ) as PortableVmManifestPlan;

    expect(contract).toMatchObject({
      kind: "machinen.portable-vm-guest-inventory-contract",
      version: 1,
    });
    expect(contract.requiredTopLevelFields).toEqual([
      "kind",
      "version",
      "sourceVm",
      "pause",
      "filesystems",
      "services",
      "processes",
      "network",
      "databases",
      "devices",
      "kernelState",
    ]);
    expect(contract.claimGuard).toMatchObject({
      publicClaimAllowed: false,
      arbitraryVmRestoreClaimed: false,
      rawVmStateReplayAllowed: false,
      crossIsaVcpuReplayAllowed: false,
      sourceIsaEmulationAllowed: false,
      metadataOnlySuccessAllowed: false,
    });
    expect(report).toMatchObject({
      accepted: true,
      scope: "fixture-guest-inventory-portable-vm-plan-v1",
      publicClaimAllowed: false,
      arbitraryVmRestoreClaimed: false,
      summary: {
        collectorInputRows: 12,
        rawInventoryRowsFromGuestInput: 12,
        planRows: 12,
        refusedRows: 5,
        unknownRowsAccepted: 0,
        productSupportRowsAdded: 0,
        arbitraryVmRestoreRowsAdded: 0,
      },
    });
    expect(generatedPlan).toMatchObject({
      kind: "machinen.portable-vm-manifest-plan",
      status: "generated-proof",
      scope: "fixture-guest-inventory-portable-vm-plan-v1",
      claimGuard: {
        publicClaimAllowed: false,
        arbitraryVmRestoreClaimed: false,
      },
      summary: {
        rawInventoryItems: 12,
        planRows: 12,
        refusedRows: 5,
        unknownRows: 0,
      },
    });
  });
});
