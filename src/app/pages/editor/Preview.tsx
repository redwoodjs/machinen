"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/button";

import { RefreshCcw } from "lucide-react";

export const Preview = () => {
  const [input, setInput] = useState("/");
  const [src, setSrc] = useState("/");

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault();
    setSrc(input);
  };

  return (
    <div className="flex flex-col">
      <form onSubmit={handleGo} className="flex gap-2 mb-2 ">
        <Button
          variant="outline"
          onClick={() => {
            console.log("Refreshing");
            setSrc(input);
          }}
        >
          <RefreshCcw />
        </Button>
        <input
          className="text-sm flex-1 border border-gray-800 rounded px-2 py-1"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
        />
        <Button type="submit" variant="default">
          Go
        </Button>
      </form>

      <iframe src={`/preview${src}`} className="flex-1" />
    </div>
  );
};
