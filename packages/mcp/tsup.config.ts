import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

// Inject the current package.json version so the MCP server's handshake
// reports the real published version, not a stale hardcoded one.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  // Bundle @deloc/shared into the output so we don't need workspace:* at runtime
  noExternal: ["@deloc/shared"],
  define: {
    __PKG_VERSION__: JSON.stringify(pkg.version),
  },
});
