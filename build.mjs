import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = new URL("./dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of ["index.html", "data.js", "list", "admin", "media"]) {
  await cp(new URL(`./${path}`, import.meta.url), new URL(`./dist/${path}`, import.meta.url), {
    recursive: true,
  });
}

// Only API requests should invoke Pages Functions. Static pages, images and scripts
// remain static requests and do not consume the Functions request allowance.
await writeFile(
  new URL("./dist/_routes.json", import.meta.url),
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }, null, 2) + "\n",
);

console.log("Static site copied to dist/ for Cloudflare Pages.");
