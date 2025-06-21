"use server";

export interface FileItem {
  path: string;
  name: string;
  type: "file" | "directory";
}

export async function getFiles(path = "/"): Promise<FileItem[]> {
  try {
    // The user's query "Query localhost port 8080 forward slash files" has been
    // interpreted as an instruction to fetch data from that endpoint.
    const response = await fetch(`http://localhost:8080/files?path=${path}`);
    if (!response.ok) {
      console.error(
        `Error fetching files from http://localhost:8080/files: ${response.status} ${response.statusText}`
      );
      return []; // Return empty array on HTTP error, allowing the UI to show "No files found".
    }
    const filesData: FileItem[] = await response.json();
    return filesData;
  } catch (error) {
    console.error(
      "Failed to fetch files from http://localhost:8080/files due to a network error or JSON parsing error:",
      error
    );
    return []; // Return empty array on other errors, allowing the UI to show "No files found".
  }
}

export async function getFile(filePath: string): Promise<{ file: string }> {
  // fetch the file from the server from localhost:8080/file?path=...
  const response = await fetch(`http://localhost:8080/file?path=${filePath}`);
  if (!response.ok) {
    console.error(
      `Error fetching file from http://localhost:8080/file: ${response.status} ${response.statusText}`
    );
    return { file: "ERROR" };
  }
  return await response.json();
}

export async function saveFile(filePath: string, content: string) {
  console.log("Saving file", filePath, content);
  const response = await fetch(`http://localhost:8080/file?path=${filePath}`, {
    method: "POST",
    body: JSON.stringify({ content }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    console.error(
      `Error saving file to http://localhost:8080/file: ${response.status} ${response.statusText}`
    );
  }
}

export async function fileType(filePath: string) {
  const response = await fetch(
    `http://localhost:8080/file-type?path=${filePath}`
  );
  if (!response.ok) {
    console.error(
      `Error fetching file type from http://localhost:8080/file-type: ${response.status} ${response.statusText}`
    );
    return "file";
  }
  const j = await response.json<{ fileType: "file" | "directory" }>();
  return j.fileType;
}
