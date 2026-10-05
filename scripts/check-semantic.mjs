import assert from "node:assert/strict";
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const sign = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = sign.headers.get("set-cookie")?.split(";")[0];
const fragments = [
  {
    id: crypto.randomUUID(),
    text: "And so, um, now that we have the inclusions, natural numbers are contained in the integers, which are contained in the rational numbers, which are contained in the real numbers, okay? And, you know, if",
  },
  {
    id: crypto.randomUUID(),
    text: "you kind of look at the history of why these things were thought up in the first place, I mean, they were thought up to solve, uh, you know",
  },
  {
    id: crypto.randomUUID(),
    text: "and of polynomial equations that you couldn't solve in the number system before. Uh",
  },
];
async function translate(rows, force = false) {
  const response = await fetch(base + "/api/translate/segments", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      fragments: rows,
      context:
        "A real analysis lecture about number systems and polynomial equations.",
      force,
    }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data;
}
const tail = await translate(fragments.slice(0, 1));
assert.equal(tail.groups.length, 0, "if-clause must wait for following speech");
console.log("PASS real DeepSeek defers the unfinished if-clause.");
const complete = await translate(fragments);
assert.ok(complete.groups.length > 0);
assert.deepEqual(
  complete.groups[0].ids,
  fragments.map((f) => f.id),
  "pause fragments must form one coherent explanation",
);
console.log(
  "PASS real DeepSeek merges three screenshot fragments:",
  complete.groups[0].translation,
);
const forced = await translate(
  [{ id: crypto.randomUUID(), text: "And if we consider" }],
  true,
);
assert.equal(forced.groups.length, 1);
console.log(
  "PASS final unfinished tail is translated on stop:",
  forced.groups[0].translation,
);
