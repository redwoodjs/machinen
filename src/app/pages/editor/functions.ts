"use server";

import { fetchContainer } from "@/container";

export interface FileItem {
  path: string;
  name: string;
  type: "file" | "directory";
}

// Enhanced process store with metadata
interface ProcessMetadata {
  processId: string;
  startTime: number;
  command: string;
  args: string[];
}

const processStore = new Map<string, ProcessMetadata>();

// // Cleanup old processes periodically (older than 1 hour)
// setInterval(() => {
//   const oneHourAgo = Date.now() - 60 * 60 * 1000;
//   for (const [pid, metadata] of processStore.entries()) {
//     if (metadata.startTime < oneHourAgo && metadata.status !== "running") {
//       processStore.delete(pid);
//     }
//   }
// }, 5 * 60 * 1000); // Check every 5 minutes

async function containerFilesFetch(
  pathname: string,
  action: "/fs/list" | "/fs/read" | "/fs/stat" | "/fs/delete" | "/fs/write",
  fetchOptions: RequestInit = {}
) {
  const url = new URL("http://localhost:8910/sandbox" + action);
  url.searchParams.set("pathname", pathname);

  const response = await fetchContainer(
    new Request(url, {
      headers: {
        "Content-Type": "application/json",
      },
      ...fetchOptions,
    })
  );
  return response.json();
}

export async function getSiblingFiles(pathname: string = "/") {
  const files = await containerFilesFetch(pathname, "/fs/list");
  return files as FileItem[];
}

export async function getFile(filePath: string) {
  const file = (await containerFilesFetch(filePath, "/fs/read")) as {
    content: string;
  };
  return file;
}

export async function fileType(filePath: string) {
  const { type } = (await containerFilesFetch(filePath, "/fs/stat")) as {
    type: "file" | "directory";
  };
  return type;
}

export async function saveFile(pathname: string, content: string) {
  return await containerFilesFetch(pathname, "/fs/stat", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

// I want to create a function that will execute a command in the container
export async function executeCommand(command: string) {
  const url = new URL("http://localhost:8910/sandbox/exec");

  const request = new Request(url, {
    method: "POST",
    body: JSON.stringify({ command }),
    headers: {
      "Content-Type": "application/json",
    },
  });
  const response = await fetch(request);

  // grab the process id from the response headers
  const processId = response.headers.get("X-Process-ID");

  if (!processId) {
    throw new Error("No process ID received from container");
  }

  // Parse command and args for storage
  let args: string[] = [];
  if (command.includes(" ")) {
    const parts = command.split(" ");
    command = parts[0];
    args = parts.slice(1);
  }

  // Store process metadata
  processStore.set(processId, {
    processId,
    startTime: Date.now(),
    command,
    args,
  });

  return response.body;
}

// Function to cancel a process
export async function cancelProcess(processId: string) {
  // const metadata = processStore.get(processId);
  // if (!metadata) {
  //   throw new Error("Process not found");
  // }
  // if (metadata.status !== "running") {
  //   throw new Error("Process is not running");
  // }
  // // Call the container to cancel the process
  // const url = new URL("http://localhost:8910/sandbox/exec/delete");
  // const response = await fetch(url, {
  //   method: "DELETE",
  //   body: JSON.stringify({ processId }),
  //   headers: {
  //     "Content-Type": "application/json",
  //   },
  // });
  // if (!response.ok) {
  //   throw new Error("Failed to cancel process");
  // }
  // // Update local metadata
  // metadata.status = "cancelled";
  // return { message: "Process cancelled successfully", processId };
}
