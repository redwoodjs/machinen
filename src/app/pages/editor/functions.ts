"use server";

import { fetchContainer } from "@/container";

export interface FileItem {
  path: string;
  name: string;
  type: "file" | "directory";
}

export let CURRENT_PROCESS_ID: string;
export let CURRENT_PROCESS_OUTPUT: ReadableStream;

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
  const url = new URL("http://localhost:8910/sandbox/tty/exec");

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
  CURRENT_PROCESS_ID = processId || "";
  return CURRENT_PROCESS_ID;
}

export async function getProcessOutput() {
  if (!CURRENT_PROCESS_ID) {
    return null;
  }
  const url = new URL("http://localhost:8910/sandbox/tty/output");
  url.searchParams.set("processId", CURRENT_PROCESS_ID);
  const request = await fetch(url);
  return request.body;
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
