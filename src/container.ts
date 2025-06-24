import { Container as PkgContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

const DEFAULT_PORT = 8910;
export class RuntimeContainer extends PkgContainer {
  defaultPort = DEFAULT_PORT;
}

export function fetchContainer(request: Request) {
  let url = new URL(request.url);

  const headers = new Headers(request.headers);
  const internalQuery = url.searchParams.get("__x_internal_query");
  if (internalQuery) {
    const originalQuery = decodeURIComponent(internalQuery);
    url.search = originalQuery ? "?" + originalQuery : "";
    url.searchParams.delete("__x_internal_query");
  }

  if (headers.has("x-websocket-protocol")) {
    console.log(
      `Renaming 'x-websocket-protocol' to 'sec-websocket-protocol' for ${request.url}`
    );
    headers.set("sec-websocket-protocol", headers.get("x-websocket-protocol")!);
    headers.delete("x-websocket-protocol");
  }

  const requestInit: RequestInit = {
    method: request.method,
    headers,
    body: request.body ? request.body : undefined,
    redirect: request.redirect,
  };

  if (process.env.NODE_ENV === "development") {
    if (url.pathname.startsWith("/preview")) {
      url.port = DEFAULT_PORT.toString();
      return fetch(url, requestInit);
    } else {
      return fetch(request);
    }
  } else {
    let id = env.CONTAINER.idFromName("rwsdk");
    let container = env.CONTAINER.get(id);
    return container.fetch(request, requestInit);
  }
}
