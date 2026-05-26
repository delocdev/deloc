import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatBytes } from "@deloc/shared";
import { requireToken, apiFetch } from "../api.js";
import { daysUntil, formatExpiry } from "../helpers.js";

interface AppItem {
  name: string; slug: string; url: string; status: string;
  totalSizeBytes: number; expiresAt: string | null; createdAt: string;
}

interface AppsPageBody {
  success: boolean;
  data?: { apps: AppItem[]; total: number; page: number; per_page: number; total_pages: number };
  error?: string;
}

async function fetchAllApps(status: string | undefined): Promise<{ apps: AppItem[] } | { error: string }> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("page", "1");

  const resp = await apiFetch(`/api/apps?${params}`);
  const body = await resp.json() as AppsPageBody;
  if (!body.success || !body.data) return { error: body.error ?? "Failed to list apps" };

  const apps = [...body.data.apps];
  const totalPages = body.data.total_pages;

  if (totalPages > 1) {
    const pages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => {
        const p = new URLSearchParams();
        if (status) p.set("status", status);
        p.set("page", String(i + 2));
        return apiFetch(`/api/apps?${p}`).then((r) => r.json() as Promise<AppsPageBody>);
      }),
    );
    for (const page of pages) {
      if (page.success && page.data) apps.push(...page.data.apps);
    }
  }

  return { apps };
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function registerAppTools(server: McpServer) {
  const listApps = server.tool(
    "list_apps",
    "List published apps with their URLs and status",
    { status: z.enum(["active", "disabled", "expired", "all"]).optional().describe("Filter by status (default: all)") },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const result = await fetchAllApps(args.status);
      if ("error" in result) return text(`Error: ${result.error}`);
      const { apps } = result;
      if (apps.length === 0) return text("No apps found.");
      const lines = apps.map((a) =>
        `• ${a.name} — ${a.url} [${a.status}] (${formatBytes(a.totalSizeBytes)}) ${formatExpiry(a.expiresAt)}`,
      );
      return text(lines.join("\n"));
    },
  );

  const getApp = server.tool(
    "get_app",
    "Get detailed info about a published app including bandwidth usage",
    { slug: z.string().describe("App slug") },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}`);
      const body = await resp.json() as {
        success: boolean;
        data?: {
          name: string; slug: string; url: string; status: string; visibility: string;
          totalSizeBytes: number; fileCount: number; bandwidthUsedBytes: number;
          expiresAt: string | null; createdAt: string;
        };
        error?: string;
      };
      if (!body.success) return text(`Error: ${body.error}`);
      const a = body.data!;
      const expires = a.expiresAt ? `Expires: in ${daysUntil(a.expiresAt)} days` : "Expires: never";
      return text([
        `${a.name} (${a.slug})`,
        `URL: ${a.url}`,
        `Status: ${a.status}`,
        `Files: ${a.fileCount} (${formatBytes(a.totalSizeBytes)})`,
        `Bandwidth: ${formatBytes(a.bandwidthUsedBytes)} used this month`,
        expires,
        `Created: ${new Date(a.createdAt).toLocaleDateString()}`,
      ].join("\n"));
    },
  );

  const disableApp = server.tool(
    "disable_app",
    "Take a published app offline",
    { slug: z.string().describe("App slug to disable") },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/disable`, { method: "POST" });
      const body = await resp.json() as { success: boolean; error?: string };
      if (!body.success) return text(`Error: ${body.error}`);
      return text(`${args.slug} has been disabled and is no longer accessible.`);
    },
  );

  const enableApp = server.tool(
    "enable_app",
    "Re-enable a disabled app so it is served again",
    { slug: z.string().describe("App slug to enable") },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/enable`, { method: "POST" });
      const body = await resp.json() as { success: boolean; error?: string };
      if (!body.success) return text(`Error: ${body.error}`);
      return text(`${args.slug} is now active again.`);
    },
  );

  const deleteApp = server.tool(
    "delete_app",
    "Permanently delete a published app and its files",
    { slug: z.string().describe("App slug to delete") },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}`, { method: "DELETE" });
      const body = await resp.json() as { success: boolean; error?: string };
      if (!body.success) return text(`Error: ${body.error}`);
      return text(`${args.slug} has been permanently deleted.`);
    },
  );

  const renewApp = server.tool(
    "renew_app",
    "Extend a free-tier app's expiry by 30 days",
    { slug: z.string().describe("App slug to renew") },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/renew`, { method: "POST" });
      const body = await resp.json() as { success: boolean; data?: { expiresAt: string }; error?: string };
      if (!body.success) return text(`Error: ${body.error}`);
      const days = daysUntil(body.data!.expiresAt);
      return text(`${args.slug} renewed — now expires in ${days} days.`);
    },
  );

  return [listApps, getApp, disableApp, enableApp, deleteApp, renewApp];
}
