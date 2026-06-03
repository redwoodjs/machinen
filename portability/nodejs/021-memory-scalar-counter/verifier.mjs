const port = Number(process.env.PORT || 3000);
const initial = await fetch(`http://127.0.0.1:${port}/value`)
  .then((res) => res.text())
  .then(Number);
const incremented = await fetch(`http://127.0.0.1:${port}/inc`)
  .then((res) => res.text())
  .then(Number);
console.log(
  JSON.stringify({ accepted: initial === 41 && incremented === 42, initial, incremented }),
);
process.exit(initial === 41 && incremented === 42 ? 0 : 1);
