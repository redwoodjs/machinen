"use client";

import Monaco from "@monaco-editor/react";
import { useState } from "react";
import { saveFile } from "./functions";

// import { useHotkeys } from "react-hotkeys-hook";

export function Editor({
  pathname,
  initialContent,
}: {
  pathname: string;
  initialContent: string;
}) {
  const [modified, setModified] = useState(false);
  const [content, setContent] = useState(initialContent);

  return (
    <>
      <div className="py-2 border-b p-2 flex items-center">
        <div className={"text-sm" + (modified ? " text-blue-500" : "")}>
          {pathname}
        </div>
        <button
          onClick={async () => {
            console.log("Saving file", pathname);
            await saveFile(pathname, content);
          }}
          className="border-1 border-gray-300 ml-auto bg-gray-100 px-2 py-1"
        >
          Save
        </button>
      </div>

      <Monaco
        beforeMount={(monaco) => {
          if (typeof window === "undefined") {
            return;
          }
        }}
        className="flex"
        height="90vh"
        theme="vs-dark"
        language="typescript"
        options={{
          minimap: {
            enabled: false,
          },
        }}
        onChange={(value) => {
          if (value) {
            setModified(true);
            setContent(value);
          }
        }}
        value={content}
      />
    </>
  );
}
