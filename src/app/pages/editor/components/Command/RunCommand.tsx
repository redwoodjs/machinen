"use client";

import { useState } from "react";
import { executeCommand } from "../../functions";

export function RunCommand({ isRunning }: { isRunning: boolean }) {
  const [command, setCommand] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await executeCommand(command);
    setCommand("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        className="flex-1 bg-white border-2 border-gray-300 rounded-md p-2"
        type="text"
        onChange={(e) => setCommand(e.target.value)}
        value={command}
      />
      <button type="submit">Run</button>
    </form>
  );
}
