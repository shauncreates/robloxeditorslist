import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const output = new URL("./dist/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const path of ["index.html", "data.js", "list", "admin", "account", "profile", "apply", "media", "signin", "reset-password", "email-verified", "changelog", "tiktok-privacy", "assets", "_redirects"]) {
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
