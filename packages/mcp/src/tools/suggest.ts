import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectBuildDir, detectBuildCommand, formatBytes, TIER_LIMITS } from "@deloc/shared";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { requireToken, apiFetch } from "../api.js";

const FRAMEWORK_FILES: Record<string, string> = {
  "vite.config.ts": "Vite",
  "vite.config.js": "Vite",
  "vite.config.mts": "Vite",
  "next.config.js": "Next.js",
  "next.config.mjs": "Next.js",
  "next.config.ts": "Next.js",
  "angular.json": "Angular",
  "svelte.config.js": "SvelteKit",
  "svelte.config.ts": "SvelteKit",
  "astro.config.mjs": "Astro",
  "astro.config.ts": "Astro",
  "nuxt.config.ts": "Nuxt",
  "nuxt.config.js": "Nuxt",
  "gatsby-config.js": "Gatsby",
  "gatsby-config.ts": "Gatsby",
};

async function detectFramework(dir: string): Promise<string> {
  for (const [file, name] of Object.entries(FRAMEWORK_FILES)) {
    try {
      await access(join(dir, file));
      return name;
    } catch { /* not found */ }
  }
  try {
    await access(join(dir, "index.html"));
    return "Plain HTML";
  } catch { /* not found */ }
  return "Unknown";
}

async function getDirectorySize(dir: string): Promise<{ totalBytes: number; fileCount: number }> {
  let totalBytes = 0;
  let fileCount = 0;
  try {
    const entries = await readdir(dir, { recursive: true });
    for (const entry of entries) {
      try {
        const s = await stat(join(dir, String(entry)));
        if (s.isFile()) {
          totalBytes += s.size;
          fileCount++;
        }
      } catch { /* skip inaccessible files */ }
    }
  } catch { /* dir doesn't exist */ }
  return { totalBytes, fileCount };
}

async function suggestName(dir: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
    if (typeof pkg.name === "string" && pkg.name.length > 0 && !pkg.name.startsWith("@")) {
      return pkg.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    }
  } catch { /* no package.json */ }
  return basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function registerSuggestTool(server: McpServer) {
  return server.tool(
    "suggest_deploy_options",
    "Analyze a project directory and suggest deployment options including framework detection, build needs, app name, and size estimate",
    { dir: z.string().optional().describe("Project directory to analyze (defaults to cwd)") },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const cwd = process.cwd();
      const projectDir = args.dir ? resolve(cwd, args.dir) : cwd;
      const lines: string[] = [];

      // Framework detection
      const framework = await detectFramework(projectDir);
      lines.push(`Framework: ${framework}`);

      // Build command
      const buildCmd = await detectBuildCommand(projectDir);
      lines.push(`Build command: ${buildCmd ?? "none detected"}`);

      // Build directory
      const buildDir = await detectBuildDir(projectDir);
      lines.push(`Build output: ${buildDir ? buildDir.replace(cwd, ".") : "not found"}`);

      // Name suggestion
      const name = await suggestName(projectDir);
      lines.push(`Suggested name: ${name}`);

      // Size estimate
      const targetDir = buildDir ?? projectDir;
      const hasIndex = await access(join(targetDir, "index.html")).then(() => true).catch(() => false);

      if (buildDir) {
        const { totalBytes, fileCount } = await getDirectorySize(buildDir);
        lines.push(`Size: ${formatBytes(totalBytes)} (${fileCount} files)`);

        // Tier-based warnings
        const freeLimits = TIER_LIMITS.free;
        if (totalBytes > freeLimits.maxUploadBytes) {
          lines.push(`Warning: Exceeds free tier upload limit (${formatBytes(freeLimits.maxUploadBytes)}). You'll need a paid plan.`);
        } else if (totalBytes > freeLimits.maxUploadBytes * 0.8) {
          lines.push(`Note: Approaching free tier upload limit (${formatBytes(freeLimits.maxUploadBytes)}).`);
        }
      }

      // Readiness
      lines.push("");
      if (hasIndex) {
        lines.push(`Ready to deploy! Use the deploy tool to publish this as "${name}".`);
      } else if (buildCmd) {
        lines.push(`Not ready yet — run "${buildCmd}" first to generate the build output, then deploy.`);
      } else {
        lines.push("Not ready — no index.html found. Build the project or specify the correct directory.");
      }

      return text(lines.join("\n"));
    },
  );
}
