import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import fg from "fast-glob";
import { formatBytes, formatDeployError } from "@deloc/shared";
import { getToken, getApiUrl } from "../config.js";
import { chalk, errorMessage } from "../ui.js";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTS = new Set([".csv", ".json", ".tsv", ".xml", ".txt"]);

// MIME map mirrors apps/api/src/routes/apps-data.ts so the server doesn't
// need to re-detect the type. Keep them in sync.
const DATA_MIME: Record<string, string> = {
  ".csv": "text/csv",
  ".json": "application/json",
  ".tsv": "text/tab-separated-values",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

interface UploadDataOptions {
  filename?: string;
}

interface UploadDataResponse {
  success: boolean;
  data?: {
    files: Array<{
      filename: string;
      size: number;
      contentType: string;
      url: string;
      updatedAt: string;
    }>;
  };
  error?: string;
}

function hasGlobMagic(p: string): boolean {
  return /[*?[\]{}]/.test(p);
}

async function expandPaths(args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const arg of args) {
    if (hasGlobMagic(arg)) {
      const matches = await fg(arg, { onlyFiles: true, absolute: true });
      out.push(...matches);
    } else {
      out.push(resolve(arg));
    }
  }
  // Dedupe while preserving order
  return Array.from(new Set(out));
}

export async function uploadDataCommand(
  slug: string,
  filesArg: string[],
  options: UploadDataOptions,
): Promise<void> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }

  if (filesArg.length === 0) {
    console.log(errorMessage("No files specified. Usage: deloc upload-data <slug> <file...>"));
    process.exit(1);
  }

  const paths = await expandPaths(filesArg);
  if (paths.length === 0) {
    console.log(errorMessage("No files matched. Check your paths or glob patterns."));
    process.exit(1);
  }

  if (options.filename && paths.length > 1) {
    console.log(errorMessage("--filename can only be used with a single file."));
    process.exit(1);
  }

  // Read all files and validate before sending anything
  const buffers: Array<{ path: string; buf: Buffer; sendName: string }> = [];
  let totalBytes = 0;
  for (const p of paths) {
    let buf: Buffer;
    try {
      buf = await readFile(p);
    } catch {
      console.log(errorMessage(`Could not read file: ${p}`));
      process.exit(1);
    }
    if (buf.length > MAX_FILE_BYTES) {
      console.log(errorMessage(`${basename(p)} exceeds the 10MB per-file limit.`));
      process.exit(1);
    }
    const ext = extname(p).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      console.log(errorMessage(`${basename(p)}: extension '${ext}' not allowed (.csv, .json, .tsv, .xml, .txt only).`));
      process.exit(1);
    }
    totalBytes += buf.length;
    buffers.push({ path: p, buf, sendName: basename(p) });
  }

  if (totalBytes > MAX_BATCH_BYTES) {
    console.log(
      errorMessage(`Batch total ${formatBytes(totalBytes)} exceeds the 50MB request limit. Split into smaller batches.`),
    );
    process.exit(1);
  }

  const form = new FormData();
  for (const { buf, sendName, path: p } of buffers) {
    const ext = extname(p).toLowerCase();
    const mime = DATA_MIME[ext] ?? "application/octet-stream";
    // new Blob with a fresh Uint8Array view to avoid sharing the underlying buffer
    form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), sendName);
  }
  if (options.filename) {
    form.append("filename", options.filename);
  }

  let resp: Response;
  try {
    resp = await fetch(`${getApiUrl()}/api/apps/${encodeURIComponent(slug)}/data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch {
    console.log(errorMessage("Could not connect to Deloc API. Check your internet connection."));
    process.exit(1);
  }

  let body: UploadDataResponse;
  try {
    body = (await resp.json()) as UploadDataResponse;
  } catch {
    console.log(errorMessage(`Server returned ${resp.status} (${resp.statusText})`));
    process.exit(1);
  }

  if (!body.success || !body.data) {
    console.log(errorMessage(formatDeployError(resp.status, body.error ?? "Upload failed")));
    process.exit(1);
  }

  const files = body.data.files;
  if (files.length === 1) {
    const f = files[0]!;
    console.log(`${chalk.green("✓")} Updated ${chalk.bold(f.filename)} in ${chalk.cyan(slug)} (${formatBytes(f.size)})`);
    console.log(`  ${chalk.dim("URL")}  ${chalk.cyan(f.url)}`);
  } else {
    console.log(`${chalk.green("✓")} Updated ${chalk.bold(String(files.length))} files in ${chalk.cyan(slug)}:`);
    for (const f of files) {
      console.log(`  ${chalk.dim("•")} ${f.filename} ${chalk.dim(`(${formatBytes(f.size)})`)}`);
    }
    console.log(`  ${chalk.dim("URL")}  ${chalk.cyan(files[0]!.url.replace(/\/[^/]+$/, "/"))}`);
  }
}
