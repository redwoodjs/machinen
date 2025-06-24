"use client";
import { useState } from "react";

export const Preview = () => {
  const [src, setSrc] = useState("/");

  return (
    <>
      <input
        className="text-sm w-full border rounded px-2 py-1 mb-2"
        type="text"
        value={src}
        onChange={(e) => setSrc(e.target.value)}
        spellCheck={false}
      />
      <iframe src={`/preview${src}`} className="h-full w-full border rounded" />
    </>
  );
};
