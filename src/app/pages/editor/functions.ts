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
  action: "LIST" | "READ" | "TYPE" | "DELETE" | "WRITE",
  body?: { content: string }
) {
  const url = new URL("http://localhost:8910/files");
  url.searchParams.set("pathname", pathname);
  url.searchParams.set("action", action);

  const response = await fetchContainer(
    new Request(url, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  );
  return response.json();
}

export async function getSiblingFiles(pathname: string = "/") {
  const files = await containerFilesFetch(pathname, "LIST");
  return files as FileItem[];
}

export async function getFile(filePath: string) {
  const file = (await containerFilesFetch(filePath, "READ")) as {
    content: string;
  };
  return file;
}

export async function fileType(filePath: string) {
  const { type } = (await containerFilesFetch(filePath, "TYPE")) as {
    type: "file" | "directory";
  };
  return type;
}

export async function saveFile(pathname: string, content: string) {
  await containerFilesFetch(pathname, "WRITE", { content });
}
