import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "@/app/Document";

import { EditorPage } from "@/app/pages/editor/EditorPage";
import { fetchContainer } from "./container";

console.log("Worker started");

const app = defineApp([
  render(Document, [
    route("/editor", EditorPage),
    route("/editor*", EditorPage),
    route("/ping", () => new Response("pong")),
  ]),

  route("/preview*", async ({ request }) => {
    return fetchContainer(request);
  }),
]);

export default {
  fetch(request: Request, env: any, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};
