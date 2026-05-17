// `machinen feedback` — agent-friction reporting (Trevin's principle 10).
// Local JSONL by default at ~/.machinen/feedback.jsonl; with
// MACHINEN_FEEDBACK_ENDPOINT set, the entry also POSTs upstream.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_PATH = join(homedir(), ".machinen", "feedback.jsonl");

export function feedbackPath(): string {
  return process.env.MACHINEN_FEEDBACK_PATH ?? DEFAULT_PATH;
}

interface FeedbackEntry {
  timestamp: string;
  cli_version: string;
  text: string;
}

export function appendFeedback(entry: FeedbackEntry, path: string = feedbackPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

export function readFeedback(path: string = feedbackPath()): FeedbackEntry[] {
  if (!existsSync(path)) {
    return [];
  }
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
  const entries: FeedbackEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines rather than crashing — partial writes
      // shouldn't make `feedback --list` unusable.
    }
  }
  return entries;
}

interface UpstreamPostResult {
  attempted: boolean;
  status: number | null;
  error: string | null;
}

export async function postUpstream(
  entry: FeedbackEntry,
  endpoint: string | undefined = process.env.MACHINEN_FEEDBACK_ENDPOINT,
): Promise<UpstreamPostResult> {
  if (!endpoint) {
    return { attempted: false, status: null, error: null };
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    return { attempted: true, status: res.status, error: null };
  } catch (err) {
    return {
      attempted: true,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
