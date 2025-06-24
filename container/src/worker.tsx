import { defineApp, ErrorResponse } from "rwsdk/worker";
import { route, render, prefix } from "rwsdk/router";
import { Document } from "@/app/Document";
import { setCommonHeaders } from "@/app/headers";
import { Session } from "./session/durableObject";
export { SessionDurableObject } from "./session/durableObject";

export type AppContext = {
  session: Session | null;
};

export default defineApp([
  setCommonHeaders(),
  render(Document, [
    route("/", () => (
      <>
        <h1>hello world!!!!!!</h1>
      </>
    )),
    route("/a", () => (
      <>
        <h1>A!!</h1>
      </>
    )),
    route("/b", () => (
      <>
        <h1>B</h1>
      </>
    )),
  ]),
]);
