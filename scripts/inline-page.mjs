import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("public/index.html", "utf8");
const css = readFileSync("public/styles.css", "utf8");
const js = readFileSync("public/app.js", "utf8");
const page = html
  .replace('<link rel="stylesheet" href="/styles.css" />', `<style>${css}</style>`)
  .replace('<script src="/app.js" defer></script>', `<script>${js}</script>`);

writeFileSync("src/page.ts", `export const PAGE_HTML = ${JSON.stringify(page)};\n`);
