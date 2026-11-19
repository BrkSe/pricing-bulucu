import { build } from "esbuild";
import { spawnSync } from "node:child_process";

const inline = spawnSync(process.execPath, ["scripts/inline-page.mjs"], { stdio: "inherit" });
if (inline.status !== 0) process.exit(inline.status ?? 1);

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: "/opt/cursor/artifacts/worker.js",
  legalComments: "none",
  minify: true,
  conditions: ["worker", "browser"],
  external: ["node:*"],
});
