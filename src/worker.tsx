import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "@/app/Document";

import { EditorPage } from "@/app/pages/editor/EditorPage";

import { fetchContainer } from "./container";
export { RuntimeContainer } from "./container";

export default defineApp([
  render(Document, [
    route("/", () => {
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <h1 className="text-4xl font-bold">Machinen</h1>
          <p className="text-lg">
            This is a preview of Machinen,
            <br /> a web-based text editor for RedwoodSDK.
            <br /> Check out the{" "}
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
  ]),

  route("/preview*", async ({ request }) => {
    const url = new URL(request.url);
    url.pathname = url.pathname.slice("/preview".length);
    const modifiedRequest = new Request(url.toString(), request);
    return fetchContainer(modifiedRequest);
  }),
]);
