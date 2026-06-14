import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DEFAULT_GOAL = ".pi/goals/next-fifty-move-envelopes.json";
const MAX_AUTO_RESUMES_PER_SESSION = 100;

interface GoalRow {
  status?: string;
  evidence?: string;
}

interface GoalFile {
  status?: string;
  nextAction?: string;
  proofChecklist?: GoalRow[];
}

let enabled = true;
let inFlight = false;
let autoResumeCount = 0;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("goal-autoresume", {
    description: "Toggle automatic /goal continuation after checkpoint-style assistant responses",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase();
      if (mode === "on") {
        enabled = true;
      } else if (mode === "off") {
        enabled = false;
      } else if (mode === "reset") {
        enabled = true;
        autoResumeCount = 0;
      }
      ctx.ui.notify(
        `goal-autoresume: ${enabled ? "on" : "off"}, count=${autoResumeCount}/${MAX_AUTO_RESUMES_PER_SESSION}`,
        "info",
      );
    },
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!enabled || inFlight || autoResumeCount >= MAX_AUTO_RESUMES_PER_SESSION) {
      return;
    }

    const assistantText = event.messages
      .filter((message) => message.role === "assistant")
      .map((message) =>
        message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
      )
      .join("\n");

    if (!looksLikeGoalCheckpoint(assistantText)) {
      return;
    }

    const goal = await readGoal(join(ctx.cwd, DEFAULT_GOAL));
    if (!goal || goal.status !== "IN_PROGRESS") {
      return;
    }
    const proven =
      goal.proofChecklist?.filter((row) => row.status === "proven" && row.evidence).length ?? 0;
    const total = goal.proofChecklist?.length ?? 0;
    if (total === 0 || proven >= total) {
      return;
    }

    inFlight = true;
    autoResumeCount++;
    ctx.ui.notify(`goal-autoresume: continuing ${proven}/${total}`, "info");
    pi.sendUserMessage(goalResumePrompt(goal.nextAction), { deliverAs: "followUp" });
    queueMicrotask(() => {
      inFlight = false;
    });
  });
}

async function readGoal(path: string): Promise<GoalFile | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as GoalFile;
  } catch {
    return undefined;
  }
}

function looksLikeGoalCheckpoint(text: string): boolean {
  return (
    text.includes(".pi/goals/next-fifty-move-envelopes.json") ||
    /Proven rows:\s*\d+\s*\/\s*\d+/i.test(text) ||
    /Next action:/i.test(text) ||
    /Continued the active goal/i.test(text)
  );
}

function goalResumePrompt(nextAction?: string): string {
  return [
    "Continue the active /goal run.",
    "",
    `Goal file: ${DEFAULT_GOAL}`,
    "",
    "Instructions:",
    "1. Read the JSON goal file first.",
    "2. Take `nextAction` or revise it if evidence changed.",
    "3. Append meaningful results to `currentEvidence`.",
    "4. Only set proofChecklist rows to status `proven` when evidence is recorded in that row.",
    "5. Set `status` to `COMPLETE` only when every proof row is proven with evidence.",
    "6. Set `status` to `BLOCKED` if a stop condition applies.",
    "7. Keep the file valid JSON.",
    "8. Do not stop after proving one row; continue until COMPLETE, BLOCKED, or a real stop condition.",
    "",
    `Current nextAction: ${nextAction ?? "Read the goal JSON and continue from its nextAction."}`,
  ].join("\n");
}
