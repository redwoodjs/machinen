"use client";

import { useState } from "react";

export const Preview = () => {
  const [input, setInput] = useState("/");
  const [src, setSrc] = useState("/");

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault();
    setSrc(input);
  };

  return (
    <div className="h-full w-full">
      <h2 className="font-bold border-b-4">Preview</h2>
      <form onSubmit={handleGo} className="flex gap-2 mb-2">
        <input
          className="text-sm flex-1 border rounded px-2 py-1"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
        <button type="submit" className="text-sm px-3 py-1 border rounded">
          Go
        </button>

        <button
          className="text-sm px-3 py-1 border rounded"
          onClick={() => {
            console.log("Refreshing");
            setSrc(input);
          }}
        >
          Refresh
        </button>
      </form>

      <iframe src={`/preview${src}`} className="h-full w-full border rounded" />
    </div>
  );
};
