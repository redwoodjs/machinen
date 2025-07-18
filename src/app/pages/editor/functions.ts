"use server";

import { fetchContainer } from "@/container";

export interface FileItem {
  path: string;
  name: string;
  type: "file" | "directory";
}

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
  return await containerFilesFetch(pathname, "/fs/write", {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}
