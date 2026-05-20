#!/usr/bin/env node
export function createPiStyleAgentState() {
  const sharedSession = { id: "session-439", runtime: "node", model: "claude-code-like" };
  const bashTool = { name: "bash", session: sharedSession, calls: 2 };
  const readTool = { name: "read", session: sharedSession, calls: 5 };
  return {
    sharedSession,
    transcript: [
      { role: "user", text: "summarize portable adapter status" },
      { role: "assistant", text: "semantic graph restore is supported" },
    ],
    tools: new Map([
      ["bash", bashTool],
      ["read", readTool],
    ]),
    activeTool: bashTool,
    counters: { turns: 2, toolCalls: 7 },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    JSON.stringify({ target: "pi-style-agent", turns: createPiStyleAgentState().counters.turns }),
  );
}
