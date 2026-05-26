import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireToken, apiFetch } from "../api.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

interface ActionSummary {
  id: string;
  name: string;
  displayName: string;
  method: string;
  status: string;
  externalIdVariable: string | null;
  invocationsThisMonth: number;
  errorRatePercent: number;
  lastInvokedAt: string | null;
  createdAt: string;
}

interface ActionInvocationLog {
  id: string;
  actionName: string;
  viewerEmail: string | null;
  externalId: string | null;
  statusCode: number | null;
  latencyMs: number;
  errorType: string | null;
  errorMessage: string | null;
  success: boolean;
  createdAt: string;
}

interface InvokeResultSuccess {
  success: true;
  data: unknown;
  statusCode: number;
  latencyMs: number;
}

interface InvokeResultError {
  success: false;
  error: string;
  errorType: string;
  statusCode: number | null;
  latencyMs: number;
}

function shortDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export function registerActionTools(server: McpServer) {
  const listActions = server.tool(
    "list_actions",
    "List Actions configured for a published app. Shows method, status, and recent invocation stats.",
    {
      slug: z.string().describe("App slug"),
    },
    async (args) => {
      if (!requireToken()) {
        return text("Error: Not authenticated. Use the setup_deloc tool first.");
      }
      const resp = await apiFetch(`/api/apps/${args.slug}/actions`);
      const body = await resp.json() as {
        success: boolean;
        data?: { actions: ActionSummary[] };
        error?: string;
      };
      if (!body.success) return text(`Error: ${body.error}`);
      const list = body.data?.actions ?? [];
      if (list.length === 0) {
        return text(`No actions configured for ${args.slug}. Create one in the dashboard under "Actions".`);
      }
      const lines = list.map((a) => {
        const status = a.status === "active" ? a.status : `[${a.status}]`;
        const stats = `${a.invocationsThisMonth} this month, ${a.errorRatePercent}% errors (1h)`;
        return `• ${a.name} (${a.displayName}) — ${a.method} ${status} — ${stats}, last: ${shortDate(a.lastInvokedAt)}`;
      });
      return text(lines.join("\n"));
    },
  );

  const testAction = server.tool(
    "test_action",
    "Run a single test invocation against a configured Action. Logged with errorType='test' so it does not count toward auto-disable.",
    {
      slug: z.string().describe("App slug"),
      name: z.string().describe("Action name"),
      body: z.record(z.string(), z.unknown()).optional().describe("JSON body to send (default {})"),
    },
    async (args) => {
      if (!requireToken()) {
        return text("Error: Not authenticated. Use the setup_deloc tool first.");
      }
      const resp = await apiFetch(`/api/apps/${args.slug}/actions/${args.name}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: args.body ?? {} }),
      });
      const body = await resp.json() as {
        success: boolean;
        data?: InvokeResultSuccess | InvokeResultError;
        error?: string;
      };
      if (!body.success || !body.data) return text(`Error: ${body.error ?? "Test failed"}`);
      const r = body.data;
      if (r.success) {
        const preview = typeof r.data === "string"
          ? r.data.slice(0, 500)
          : JSON.stringify(r.data).slice(0, 500);
        return text(
          [
            `OK ${r.statusCode} (${r.latencyMs}ms)`,
            preview,
          ].join("\n"),
        );
      }
      const parts = [
        `FAIL ${r.errorType}${r.statusCode ? ` (${r.statusCode})` : ""} (${r.latencyMs}ms)`,
        r.error,
      ];
      return text(parts.join("\n"));
    },
  );

  const getActionLogs = server.tool(
    "get_action_logs",
    "Fetch recent invocation history for an app's Actions. Filter by action name, status, or externalId.",
    {
      slug: z.string().describe("App slug"),
      action: z.string().optional().describe("Filter to a single action name"),
      status: z.enum(["success", "error", "test"]).optional().describe("Filter by invocation status"),
      external_id: z.string().optional().describe("Filter by the action's externalId column"),
      limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50, max 200)"),
    },
    async (args) => {
      if (!requireToken()) {
        return text("Error: Not authenticated. Use the setup_deloc tool first.");
      }
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.limit) params.set("limit", String(args.limit));

      let path: string;
      if (args.external_id) {
        // externalId filter is only available on the app-wide invocations
        // endpoint — fold the action filter into the query string.
        if (args.action) params.set("action", args.action);
        params.set("externalId", args.external_id);
        path = `/api/apps/${args.slug}/invocations?${params}`;
      } else if (args.action) {
        path = `/api/apps/${args.slug}/actions/${args.action}/logs?${params}`;
      } else {
        path = `/api/apps/${args.slug}/invocations?${params}`;
      }

      const resp = await apiFetch(path);
      const body = await resp.json() as {
        success: boolean;
        data?: { invocations: ActionInvocationLog[]; nextCursor: string | null };
        error?: string;
      };
      if (!body.success) return text(`Error: ${body.error}`);
      const rows = body.data?.invocations ?? [];
      if (rows.length === 0) return text("No invocations matched.");

      const lines = rows.map((r) => {
        const status = r.errorType === "test"
          ? "[test]"
          : r.success
            ? `OK ${r.statusCode ?? ""}`
            : `ERR ${r.errorType ?? ""}${r.statusCode ? ` ${r.statusCode}` : ""}`;
        const viewer = r.viewerEmail ?? "anon";
        const extra = r.externalId ? ` id=${r.externalId}` : "";
        return `${shortDate(r.createdAt)} — ${r.actionName} ${status} ${r.latencyMs}ms ${viewer}${extra}`;
      });
      return text(lines.join("\n"));
    },
  );

  return [listActions, testAction, getActionLogs];
}
