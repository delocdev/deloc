import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  uploadToApi,
  pasteToApi,
  isDeployResult,
  formatBytes,
  formatDeployError,
  detectBuildDir,
  createZipBuffer,
  generateSlug,
  checkImportMapCompleteness,
} from "@deloc/shared";
import type { DeployResult, PasteDeployOptions } from "@deloc/shared";
import { access, readFile, readdir, stat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, basename, dirname, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { API_URL, requireToken, getToken, apiFetch } from "../api.js";
import { generatePassword, AUTO_GENERATE_KEYWORDS, daysUntil } from "../helpers.js";

declare const __PKG_VERSION__: string;

/** Sent as X-Deloc-Client so the API can attribute deploys to the MCP server. */
const MCP_CLIENT = `mcp/${__PKG_VERSION__}`;

const SENSITIVE_KEYWORDS = ["internal", "confidential", "draft", "private", "secret", "do-not-share"];

/** CDN patterns that are known to produce broken UMD globals in single-file apps. */
const PROBLEMATIC_CDN_PATTERNS: Array<{ pattern: RegExp; library: string; suggestion: string }> = [
  { pattern: /unpkg\.com\/recharts/i, library: "Recharts", suggestion: "https://esm.sh/recharts" },
  { pattern: /cdnjs\.cloudflare\.com\/ajax\/libs\/recharts/i, library: "Recharts", suggestion: "https://esm.sh/recharts" },
  { pattern: /cdn\.jsdelivr\.net\/npm\/recharts/i, library: "Recharts", suggestion: "https://esm.sh/recharts" },
  { pattern: /unpkg\.com\/@radix-ui/i, library: "Radix UI", suggestion: "https://esm.sh/@radix-ui/react-*" },
  { pattern: /unpkg\.com\/lucide-react/i, library: "Lucide React", suggestion: "https://esm.sh/lucide-react" },
  { pattern: /unpkg\.com\/@tanstack/i, library: "TanStack", suggestion: "https://esm.sh/@tanstack/*" },
  { pattern: /unpkg\.com\/framer-motion/i, library: "Framer Motion", suggestion: "https://esm.sh/framer-motion" },
];

async function checkCdnCompatibility(dir: string): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const html = await readFile(join(dir, "index.html"), "utf-8");
    for (const { pattern, library, suggestion } of PROBLEMATIC_CDN_PATTERNS) {
      if (pattern.test(html)) {
        warnings.push(`${library} loaded via UMD script tag — this often breaks. Use \`${suggestion}\` with \`<script type="module">\` instead.`);
      }
    }
    // General warning: UMD script tags for React ecosystem libs that aren't React/ReactDOM themselves
    const umdScripts = html.match(/<script[^>]+src=["'][^"']*unpkg\.com\/[^"']+["'][^>]*>/gi) ?? [];
    const nonReactUmd = umdScripts.filter(
      (s) => !/unpkg\.com\/(react|react-dom|react-is)\b/i.test(s),
    );
    if (nonReactUmd.length > 0 && warnings.length === 0) {
      warnings.push("Some libraries are loaded via UMD script tags from unpkg. Many modern React libraries don't expose proper UMD globals. Consider using esm.sh with `<script type=\"module\">` for more reliable imports.");
    }
  } catch { /* no index.html or read error */ }
  return warnings;
}

async function readPackageName(dir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
    if (typeof pkg.name === "string" && pkg.name.length > 0 && !pkg.name.startsWith("@")) {
      return pkg.name;
    }
  } catch { /* no package.json */ }
  return null;
}

async function checkSensitiveContent(dir: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const files = await readdir(dir, { recursive: true });
    for (const file of files) {
      const lower = String(file).toLowerCase();
      for (const keyword of SENSITIVE_KEYWORDS) {
        if (lower.includes(keyword)) {
          found.push(String(file));
          break;
        }
      }
    }
  } catch { /* ignore read errors */ }
  return found;
}

async function checkExistingApp(slug: string): Promise<{ exists: boolean; status?: string }> {
  try {
    const resp = await apiFetch(`/api/apps/${slug}`);
    if (!resp.ok) return { exists: false };
    const body = await resp.json() as { success: boolean; data?: { status: string } };
    if (body.success && body.data) return { exists: true, status: body.data.status };
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const PASTE_DEPLOY_EXTENSIONS = new Set([".jsx", ".tsx", ".html", ".htm"]);
const PASTE_DEPLOY_MAX_SIZE = 5 * 1024 * 1024;
const IGNORED_FILES = new Set(["package.json", "package-lock.json", "tsconfig.json", "node_modules", ".git", ".DS_Store"]);

async function detectSingleFileForPaste(dir: string): Promise<{ filePath: string; fileName: string; extension: string } | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const candidates = entries.filter((f) => {
    if (f.startsWith(".") || IGNORED_FILES.has(f)) return false;
    return PASTE_DEPLOY_EXTENSIONS.has(extname(f).toLowerCase());
  });
  if (candidates.length !== 1) return null;
  const fileName = candidates[0]!;
  const filePath = join(dir, fileName);
  try {
    const s = await stat(filePath);
    if (!s.isFile() || s.size > PASTE_DEPLOY_MAX_SIZE) return null;
  } catch {
    return null;
  }
  return { filePath, fileName, extension: extname(fileName).toLowerCase() };
}

// --- Multi-file JSX bundling ---

const JSX_EXTENSIONS = new Set([".jsx", ".tsx"]);

const CDN_SCRIPTS: Record<string, string[]> = {
  recharts: [
    "https://unpkg.com/prop-types@15/prop-types.min.js",
    "https://unpkg.com/recharts@2/umd/Recharts.js",
  ],
  "lucide-react": [
    "https://cdn.jsdelivr.net/npm/lucide-react@0.460.0/dist/umd/lucide-react.min.js",
  ],
  lodash: ["https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js"],
  d3: ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"],
  mathjs: ["https://cdn.jsdelivr.net/npm/mathjs@13/lib/browser/math.min.js"],
};

const GLOBAL_MAP: Record<string, string> = {
  recharts: "Recharts",
  "lucide-react": "LucideReact",
  lodash: "_",
  d3: "d3",
  mathjs: "math",
};

interface ParsedImport {
  source: string;
  defaultImport: string | null;
  namedImports: string[];
  namedImportAliases: string[];
}

function parseImports(code: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const normalized = code.replace(/import\s*\{([^}]*)\}/gs, (match) =>
    match.replace(/\n/g, " "),
  );
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import ")) continue;
    const fromMatch = trimmed.match(/from\s+['"]([^'"]+)['"]/);
    if (!fromMatch) continue;
    const source = fromMatch[1]!;
    let defaultImport: string | null = null;
    const namedImports: string[] = [];
    const namedImportAliases: string[] = [];
    const betweenMatch = trimmed.match(/^import\s+([\s\S]+?)\s+from\s+/);
    if (betweenMatch) {
      const specifier = betweenMatch[1]!.trim();
      const braceMatch = specifier.match(/\{([^}]+)\}/);
      if (braceMatch) {
        for (const part of braceMatch[1]!.split(",")) {
          const clean = part.trim();
          if (!clean) continue;
          const aliasMatch = clean.match(/^(\w+)\s+as\s+(\w+)$/);
          if (aliasMatch) {
            namedImports.push(aliasMatch[1]!);
            namedImportAliases.push(`${aliasMatch[1]!}: ${aliasMatch[2]!}`);
          } else {
            namedImports.push(clean);
            namedImportAliases.push(clean);
          }
        }
      }
      const defaultPart = specifier.replace(/\{[^}]*\}/, "").replace(/,\s*$/, "").trim();
      if (defaultPart && defaultPart !== "*") {
        const nsMatch = specifier.match(/\*\s+as\s+(\w+)/);
        if (nsMatch) {
          defaultImport = nsMatch[1]!;
        } else if (defaultPart) {
          defaultImport = defaultPart;
        }
      }
    }
    imports.push({ source, defaultImport, namedImports, namedImportAliases });
  }
  return imports;
}

function buildPreamble(imports: ParsedImport[]): string {
  const lines: string[] = [];
  for (const imp of imports) {
    if (imp.source === "react" || imp.source === "react-dom") {
      if (imp.namedImports.length > 0) {
        lines.push(`const { ${imp.namedImportAliases.join(", ")} } = React;`);
      }
      continue;
    }
    const globalName = GLOBAL_MAP[imp.source];
    if (!globalName) continue;
    if (imp.namedImports.length > 0) {
      lines.push(`const { ${imp.namedImportAliases.join(", ")} } = typeof ${globalName} !== 'undefined' ? ${globalName} : {};`);
    }
    if (imp.defaultImport && imp.defaultImport !== "React") {
      lines.push(`const ${imp.defaultImport} = typeof ${globalName} !== 'undefined' ? ${globalName} : {};`);
    }
  }
  return lines.join("\n");
}

function buildScriptTags(imports: ParsedImport[]): string {
  const tags: string[] = [];
  tags.push('  <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>');
  tags.push('  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>');
  const needsLucide = imports.some((i) => i.source === "lucide-react");
  if (needsLucide) {
    tags.push('  <script>window.react = window.React; window["react/jsx-runtime"] = {jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment};</script>');
  }
  const added = new Set<string>();
  for (const imp of imports) {
    const cdnUrls = CDN_SCRIPTS[imp.source];
    if (cdnUrls) {
      for (const url of cdnUrls) {
        if (!added.has(url)) {
          tags.push(`  <script src="${url}" crossorigin></script>`);
          added.add(url);
        }
      }
    }
  }
  tags.push('  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>');
  tags.push('  <script src="https://cdn.tailwindcss.com"></script>');
  return tags.join("\n");
}

async function bundleMultiFileJsx(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const jsxFiles = entries.filter((f) => {
    if (f.startsWith(".") || IGNORED_FILES.has(f)) return false;
    return JSX_EXTENSIONS.has(extname(f).toLowerCase());
  });
  if (jsxFiles.length < 2) return null;

  // Read all files
  const fileContents = new Map<string, string>();
  let totalSize = 0;
  for (const f of jsxFiles) {
    const filePath = join(dir, f);
    try {
      const s = await stat(filePath);
      if (!s.isFile()) continue;
      totalSize += s.size;
      if (totalSize > PASTE_DEPLOY_MAX_SIZE) return null;
    } catch { continue; }
    const content = await readFile(filePath, "utf-8");
    const nameWithoutExt = f.replace(/\.(jsx|tsx)$/i, "");
    fileContents.set(nameWithoutExt, content);
  }
  if (fileContents.size < 2) return null;

  // Build dependency graph
  const localDeps = new Map<string, string[]>();
  for (const [name, content] of fileContents) {
    const deps: string[] = [];
    const importRegex = /import\s+[\s\S]*?\s+from\s+['"]\.\/([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const dep = match[1]!.replace(/\.(jsx|tsx)$/i, "");
      if (fileContents.has(dep)) deps.push(dep);
    }
    localDeps.set(name, deps);
  }

  // Topological sort (dependencies first)
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(name: string) {
    if (visited.has(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const dep of localDeps.get(name) ?? []) visit(dep);
    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }
  for (const name of fileContents.keys()) visit(name);

  // Collect external imports and stripped code blocks
  const externalImports: ParsedImport[] = [];
  const seenExternal = new Set<string>();
  const codeBlocks: string[] = [];

  for (const name of sorted) {
    const content = fileContents.get(name)!;
    const fileImports = parseImports(content);

    // Collect external imports (deduplicated)
    for (const imp of fileImports) {
      if (imp.source.startsWith("./") || imp.source.startsWith("../")) continue;
      const key = `${imp.source}:${imp.defaultImport}:${imp.namedImports.join(",")}`;
      if (!seenExternal.has(key)) {
        seenExternal.add(key);
        externalImports.push(imp);
      }
    }

    // Strip imports and exports
    const lines = content.split("\n");
    const codeLines: string[] = [];
    let inMultiLineImport = false;
    for (const line of lines) {
      if (inMultiLineImport) {
        if (/\}\s*from\s+['"]/.test(line) || (/\}/.test(line) && /from\s+['"]/.test(line))) {
          inMultiLineImport = false;
        }
        continue;
      }
      const trimmed = line.trim();
      if (trimmed.startsWith("import ") || trimmed.startsWith("import{")) {
        if (/from\s+['"]/.test(line)) continue;
        if (/^import\s+['"]/.test(trimmed)) continue;
        if (/\{/.test(line) && !/\}/.test(line)) { inMultiLineImport = true; continue; }
        continue;
      }
      codeLines.push(line);
    }
    let code = codeLines.join("\n");
    code = code.replace(/export\s+default\s+/g, "").replace(/export\s+/g, "");
    codeBlocks.push(code.trim());
  }

  // Find the entry component (last in sorted order = the root that imports others)
  const entryName = sorted[sorted.length - 1]!;
  const entryContent = fileContents.get(entryName)!;
  const componentNameMatch =
    entryContent.match(/export\s+default\s+function\s+(\w+)/) ??
    entryContent.match(/export\s+function\s+(\w+)/) ??
    entryContent.match(/^function\s+([A-Z]\w*)\s*\(/m);
  const componentName = componentNameMatch?.[1] ?? "App";

  // Build the HTML
  const preamble = buildPreamble(externalImports);
  const scriptTags = buildScriptTags(externalImports);
  const mergedCode = codeBlocks.join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>App</title>
${scriptTags}
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script id="app-source" type="text/plain">
${preamble}

${mergedCode}

    ReactDOM.createRoot(document.getElementById('root')).render(
      React.createElement(${componentName})
    );
  </script>
  <script>
    (function() {
      var code = document.getElementById('app-source').textContent;
      var result = Babel.transform(code, {
        presets: [
          ['typescript', { isTSX: true, allExtensions: true }],
          'react'
        ]
      });
      var script = document.createElement('script');
      script.textContent = result.code;
      document.body.appendChild(script);
    })();
  </script>
</body>
</html>`;
}

function buildResponseLines(
  result: DeployResult,
  isUpdate: boolean,
  appName: string,
  nameSuggested: boolean,
  password: string | undefined,
  passwordAutoGenerated: boolean,
  hasSensitiveContent: boolean,
  sensitiveFiles: string[],
): string[] {
  const lines: string[] = [];
  if (isUpdate) {
    lines.push(`Updated! Your app at ${result.url} has been redeployed with the latest changes.`);
  } else {
    lines.push(`Deployed! Your app is live at ${result.url}`);
  }

  if (password) {
    const autoNote = passwordAutoGenerated
      ? "\nCopy this password now and share it with your viewers. It won't be shown again."
      : "\nShare this password with your viewers.";
    lines.push(`Password protected. Password: ${password}${autoNote}`);
  } else if (result.visibility === "domain_restricted" && result.allowedDomains?.length) {
    const domainList = result.allowedDomains.map((d: string) => `@${d}`).join(", ");
    lines.push(`Restricted to ${domainList}.`);
  } else {
    lines.push("Anyone with the link can view it.");
  }

  lines.push("");
  lines.push(`App: ${result.slug}`);
  if (nameSuggested) lines.push(`(Named "${appName}" — redeploy with a custom name using the name parameter)`);
  lines.push(`Files: ${result.fileCount} (${formatBytes(result.totalSizeBytes)})`);
  lines.push(`Status: ${result.status}`);

  if (result.expiresAt) {
    lines.push(`Free tier — expires in ${daysUntil(result.expiresAt)} days.`);
  }

  if (hasSensitiveContent) {
    lines.push("");
    lines.push(`Note: This app contains files with sensitive-looking names (${sensitiveFiles.slice(0, 3).join(", ")}${sensitiveFiles.length > 3 ? ` and ${sensitiveFiles.length - 3} more` : ""}). Consider setting a password to restrict access.`);
  }

  if (result.dataFilesDetected && result.dataFilesDetected.length > 0) {
    const sample = result.dataFilesDetected.slice(0, 3).join(", ");
    const more = result.dataFilesDetected.length > 3 ? ` and ${result.dataFilesDetected.length - 3} more` : "";
    lines.push("");
    lines.push(
      `This app contains ${result.dataFilesDetected.length} data file(s) (${sample}${more}). You can refresh them WITHOUT redeploying using the upload_data tool — useful for auto-refreshing dashboards on a cron schedule.`,
    );
  }

  lines.push("");
  lines.push("Next steps:");
  lines.push(`- Open ${result.url} in the browser`);
  if (!password) lines.push("- Set a password to restrict access");
  lines.push("- List all deployed apps");
  if (result.expiresAt && daysUntil(result.expiresAt) <= 7) {
    lines.push("- Renew this app to extend the expiry");
  }

  return lines;
}

export function registerDeployTool(server: McpServer) {
  return server.tool(
    "deploy",
    `Deploy or update a project on Deloc. If an app with the same name already exists, it will be updated in place — do NOT delete and recreate apps. Redeploying preserves the same URL and settings. Set password to a string to use that password, or to true/"yes"/"generate" to auto-generate one.

Single .jsx/.tsx files can be deployed directly — React, Babel transpilation, and Tailwind CSS are handled automatically on the server. No need to build an HTML wrapper. Just point to the directory containing the file.

For directories with a pre-built index.html: deploys the directory as-is. Use ES module imports with esm.sh for CDN libraries (not UMD script tags).`,
    {
      name: z.string().optional().describe("App name (defaults to directory name or package.json name). If you've deployed this project before, use the same name to update it instead of creating a new app."),
      dir: z.string().optional().describe("Path to build output directory containing index.html"),
      password: z.union([z.string(), z.boolean()]).optional().describe("Password protect the app. Use a string for a specific password, or true to auto-generate one."),
      public: z.boolean().optional().describe("Make app public (removes password protection)"),
      domain_restrict: z.array(z.string()).optional().describe("Restrict access to viewers whose email ends with one of these domains (e.g. ['company.com']). Requires Pro Unlimited, Team, or Enterprise tier. Mutually exclusive with password/public."),
      og_image: z.string().optional().describe("Absolute path to a PNG image to use as the OG preview (shown in link previews on X, Slack, etc.). Max 2MB, 1200x630 recommended. Set this BEFORE deploying so the image is ready when the URL is shared."),
      og_title: z.string().optional().describe("Custom OG title for link previews (defaults to app name)"),
      og_description: z.string().optional().describe("Custom OG description for link previews (defaults to empty)"),
    },
    async (args) => {
      const token = requireToken();
      if (!token) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const cwd = process.cwd();
      const dir = args.dir ? resolve(cwd, args.dir) : (await detectBuildDir(cwd)) ?? cwd;

      // Resolve app name: explicit arg > package.json > directory name
      let appName = args.name;
      let nameSuggested = false;
      if (!appName) {
        const BUILD_OUTPUT_NAMES = ["dist", "build", "out", ".next", "public"];
        const dirName = basename(dir);
        const projectDir = BUILD_OUTPUT_NAMES.includes(dirName) ? dirname(dir) : dir;
        appName = await readPackageName(projectDir) ?? basename(projectDir);
        nameSuggested = true;
      }

      // Resolve password
      let password: string | undefined;
      let passwordAutoGenerated = false;
      if (typeof args.password === "string" && args.password.length > 0) {
        if (AUTO_GENERATE_KEYWORDS.has(args.password.toLowerCase())) {
          password = generatePassword();
          passwordAutoGenerated = true;
        } else {
          password = args.password;
        }
      } else if (args.password === true) {
        password = generatePassword();
        passwordAutoGenerated = true;
      }

      // Read OG image if provided
      let ogImage: Buffer | undefined;
      if (args.og_image) {
        const ogPath = resolve(args.og_image);
        try {
          ogImage = await readFile(ogPath);
          const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
          const isPng = PNG_MAGIC.every((byte, i) => ogImage![i] === byte);
          if (!isPng) return text(`Error: OG image must be a PNG file: ${ogPath}`);
          if (ogImage.length > 2 * 1024 * 1024) return text(`Error: OG image too large (${Math.round(ogImage.length / 1024)}KB). Max is 2MB.`);
        } catch {
          return text(`Error: Could not read OG image: ${ogPath}`);
        }
      }

      // Check if index.html exists — if not, try paste-deploy for single-file JSX/HTML
      let hasIndexHtml = false;
      try {
        await access(join(dir, "index.html"));
        hasIndexHtml = true;
      } catch { /* no index.html */ }

      if (!hasIndexHtml) {
        const singleFile = await detectSingleFileForPaste(dir);
        if (singleFile) {
          // Paste-deploy path: single JSX/TSX/HTML file
          const code = await readFile(singleFile.filePath, "utf-8");
          const slug = generateSlug(appName) || "app";
          const existing = await checkExistingApp(slug);
          const isUpdate = existing.exists && (existing.status === "active" || existing.status === "disabled");

          const pasteOptions: PasteDeployOptions = { client: MCP_CLIENT };
          if (password) pasteOptions.password = password;
          if (args.public) pasteOptions.visibility = "public";
          if (args.domain_restrict && args.domain_restrict.length > 0) {
            pasteOptions.visibility = "domain_restricted";
            pasteOptions.allowedDomains = args.domain_restrict;
          }
          if (args.og_title) pasteOptions.ogTitle = args.og_title;
          if (args.og_description) pasteOptions.ogDescription = args.og_description;
          if (isUpdate) pasteOptions.slug = slug;
          pasteOptions.type = singleFile.extension === ".html" || singleFile.extension === ".htm" ? "auto" : "react";

          const result = await pasteToApi(API_URL, getToken(), code, appName, pasteOptions);

          if (!isDeployResult(result)) {
            return text(`Deploy failed: ${formatDeployError(result.httpStatus, result.error)}`);
          }

          if (ogImage) {
            const formData = new FormData();
            formData.append("file", new Blob([new Uint8Array(ogImage)], { type: "image/png" }), "og-screenshot.png");
            await apiFetch(`/api/apps/${result.slug}/og-image`, { method: "POST", body: formData });
          }

          const lines = buildResponseLines(result, isUpdate, appName, nameSuggested, password, passwordAutoGenerated, false, []);
          return text(lines.join("\n"));
        }

        // Multi-file JSX/TSX: bundle into a single index.html and deploy via zip upload
        const bundledHtml = await bundleMultiFileJsx(dir);
        if (!bundledHtml) {
          return text(`Error: No index.html found in ${dir}. Build the project first, or specify the build output directory.`);
        }

        // Write bundled HTML to a temp directory so the standard zip upload path can pick it up
        const tmpDir = await mkdtemp(join(tmpdir(), "deloc-bundle-"));
        try {
          await writeFile(join(tmpDir, "index.html"), bundledHtml, "utf-8");

          const slug = generateSlug(appName) || "app";
          const existing = await checkExistingApp(slug);
          const isUpdate = existing.exists && (existing.status === "active" || existing.status === "disabled");

          const zipBuffer = await createZipBuffer(tmpDir);
          const uploadOptions: { password?: string; visibility?: "public" | "domain_restricted"; allowedDomains?: string[]; ogImage?: Buffer; ogTitle?: string; ogDescription?: string } = {};
          if (password) uploadOptions.password = password;
          if (args.public) uploadOptions.visibility = "public";
          if (args.domain_restrict && args.domain_restrict.length > 0) {
            uploadOptions.visibility = "domain_restricted";
            uploadOptions.allowedDomains = args.domain_restrict;
          }
          if (ogImage) uploadOptions.ogImage = ogImage;
          if (args.og_title) uploadOptions.ogTitle = args.og_title;
          if (args.og_description) uploadOptions.ogDescription = args.og_description;
          const result = await uploadToApi(API_URL, getToken(), zipBuffer, appName, { ...uploadOptions, client: MCP_CLIENT });

          if (!isDeployResult(result)) {
            return text(`Deploy failed: ${formatDeployError(result.httpStatus, result.error)}`);
          }

          const lines = buildResponseLines(result, isUpdate, appName, nameSuggested, password, passwordAutoGenerated, false, []);
          return text(lines.join("\n"));
        } finally {
          await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }

      // --- Standard upload path: directory with index.html ---

      // Check for sensitive content
      const sensitiveFiles = await checkSensitiveContent(dir);
      const hasSensitiveContent = sensitiveFiles.length > 0 && !args.password && !args.public;

      // Check for problematic CDN patterns before deploying
      const cdnWarnings = await checkCdnCompatibility(dir);
      if (cdnWarnings.length > 0) {
        const warningLines = [
          "Warning: Potential CDN compatibility issues detected in index.html:",
          ...cdnWarnings.map((w) => `  - ${w}`),
          "",
          "The app will still deploy, but it may not work correctly in the browser.",
          "Fix these issues and redeploy for a reliable result.",
        ];
        return text(warningLines.join("\n"));
      }

      // Check import map completeness (catches missing bare specifiers like "react-dom")
      const html = await readFile(join(dir, "index.html"), "utf-8");
      const importMapWarnings = checkImportMapCompleteness(html);
      if (importMapWarnings.length > 0) {
        const warningLines = [
          "Warning: Import map issues detected in index.html:",
          ...importMapWarnings.map((w) => `  - ${w}`),
          "",
          "Fix the import map and redeploy. The app will fail to load in the browser without these entries.",
        ];
        return text(warningLines.join("\n"));
      }

      // Check if this app already exists (enables update-in-place instead of creating duplicates)
      const slug = generateSlug(appName) || "app";
      const existing = await checkExistingApp(slug);
      const isUpdate = existing.exists && (existing.status === "active" || existing.status === "disabled");

      const zipBuffer = await createZipBuffer(dir);
      const uploadOptions: { password?: string; visibility?: "public" | "domain_restricted"; allowedDomains?: string[]; ogImage?: Buffer; ogTitle?: string; ogDescription?: string } = {};
      if (password) uploadOptions.password = password;
      if (args.public) uploadOptions.visibility = "public";
      if (args.domain_restrict && args.domain_restrict.length > 0) {
        uploadOptions.visibility = "domain_restricted";
        uploadOptions.allowedDomains = args.domain_restrict;
      }
      if (ogImage) uploadOptions.ogImage = ogImage;
      if (args.og_title) uploadOptions.ogTitle = args.og_title;
      if (args.og_description) uploadOptions.ogDescription = args.og_description;
      const result = await uploadToApi(API_URL, getToken(), zipBuffer, appName, { ...uploadOptions, client: MCP_CLIENT });

      if (!isDeployResult(result)) {
        return text(`Deploy failed: ${formatDeployError(result.httpStatus, result.error)}`);
      }

      const lines = buildResponseLines(result, isUpdate, appName, nameSuggested, password, passwordAutoGenerated, hasSensitiveContent, sensitiveFiles);
      return text(lines.join("\n"));
    },
  );
}
