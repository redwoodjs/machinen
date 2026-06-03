import Fastify from "fastify";
const app = Fastify();
app.get("/health", async () => "machinen-node-portability:fastify");
await app.listen({ port: Number(process.env.PORT || 3000), host: "127.0.0.1" });
