import express from "express";
const app = express();
app.get("/health", (_req, res) => res.type("text/plain").send("machinen-node-portability:express"));
app.listen(process.env.PORT || 3000, "127.0.0.1");
