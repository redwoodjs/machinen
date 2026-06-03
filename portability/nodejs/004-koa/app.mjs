import Koa from "koa";
const app = new Koa();
app.use((ctx) => {
  ctx.type = "text/plain";
  ctx.body = "machinen-node-portability:koa";
});
app.listen(process.env.PORT || 3000, "127.0.0.1");
