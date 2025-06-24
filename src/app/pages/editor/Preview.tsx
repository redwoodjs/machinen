"use client";
import { useState } from "react";

export const Preview = () => {
  const [input, setInput] = useState("/");
  const [src, setSrc] = useState("/");

  const handleGo = () => {
    setSrc(input);
  };

  return (
    <>
      <input
        className="text-sm flex-1 border rounded px-2 py-1"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        spellCheck={false}
      />
      <button
        onClick={handleGo}
        className="text-sm px-3 py-1 border rounded bg-gray-100 hover:bg-gray-200"
      >
        Go
      </button>
      <iframe src={`/preview${src}`} className="h-full w-full border rounded" />
    </>
  );
};
