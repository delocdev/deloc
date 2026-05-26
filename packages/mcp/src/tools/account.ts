import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { formatBytes } from "@deloc/shared";
import { requireToken, apiFetch } from "../api.js";
import { generatePassword } from "../helpers.js";

const MAX_OG_SIZE = 2 * 1024 * 1024; // 2MB
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function registerAccountTools(server: McpServer) {
  const setPassword = server.tool(
    "set_password",
    "Set, change, or remove password protection on an app",
    {
      slug: z.string().describe("App slug"),
      password: z.string().optional().describe("New password. Omit to auto-generate one."),
      remove: z.boolean().optional().describe("Set to true to remove password protection (make public)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      if (args.remove) {
        const resp = await apiFetch(`/api/apps/${args.slug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: "public" }),
        });
        const body = await resp.json() as { success: boolean; error?: string };
        if (!body.success) return text(`Error: ${body.error}`);
        return text(`${args.slug} is now public (password removed).`);
      }
      const password = args.password || generatePassword();
      const resp = await apiFetch(`/api/apps/${args.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: "password_protected", password }),
      });
      const body = await resp.json() as { success: boolean; error?: string };
      if (!body.success) return text(`Error: ${body.error}`);
      return text(`${args.slug} is now password protected.\nPassword: ${password}\nShare this with your viewers.`);
    },
  );

  const getAccount = server.tool(
    "get_account",
    "Get current user info including tier, usage, and limits",
    {},
    async () => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch("/api/auth/me");
      const body = await resp.json() as {
        success: boolean;
        data?: {
          email: string; username: string; name: string; tier: string;
          totalStorageUsedBytes: number; orgName?: string; orgSlug?: string | null;
          limits?: { maxApps: number | null; maxStorageBytes: number | null; deploysPerDay: number | null; appExpiryDays: number | null };
        };
        error?: string;
      };
      if (!body.success) return text(`Error: ${body.error}`);
      const me = body.data!;
      const limits = me.limits;
      const fmt = (v: number | null) => v == null ? "unlimited" : String(v);
      const fmtBytes = (v: number | null) => v == null ? "unlimited" : formatBytes(v);
      const appSubdomain = me.orgSlug ?? me.username;
      return text([
        `${me.name} (${me.email})`,
        `Username: ${me.username}`,
        `App URLs: {slug}--${appSubdomain}.deloc.app`,
        `Tier: ${me.tier}`,
        limits ? `Storage: ${formatBytes(me.totalStorageUsedBytes)} / ${fmtBytes(limits.maxStorageBytes)}` : null,
        limits ? `Max apps: ${fmt(limits.maxApps)}` : null,
        limits ? `Deploys/day: ${fmt(limits.deploysPerDay)}` : null,
        me.orgName ? `Organization: ${me.orgName}` : null,
      ].filter(Boolean).join("\n"));
    },
  );

  const setOgImage = server.tool(
    "set_og_image",
    "Set a custom OG preview image for an app (shown in link previews on X, Slack, etc.). Accepts a local PNG file path.",
    {
      slug: z.string().describe("App slug"),
      image_path: z.string().describe("Absolute path to a PNG image (max 2MB, 1200x630 recommended)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const filePath = resolve(args.image_path);
      let buffer: Buffer;
      try {
        buffer = await readFile(filePath);
      } catch {
        return text(`Error: Could not read file: ${filePath}`);
      }

      if (buffer.length > MAX_OG_SIZE) {
        return text(`Error: Image too large (${Math.round(buffer.length / 1024)}KB). Max is 2MB.`);
      }

      const isPng = PNG_MAGIC.every((byte, i) => buffer[i] === byte);
      if (!isPng) {
        return text("Error: Image must be a PNG file.");
      }

      const formData = new FormData();
      formData.append(
        "file",
        new Blob([new Uint8Array(buffer)], { type: "image/png" }),
        "og-screenshot.png",
      );

      const resp = await apiFetch(`/api/apps/${args.slug}/og-image`, {
        method: "POST",
        body: formData,
      });

      const body = await resp.json() as { success: boolean; error?: string };
      if (!body.success) return text(`Error: ${body.error}`);
      return text(`OG image set for ${args.slug}. Link previews on X, Slack, etc. will now show your image.`);
    },
  );

  return [setPassword, getAccount, setOgImage];
}
