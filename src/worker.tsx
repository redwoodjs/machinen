import { defineApp, ErrorResponse } from "rwsdk/worker";
import { route, render, prefix } from "rwsdk/router";
import { Document } from "@/app/Document";

import { sessions, setupSessionStore } from "./session/store";
import { Session } from "./session/durableObject";
import { type User, db, setupDb } from "@/db";
import { env } from "cloudflare:workers";
export { SessionDurableObject } from "./session/durableObject";

import { setCommonHeaders } from "@/app/headers";
import { EditorPage } from "@/app/pages/editor/EditorPage";

export type AppContext = {
  session: Session | null;
  user: User | null;
};

export default defineApp([
  // setCommonHeaders(),
  // async ({ ctx, request, headers }) => {
  //   await setupDb(env);
  //   setupSessionStore(env);

  //   try {
  //     ctx.session = await sessions.load(request);
  //   } catch (error) {
  //     if (error instanceof ErrorResponse && error.code === 401) {
  //       await sessions.remove(request, headers);
  //       headers.set("Location", "/user/login");

  //       return new Response(null, {
  //         status: 302,
  //         headers,
  //       });
  //     }

  //     throw error;
  //   }

  //   if (ctx.session?.userId) {
  //     ctx.user = await db.user.findUnique({
  //       where: {
  //         id: ctx.session.userId,
  //       },
  //     });
  //   }
  // },

  render(Document, [route("/editor*", EditorPage)]),

  route("*", async ({ request }) => {
    // we'll change host in the request.
    const url = new URL(request.url);
    url.port = "5174";
    url.hostname = "localhost";

    // proxy request to dev-server in container
    return await fetch(url.toString(), {
      headers: request.headers,
    });
  }),
]);
