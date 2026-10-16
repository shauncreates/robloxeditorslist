import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { inlineScriptHashes, securityHeaders } from "./functions/_security.js";

const output = new URL("./dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of ["index.html", "data.js", "list", "admin", "account", "profile", "apply", "media", "signin", "reset-password", "email-verified", "changelog", "privacy", "cookies", "terms", "assets", "_redirects"]) {
  await cp(new URL(`./${path}`, import.meta.url), new URL(`./dist/${path}`, import.meta.url), {
    recursive: true,
  });
}

// Admin HTML is gated server-side; public pages and assets stay static.
await writeFile(
  new URL("./dist/_routes.json", import.meta.url),
  JSON.stringify({ version: 1, include: ["/api/*", "/admin", "/admin/*"], exclude: [] }, null, 2) + "\n",
);

console.log("Static site copied to dist/ for Cloudflare Pages.");

const pages = ["index.html", ...["list", "admin", "account", "profile", "apply", "signin", "reset-password", "email-verified", "changelog", "privacy", "cookies", "terms"].map(path => path + "/index.html")];
const hashes = new Set();
for (const page of pages) {
  for (const hash of await inlineScriptHashes(await readFile(new URL(page, output), "utf8"))) hashes.add(hash);
}
await writeFile(new URL("_headers", output), "/*\n" + Object.entries(securityHeaders([...hashes])).map(([name, value]) => `  ${name}: ${value}\n`).join(""));
