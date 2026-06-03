const expected = JSON.parse(process.env.MACHINEN_EXPECTED_OBJECT_JSON ?? "{}");
const port = Number(process.env.PORT || 3000);
const actual = await fetch(`http://127.0.0.1:${port}/state`).then((res) => res.json());
const accepted =
  actual.anchor === expected.anchor &&
  actual.kind === expected.kind &&
  actual.message === expected.message &&
  actual.countLabel === expected.countLabel &&
  actual.nestedLabel === expected.nestedLabel &&
  actual.count === 7 &&
  actual.nested?.label === "portable";
console.log(JSON.stringify({ accepted, actual, expected }));
process.exit(accepted ? 0 : 1);
