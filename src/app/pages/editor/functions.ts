"use server";

import { fetchContainer } from "@/container";

export interface FileItem {
  path: string;
  name: string;
  type: "file" | "directory";
}

// TODO: Add a method that proxies requests "locally" to the container server. This is "/files"

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
  return response.body;
}
