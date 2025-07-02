"use client";

import Monaco from "@monaco-editor/react";
import { useImperativeHandle, useRef } from "react";

interface MonacoEditorProps {
  content: string;
  pathname: string;
  onChange: (value: string) => void;
  onSave: (content: string) => Promise<void>;
  onModifiedChange: (isModified: boolean) => void;
  ref?: React.Ref<{
    updateOriginalContent: (content: string) => void;
    getCurrentContent: () => string;
  }>;
}

const getLanguageFromPath = (pathname: string) => {
  const extension = pathname.split(".").pop()?.toLowerCase();
  if (!extension) {
    return "plaintext";
  }

  const languageMap: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    html: "html",
    css: "css",
    json: "json",
    md: "markdown",
    // Add more mappings as needed
  };
  return languageMap[extension] || "plaintext";
};

export function MonacoEditor({
  content,
  pathname,
  onChange,
  onSave,
  onModifiedChange,
  ref,
}: MonacoEditorProps) {
  const originalContentRef = useRef(content);

  const editorRef = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    updateOriginalContent: (newContent: string) => {
      originalContentRef.current = newContent;
      onModifiedChange(false);
    },
    getCurrentContent: () => {
      return editorRef.current?.getValue() || "";
    },
  }));

  return (
    <Monaco
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        originalContentRef.current = content;

        // Track content changes and dirty state
        const model = editor.getModel();
        if (model) {
          model.onDidChangeContent(() => {
            const currentContent = editor.getValue();
            const isModified = currentContent !== originalContentRef.current;
            onModifiedChange(isModified);
          });
        }

        // Add save action with Cmd+S shortcut
        const filename = pathname.split("/").pop() || pathname;
        editor.addAction({
          id: "save-file",
          label: `Save ${filename}`,
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          run: async () => {
            const currentContent = editor.getValue();
            await onSave(currentContent);
            // Update the original content reference after saving
            originalContentRef.current = currentContent;
            onModifiedChange(false);
          },
        });
      }}
      className="flex"
      height="90vh"
      theme="vs-dark"
      options={{
        minimap: {
          enabled: false,
        },
        fontSize: 14,
        lineHeight: 20,
        automaticLayout: true,
      }}
      onChange={(value) => {
        if (value !== undefined) {
          onChange(value);
        }
      }}
      value={content}
      language={getLanguageFromPath(pathname)}
    />
  );
}
