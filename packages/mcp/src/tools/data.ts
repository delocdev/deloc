import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { formatBytes } from "@deloc/shared";
import { requireToken, apiFetch } from "../api.js";

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTS = new Set([".csv", ".json", ".tsv", ".xml", ".txt"]);
const RESERVED_NAMES = new Set([
  "index.html", "index.htm", "manifest.json", "robots.txt", "sitemap.xml", "og-screenshot.png",
]);

const DATA_MIME: Record<string, string> = {
  ".csv": "text/csv",
  ".json": "application/json",
  ".tsv": "text/tab-separated-values",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

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

interface ListDataResponse {
  success: boolean;
  data?: {
    files: Array<{
      filename: string;
      sizeBytes: number;
      contentType: string;
      updatedAt: string;
      url: string;
    }>;
  };
  error?: string;
}

function validateFilename(name: string): string | null {
  const base = basename(name);
  if (!base) return "filename is empty";
  if (base.length > 255) return "filename too long (255 chars max)";
  if (base.startsWith(".")) return "filename must not start with a dot";
  if (base.includes("..")) return "filename must not contain '..'";
  if (!/^[A-Za-z0-9._-]+$/.test(base)) {
    return "filename may only contain letters, digits, dot, underscore, or dash";
  }
  if (RESERVED_NAMES.has(base.toLowerCase())) {
    return `'${base}' is reserved and cannot be used as a data file name`;
  }
  const ext = extname(base).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return `extension '${ext}' not allowed for data files (.csv, .json, .tsv, .xml, .txt only)`;
  }
  return null;
}

export function registerDataTools(server: McpServer) {
  const uploadData = server.tool(
    "upload_data",
    "Upload or replace a data file (CSV, JSON, TSV, XML, TXT, max 10MB) inside an already-deployed Deloc app WITHOUT redeploying. Use this to refresh dashboard data from BigQuery, databases, or APIs on a schedule. The file is served at the same URL as the rest of the app, so client code that does fetch('./data.csv') will see the new content immediately.",
    {
      slug: z.string().describe("The app slug (e.g. 'q3-revenue-dashboard')"),
      file_path: z.string().describe("Absolute path to the local data file to upload (max 10MB)"),
      filename: z.string().optional().describe("Override filename to save as in the app. Default: source file's basename. Must use only letters, digits, dot, underscore, or dash."),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const filePath = resolve(args.file_path);
      let buffer: Buffer;
      try {
        buffer = await readFile(filePath);
      } catch {
        return text(`Error: Could not read file: ${filePath}`);
      }
      if (buffer.length > MAX_FILE_BYTES) {
        return text(`Error: File too large (${formatBytes(buffer.length)}). Max is 10MB per file.`);
      }

      const targetName = args.filename ?? basename(filePath);
      const validationError = validateFilename(targetName);
      if (validationError) {
        return text(`Error: ${validationError}`);
      }

      const ext = extname(targetName).toLowerCase();
      const mime = DATA_MIME[ext] ?? "application/octet-stream";

      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(buffer)], { type: mime }),
        basename(filePath),
      );
      if (args.filename) {
        form.append("filename", args.filename);
      }

      let resp: Response;
      try {
        resp = await apiFetch(`/api/apps/${encodeURIComponent(args.slug)}/data`, {
          method: "POST",
          body: form,
        });
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }

      let body: UploadDataResponse;
      try {
        body = (await resp.json()) as UploadDataResponse;
      } catch {
        return text(`Error: Server returned ${resp.status} (${resp.statusText})`);
      }
      if (!body.success || !body.data) {
        return text(`Error: ${body.error ?? "Upload failed"}`);
      }

      const f = body.data.files[0]!;
      return text([
        `Updated ${f.filename} in ${args.slug} (${formatBytes(f.size)})`,
        `URL: ${f.url}`,
        "",
        "The file is live immediately. Schedule this tool with a cron to keep dashboards auto-refreshing without redeploying.",
      ].join("\n"));
    },
  );

  const listDataFiles = server.tool(
    "list_data_files",
    "List the refreshable data files (uploaded via upload_data) for a Deloc app, with sizes and last-updated time. Use this to check what data files exist and when they were last refreshed.",
    {
      slug: z.string().describe("The app slug"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      let resp: Response;
      try {
        resp = await apiFetch(`/api/apps/${encodeURIComponent(args.slug)}/data`);
      } catch (err) {
        return text(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }

      let body: ListDataResponse;
      try {
        body = (await resp.json()) as ListDataResponse;
      } catch {
        return text(`Error: Server returned ${resp.status} (${resp.statusText})`);
      }
      if (!body.success || !body.data) {
        return text(`Error: ${body.error ?? "Failed to list data files"}`);
      }

      if (body.data.files.length === 0) {
        return text(`No data files uploaded for ${args.slug} yet. Use the upload_data tool to add one.`);
      }

      const lines = [
        `Data files for ${args.slug}:`,
        ...body.data.files.map(
          (f) => `• ${f.filename} — ${formatBytes(f.sizeBytes)} — updated ${new Date(f.updatedAt).toLocaleString()}`,
        ),
      ];
      return text(lines.join("\n"));
    },
  );

  return [uploadData, listDataFiles];
}
