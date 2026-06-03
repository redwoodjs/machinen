import http from "node:http";
const expected = "machinen-node-portability:native-addon-app";
const req = http.get("http://127.0.0.1:" + (process.env.PORT || 3000) + "/health", (res) => {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (c) => (body += c));
  res.on("end", () => {
    if (body !== expected) {
      console.error(JSON.stringify({ accepted: false, expected, body }));
      process.exit(1);
    }
    console.log(JSON.stringify({ accepted: true, body }));
  });
});
req.on("error", (error) => {
  console.error(String(error));
  process.exit(1);
});
