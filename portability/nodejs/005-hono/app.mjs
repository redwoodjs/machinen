import { Hono } from "hono";
import { serve } from "@hono/node-server";
const app = new Hono();
app.get("/health", (c) => c.text("machinen-node-portability:hono"));
serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000), hostname: "127.0.0.1" });
