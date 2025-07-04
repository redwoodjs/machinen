"use client";

import { useEffect, useState } from "react";
import { getProcessOutput } from "../../functions";

export function Output({ processId }: { processId: string }) {
  const [output, setOutput] = useState("");

  useEffect(() => {
    setOutput("");
    async function fetchOutput() {
      const output = await getProcessOutput();
      if (!output) return;
      const reader = output.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((prev) => prev + new TextDecoder().decode(value));
      }
    }
    fetchOutput();

    // fetch process output
  }, [processId]);

  return (
    <div className="flex-1 overflow-y-auto bg-amber-200 p-2">
      <pre className="font-mono text-sm whitespace-pre-wrap">{output}</pre>
    </div>
  );
}
