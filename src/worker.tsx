import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "@/app/Document";

import { EditorPage } from "@/app/pages/editor/EditorPage";
import { TermPage } from "@/app/pages/TermPage";
import { fetchContainer } from "./container";
export { RuntimeContainer as Container } from "./container";

import { TestPage } from "@/app/pages/TestPage";

export default defineApp([
  render(Document, [
    route("/", () => {
      return (
        <div>
          <h1>Machinen</h1>
          <p>
            This is a preview of Machinen, a web-based text editor for
            RedwoodSDK. Check out the{" "}
            <a href="/editor" className="text-blue-500 underline">
              editor!
            </a>
          </p>
        </div>
      );
    }),
    route("/editor", EditorPage),
    route("/editor*", EditorPage),
    route("/ping", () => new Response("pong")),
    route("/term", TermPage),
    route("/resize", TestPage),
  ]),

  route("/preview*", async ({ request }) => {
    return fetchContainer(request);
  }),
]);
