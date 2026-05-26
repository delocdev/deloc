import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireToken, apiFetch } from "../api.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

interface SecretRecord {
  secretName: string;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

function shortDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function registerActionSecretTools(server: McpServer) {
  const listSecrets = server.tool(
    "list_action_secrets",
    "List secret NAMES configured for an Action. Values are never returned — secrets are write-only after set.",
    {
      slug: z.string().describe("App slug"),
      action: z.string().describe("Action name"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/actions/${args.action}/secrets`);
      const body = await resp.json() as {
        success: boolean;
        data?: { secrets: SecretRecord[] };
        error?: string;
      };
      if (!body.success) return text(`Error: ${body.error}`);
      const rows = body.data?.secrets ?? [];
      if (rows.length === 0) {
        return text(`No secrets set for "${args.action}". If the target URL or headers use \${NAME} placeholders, set them with set_action_secret.`);
      }
      const lines = rows.map((r) => `• ${r.secretName} (v${r.keyVersion}, updated ${shortDate(r.updatedAt)})`);
      return text(lines.join("\n"));
    },
  );

  const setSecret = server.tool(
    "set_action_secret",
    "Set or rotate a secret for an Action. Values are encrypted at rest (libsodium secretbox) and never returned by any endpoint. Used to fill ${UPPERCASE_NAME} placeholders in target_url, header_template, or body_template. Do NOT echo the value back to the user in a conversation — keep it private.",
    {
      slug: z.string().describe("App slug"),
      action: z.string().describe("Action name"),
      secret_name: z
        .string()
        .describe("Uppercase name matching the template placeholder (e.g. API_KEY for ${API_KEY}). Letters, digits, underscores; starts with a letter; max 64 chars."),
      value: z
        .string()
        .describe("The secret value (API key, bearer token, etc.). Stored encrypted. Never logged. Do not include newlines or template syntax."),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(
        `/api/apps/${args.slug}/actions/${args.action}/secrets/${args.secret_name}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: args.value }),
        },
      );
      const body = await resp.json() as {
        success: boolean;
        data?: SecretRecord;
        error?: string;
        code?: string;
      };
      if (!body.success || !body.data) {
        const hint = body.code === "ACTIONS_TIER_REQUIRED"
          ? " Upgrade to Pro ($10/mo) or higher to use Actions."
          : "";
        return text(`Error: ${body.error ?? "Set failed"}${hint}`);
      }
      return text(`Set "${body.data.secretName}" (v${body.data.keyVersion}).`);
    },
  );

  const deleteSecret = server.tool(
    "delete_action_secret",
    "Delete a secret from an Action. Any template referencing ${NAME} will fail at invoke time with variable_missing until re-set.",
    {
      slug: z.string().describe("App slug"),
      action: z.string().describe("Action name"),
      secret_name: z.string().describe("Secret name to delete (uppercase)."),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(
        `/api/apps/${args.slug}/actions/${args.action}/secrets/${args.secret_name}`,
        { method: "DELETE" },
      );
      const body = await resp.json() as { success: boolean; data?: { secretName: string }; error?: string };
      if (!body.success) return text(`Error: ${body.error ?? "Delete failed"}`);
      return text(`Deleted secret "${args.secret_name}".`);
    },
  );

  return [listSecrets, setSecret, deleteSecret];
}
