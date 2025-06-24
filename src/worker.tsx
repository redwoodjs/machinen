import { defineApp, ErrorResponse } from "rwsdk/worker";
import { route, render, prefix } from "rwsdk/router";
import { Document } from "@/app/Document";

import { setCommonHeaders } from "@/app/headers";
import { EditorPage } from "@/app/pages/editor/EditorPage";
import { env } from "cloudflare:workers";

export { RuntimeContainer as Container } from "./container";

export default defineApp([
  render(Document, [
    route("/editor", EditorPage),
    route("/editor*", EditorPage),

    route("/ping", () => new Response("pong")),
  ]),

  route("*", async ({ request }) => {
    try {
      let id = env.CONTAINER.idFromName("rwsdk");
      let container = env.CONTAINER.get(id);
      const response = await container.fetch(new Request(request.url));
      return response;
    } catch (e) {
      return new Response("Error" + e, { status: 500 });
    }
  }),
]);
