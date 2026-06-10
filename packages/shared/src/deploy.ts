import { access } from "node:fs/promises";
import { join } from "node:path";

const BUILD_DIRS = ["dist", "build", "out", ".next/static"];

export async function detectBuildDir(projectDir: string): Promise<string | null> {
  for (const dir of BUILD_DIRS) {
    const full = join(projectDir, dir);
    try {
      await access(full);
      const indexPath = join(full, "index.html");
      try {
        await access(indexPath);
        return full;
      } catch {
        // dir exists but no index.html — keep looking
      }
    } catch {
      // dir doesn't exist
    }
  }
  return null;
}

export async function detectBuildCommand(projectDir: string): Promise<string | null> {
  try {
    const pkgPath = join(projectDir, "package.json");
    const { readFile } = await import("node:fs/promises");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    const scripts = pkg.scripts ?? {};
    if (scripts.build) return "npm run build";
  } catch {
    // no package.json
  }
  return null;
}

export interface DeployResult {
  id: string;
  name: string;
  slug: string;
  url: string;
  status: string;
  visibility: string;
  fileCount: number;
  totalSizeBytes: number;
  expiresAt: string | null;
  createdAt: string;
  allowedDomains?: string[];
  /** Data files (CSV/JSON/TSV/XML/TXT) detected in the deployed bundle —
   *  hint that the user can refresh them via the data upload endpoint. */
  dataFilesDetected?: string[];
}

export interface UploadOptions {
  password?: string;
  visibility?: "public" | "password_protected" | "domain_restricted";
  // Required when visibility is "domain_restricted" for a solo paid user. For
  // team/enterprise orgs, an empty list falls back to the org's allowlist.
  allowedDomains?: string[];
  ogImage?: Buffer;
  ogTitle?: string;
  ogDescription?: string;
  /** Client identity sent as the X-Deloc-Client header, e.g. "cli/2.3.1".
   *  Used server-side for deploy-source analytics only — never authorization. */
  client?: string;
}

export interface DeployError {
  success: false;
  error: string;
  httpStatus: number;
}

export async function uploadToApi(
  apiUrl: string,
  token: string,
  zipBuffer: Buffer,
  appName: string,
  options?: UploadOptions,
): Promise<DeployResult | DeployError> {
  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }), `${appName}.zip`);
  formData.append("name", appName);
  if (options?.password) {
    formData.append("password", options.password);
  }
  if (options?.visibility) {
    formData.append("visibility", options.visibility);
  }
  if (options?.allowedDomains && options.allowedDomains.length > 0) {
    formData.append("allowed_domains", JSON.stringify(options.allowedDomains));
  }
  if (options?.ogImage) {
    formData.append("og_image", new Blob([new Uint8Array(options.ogImage)], { type: "image/png" }), "og-image.png");
  }
  if (options?.ogTitle) {
    formData.append("og_title", options.ogTitle);
  }
  if (options?.ogDescription) {
    formData.append("og_description", options.ogDescription);
  }

  const resp = await fetch(`${apiUrl}/api/apps/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.client ? { "X-Deloc-Client": options.client } : {}),
    },
    body: formData,
  });

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { success: false, error: `Server returned ${resp.status} (${resp.statusText})`, httpStatus: resp.status };
  }

  const body = await resp.json() as { success: boolean; data?: DeployResult; error?: string };

  if (!body.success) {
    return { success: false, error: body.error ?? "Upload failed", httpStatus: resp.status };
  }

  return body.data!;
}

export function isDeployResult(result: DeployResult | DeployError): result is DeployResult {
  return "slug" in result;
}

export interface PasteDeployOptions {
  password?: string;
  visibility?: "public" | "password_protected" | "domain_restricted";
  allowedDomains?: string[];
  ogTitle?: string;
  ogDescription?: string;
  slug?: string;
  type?: "html" | "react" | "auto";
  /** Client identity sent as the X-Deloc-Client header, e.g. "mcp/1.8.0".
   *  Used server-side for deploy-source analytics only — never authorization. */
  client?: string;
}

export async function pasteToApi(
  apiUrl: string,
  token: string,
  code: string,
  appName: string,
  options?: PasteDeployOptions,
): Promise<DeployResult | DeployError> {
  const payload: Record<string, unknown> = { code, name: appName };
  if (options?.type) payload.type = options.type;
  if (options?.password) payload.password = options.password;
  if (options?.visibility) payload.visibility = options.visibility;
  if (options?.allowedDomains && options.allowedDomains.length > 0) payload.allowed_domains = options.allowedDomains;
  if (options?.ogTitle) payload.og_title = options.ogTitle;
  if (options?.ogDescription) payload.og_description = options.ogDescription;
  if (options?.slug) payload.slug = options.slug;

  const resp = await fetch(`${apiUrl}/api/apps/paste-deploy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.client ? { "X-Deloc-Client": options.client } : {}),
    },
    body: JSON.stringify(payload),
  });

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { success: false, error: `Server returned ${resp.status} (${resp.statusText})`, httpStatus: resp.status };
  }

  const body = await resp.json() as { success: boolean; data?: DeployResult; error?: string };

  if (!body.success) {
    return { success: false, error: body.error ?? "Deploy failed", httpStatus: resp.status };
  }

  return body.data!;
}

export async function createZipBuffer(dir: string): Promise<Buffer> {
  const archiver = (await import("archiver")).default;
  const { Writable } = await import("node:stream");

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const collector = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    collector.on("finish", () => resolve(Buffer.concat(chunks)));
    archive.pipe(collector);
    archive.directory(dir, false);
    archive.finalize();
  });
}

export function formatDeployError(httpStatus: number, error: string): string {
  if (httpStatus === 429) {
    return "Daily deploy limit reached. Resets at midnight UTC. Upgrade at deloc.dev/pricing for more.";
  }
  if (httpStatus === 413) {
    return "Storage limit exceeded. Delete old apps or upgrade at deloc.dev/pricing for more space.";
  }
  if (httpStatus === 403) {
    return "Max active apps reached. Disable old apps or upgrade at deloc.dev/pricing to deploy more.";
  }
  return error;
}

/** Well-known sub-paths that esm.sh modules commonly import internally. */
const WELL_KNOWN_SUBPATHS: Record<string, string[]> = {
  react: ["react/jsx-runtime", "react/jsx-dev-runtime"],
  "react-dom": ["react-dom/client", "react-dom/server"],
};

/**
 * Check that every bare specifier required by `?external=` params in esm.sh
 * URLs has a matching entry in the page's import map.  Returns human-readable
 * warnings for each missing entry, or an empty array if everything looks fine.
 */
export function checkImportMapCompleteness(html: string): string[] {
  // 1. Extract import map entries
  const importMapMatch = html.match(/<script\s+type\s*=\s*["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!importMapMatch) return []; // No import map — nothing to validate

  let imports: Record<string, string>;
  try {
    const parsed = JSON.parse(importMapMatch[1]!) as { imports?: Record<string, string> };
    imports = parsed.imports ?? {};
  } catch {
    return ["Import map contains invalid JSON — the browser will ignore it."];
  }

  const mappedSpecifiers = new Set(Object.keys(imports));

  // 2. Find all esm.sh URLs with ?external= in the entire HTML
  const esmShExternalRe = /esm\.sh\/[^"'\s]*[?&]external=([^"'\s&#]*)/gi;
  const requiredSpecifiers = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = esmShExternalRe.exec(html)) !== null) {
    const externals = match[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    for (const ext of externals) {
      requiredSpecifiers.add(ext);
      // Also require well-known sub-paths
      const subpaths = WELL_KNOWN_SUBPATHS[ext];
      if (subpaths) {
        for (const sp of subpaths) {
          requiredSpecifiers.add(sp);
        }
      }
    }
  }

  // 3. Also check for bare specifiers used in <script type="module"> blocks
  //    that aren't relative paths or full URLs
  const moduleScriptRe = /<script\s+type\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
  const importStatementRe = /\bimport\s+.*?\s+from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = moduleScriptRe.exec(html)) !== null) {
    const scriptContent = scriptMatch[1]!;
    let importMatch: RegExpExecArray | null;
    while ((importMatch = importStatementRe.exec(scriptContent)) !== null) {
      const specifier = importMatch[1] ?? importMatch[2] ?? importMatch[3];
      // Skip relative paths, full URLs, and data: URIs
      if (specifier && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.includes("://")) {
        requiredSpecifiers.add(specifier);
      }
    }
    importStatementRe.lastIndex = 0;
  }

  if (requiredSpecifiers.size === 0) return [];

  // 4. Check which required specifiers are missing from the import map
  const missing: string[] = [];
  for (const specifier of requiredSpecifiers) {
    if (!mappedSpecifiers.has(specifier)) {
      missing.push(specifier);
    }
  }

  if (missing.length === 0) return [];

  const esmSuggestions = missing.map((s) => {
    const base = s.split("/")[0] ?? s;
    const version = findVersionInImportMap(imports, base);
    const versionSuffix = version ? `@${version}` : "";
    if (s.includes("/")) {
      return `"${s}": "https://esm.sh/${base}${versionSuffix}/${s.slice(base.length + 1)}"`;
    }
    return `"${s}": "https://esm.sh/${s}${versionSuffix}"`;
  });

  return [
    `Import map is missing entries for: ${missing.join(", ")}`,
    `Add these to your import map: { ${esmSuggestions.join(", ")} }`,
    "Without these entries, the browser cannot resolve bare module specifiers and the app will fail to load.",
  ];
}

/** Try to find a version number for a package already in the import map. */
function findVersionInImportMap(imports: Record<string, string>, pkg: string): string | null {
  for (const [key, url] of Object.entries(imports)) {
    if (key === pkg || key.startsWith(`${pkg}/`)) {
      const versionMatch = url.match(new RegExp(`esm\\.sh/${pkg.replace("/", "\\/")}@([\\d.]+)`));
      if (versionMatch) return versionMatch[1] ?? null;
    }
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes)) return "unlimited";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
