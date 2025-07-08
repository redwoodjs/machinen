"use client";

import { useState, useRef } from "react";
import { saveFile } from "./functions";
import { useIsClient } from "@/hooks/useIsClient";
import { MonacoEditor } from "./components/MonacoEditor";

export function Editor({
  pathname,
  initialContent,
}: {
  pathname: string;
  initialContent: string;
}) {
  const [modified, setModified] = useState(false);
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const isClient = useIsClient();
  const monacoRef = useRef<{
    updateOriginalContent: (content: string) => void;
    getCurrentContent: () => string;
  }>(null);

  const performSave = async (
    contentToSave: string,
    isFromButton: boolean = false
  ) => {
    if (saving) return;

    setSaving(true);
    try {
      await saveFile(pathname, contentToSave);
      setContent(contentToSave);

      // Only update Monaco's ref if this came from button (not from Monaco's own Cmd+S)
      if (isFromButton && monacoRef.current) {
        monacoRef.current.updateOriginalContent(contentToSave);
      }
    } catch (error) {
      console.error("Failed to save file", error);
    } finally {
      setSaving(false);
    }
  };

  const handleButtonSave = () => {
    const currentContent = monacoRef.current?.getCurrentContent() || content;
    performSave(currentContent, true);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
  };

  const handleModifiedChange = (isModified: boolean) => {
    setModified(isModified);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with file path and save button */}
      <div className="flex items-center justify-between p-3 border-b bg-gray-50 dark:bg-gray-800">
        <div
          className={`text-sm font-mono ${
            modified
              ? "text-blue-600 dark:text-blue-400"
              : "text-gray-700 dark:text-gray-300"
          }`}
        >
          {pathname}
          {modified && <span className="ml-1">•</span>}
        </div>

        <button
          onClick={handleButtonSave}
          disabled={saving || !modified}
          className={`px-3 py-1 text-sm rounded transition-colors ${
            saving || !modified
              ? "bg-gray-200 text-gray-500 cursor-not-allowed dark:bg-gray-700 dark:text-gray-500"
              : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          }`}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Editor area */}
      <div className="flex-1">
        {isClient ? (
          <MonacoEditor
            ref={monacoRef}
            content={content}
            pathname={pathname}
            onChange={handleContentChange}
            onSave={performSave}
            onModifiedChange={handleModifiedChange}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full mx-auto mb-2"></div>
              Loading editor...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
