import { Container, getContainer } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

const DEFAULT_PORT = 8910;

// NOTE: Should we convert this to just a standard Durable Object? Does the container have access to different ports?

export class RuntimeContainer extends Container {
  defaultPort = DEFAULT_PORT;
}

export function fetchContainer(request: Request) {
  // Clone the request and modify the port to 8910
  const url = new URL(request.url);
  url.port = DEFAULT_PORT.toString();
  const modifiedRequest = new Request(url.toString(), request);

  if (process.env.NODE_ENV === "development") {
    try {
      return fetch(modifiedRequest);
    } catch (error) {
      console.error(error);
      return new Response("Error fetching container, is server running?", {
        status: 500,
      });
    }
  } else {
    const container = getContainer(env.RUNTIME_CONTAINER, "1");
    return container.fetch(modifiedRequest);
  }
}
