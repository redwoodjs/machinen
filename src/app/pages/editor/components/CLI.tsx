"use client";

import { useState } from "react";
import { executeCommand } from "../functions";
import { consumeEventStream } from "rwsdk/client";

export function CLI() {
  const [output, setOutput] = useState("");
  const [command, setCommand] = useState("ls");

  return (
    <div>
      <h1 className="text-2xl font-bold">CLI</h1>
      <pre className="flex-1 overflow-auto bg-amber-200 vh-90">{output}</pre>
      <input
        className="w-full bg-white"
        onChange={(e) => setCommand(e.target.value)}
        value={command}
      />

      <button
        className="bg-blue-500 text-white p-2 rounded-md"
        onClick={async () => {
          const response = await executeCommand(command);

          if (!response) {
            console.log("No response");
            return;
          }

          // Method 1: Read entire stream as text
          const reader = response.getReader();
          const decoder = new TextDecoder();
          let fullText = "";

          const readStream = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              fullText += decoder.decode(value, { stream: true });
            }
            setOutput(fullText);
            console.log("Full response:", fullText);
          };

          readStream();
        }}
      >
        RUN COMMAND
      </button>
    </div>
  );
}
