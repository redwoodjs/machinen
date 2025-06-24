import { defineApp, ErrorResponse } from "rwsdk/worker";
import { route, render, prefix } from "rwsdk/router";
import { Document } from "@/app/Document";

import { setCommonHeaders } from "@/app/headers";
import { EditorPage } from "@/app/pages/editor/EditorPage";
import { fetchContainer } from "./container";

export { RuntimeContainer as Container } from "./container";

export default defineApp([
  render(Document, [
    route("/editor", EditorPage),
    route("/editor*", EditorPage),

    route("/ping", () => new Response("pong")),
  ]),

  route("/preview/*", async ({ request }) => {
    return fetchContainer(request);
  }),
]);
