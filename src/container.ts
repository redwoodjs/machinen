import { Container as PkgContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export class RuntimeContainer extends PkgContainer {
  defaultPort = 8910;
}

export function fetchContainer(request: Request) {
  if (process.env.NODE_ENV === "development") {
    return fetch(request);
  } else {
    let id = env.CONTAINER.idFromName("rwsdk");
    let container = env.CONTAINER.get(id);
    return container.fetch(request);
  }
}
