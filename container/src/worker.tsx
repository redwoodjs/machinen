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
        <h1>hello</h1>
      </>
    )),
  ]),
]);
