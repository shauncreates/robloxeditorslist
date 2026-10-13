import { cp, mkdir, rm } from "node:fs/promises";

const output = new URL("./dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of ["index.html", "data.js", "list", "admin", "media"]) {
  await cp(new URL(`./${path}`, import.meta.url), new URL(`./dist/${path}`, import.meta.url), {
    recursive: true,
  });
}

console.log("Static site copied to dist/ for Cloudflare Pages.");
