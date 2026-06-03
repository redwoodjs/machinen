const port = Number(process.env.PORT || 3000);
const body = await fetch(`http://127.0.0.1:${port}/state`).then((res) => res.text());
console.log(JSON.stringify({ accepted: body === "ok", body }));
process.exit(body === "ok" ? 0 : 1);
