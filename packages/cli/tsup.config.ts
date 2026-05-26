import { defineConfig } from "tsup";

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
});
