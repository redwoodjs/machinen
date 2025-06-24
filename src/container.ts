import { Container as PkgContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

const DEFAULT_PORT = 8910;
export class RuntimeContainer extends PkgContainer {
  defaultPort = DEFAULT_PORT;
}

export function fetchContainer(request: Request) {
  if (process.env.NODE_ENV === "development") {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/preview")) {
      url.port = DEFAULT_PORT.toString();
      url.pathname = url.pathname.slice("/preview".length);
      return fetch(url, request);
    } else {
      return fetch(request);
    }
  } else {
    let id = env.CONTAINER.idFromName("rwsdk");
    let container = env.CONTAINER.get(id);
    return container.fetch(request);
  }
}
