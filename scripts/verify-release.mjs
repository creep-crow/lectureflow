import { readFile, readdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
const root = resolve("dist");
// Cloudflare generates this local-development sidecar during builds.
// Runtime secrets are managed by Sites; they must never enter the archive.
for (const relative of ["server/.dev.vars", "server/.env"]) {
  const path = resolve(root, relative);
  if (!path.startsWith(root + "\\") && !path.startsWith(root + "/"))
    throw new Error("Unsafe path");
  await unlink(path).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
}
const env = await readFile(".env", "utf8")
  .then(parseEnv)
  .catch(() => ({}));
const secrets = Object.values(env).filter((value) => value.length >= 12);
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await scan(file);
    else {
      const bytes = await readFile(file);
      if (secrets.some((value) => bytes.includes(Buffer.from(value))))
        throw new Error("Release contains a runtime secret in " + file);
      if (/^\.env|^\.dev\.vars/.test(entry.name))
        throw new Error("Release contains a local environment file");
    }
  }
}
await scan(root);
console.log(
  "PASS release output contains no configured API keys or local environment files.",
);
