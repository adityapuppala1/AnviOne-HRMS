import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
const workspace = {
  name: "workspace-source",
  setup(builder) {
    builder.onResolve({ filter: /^@anvi\// }, async ({ path: name }) => {
      const dir = path.resolve("packages", name.split("/")[1]);
      const pkg = JSON.parse(
        await readFile(path.join(dir, "package.json"), "utf8"),
      );
      return { path: path.resolve(dir, pkg.exports) };
    });
  },
};
await build({
  entryPoints: ["apps/api/src/main.ts", "apps/worker/src/main.ts"],
  outdir: "dist",
  outbase: "apps",
  platform: "node",
  target: "node24",
  format: "esm",
  bundle: true,
  packages: "external",
  plugins: [workspace],
  sourcemap: true,
});
