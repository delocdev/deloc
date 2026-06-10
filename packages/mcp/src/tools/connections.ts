// BigQuery data-connection tools. The OAuth handshake is hosted by the API
// (browser consent + hosted callback); these tools create a connect session,
// open the consent URL, and poll until the connection exists. Tokens live
// only on the API side — no tool here ever sees or stores one.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireToken, apiFetch } from "../api.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

interface ConnectionInfo {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  status: "active" | "needs_reauth" | "disabled";
  grantedScope: string | null;
  maxBytesBilledDefault: number;
  lastError: string | null;
  lastRefreshAt: string | null;
  createdAt: string;
}

interface SessionStatus {
  status: "pending" | "complete" | "error" | "expired";
  connectionId: string | null;
  error: string | null;
}

async function callApi<T>(path: string, options: RequestInit = {}): Promise<
  { ok: true; data: T } | { ok: false; message: string; code?: string; status: number }
> {
  let resp: Response;
  try {
    resp = await apiFetch(path, options);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), status: 0 };
  }
  let body: Envelope<T>;
  try {
    body = (await resp.json()) as Envelope<T>;
  } catch {
    return { ok: false, message: `Server returned ${resp.status} (${resp.statusText})`, status: resp.status };
  }
  if (!body.success || body.data === undefined) {
    return { ok: false, message: body.error ?? `Request failed (${resp.status})`, code: body.code, status: resp.status };
  }
  return { ok: true, data: body.data };
}

// Map the API's needs_reauth conflict to actionable guidance. There is no
// re-auth endpoint in V1: the fix is a fresh connection + repointed queries.
function reauthGuidance(message: string): string {
  return [
    `Error: ${message}`,
    "",
    "This connection's Google authorization was revoked or expired. To fix it:",
    "1. Run connect_bigquery to authorize a fresh connection",
    "2. Repoint queries to it with update_dashboard_query (connection_id)",
    "3. Optionally delete the old connection with delete_data_connection",
  ].join("\n");
}

function describeConnection(c: ConnectionInfo): string {
  const status = c.status === "active" ? "active" : c.status === "needs_reauth" ? "NEEDS RE-AUTH" : c.status;
  const lines = [
    `• ${c.displayName} (name: ${c.name}, id: ${c.id})`,
    `  provider: ${c.provider} — status: ${status}`,
  ];
  if (c.lastError) lines.push(`  last error: ${c.lastError}`);
  return lines.join("\n");
}

async function pollSession(
  sessionId: string,
  timeoutMs: number,
): Promise<{ state: "complete"; connectionId: string } | { state: "pending" } | { state: "failed"; message: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await callApi<SessionStatus>(`/api/connections/sessions/${encodeURIComponent(sessionId)}`);
    if (!result.ok) return { state: "failed", message: result.message };
    const { status, connectionId, error } = result.data;
    if (status === "complete" && connectionId) return { state: "complete", connectionId };
    if (status === "error") return { state: "failed", message: error ?? "Authorization failed" };
    if (status === "expired") return { state: "failed", message: "The connect session expired. Run connect_bigquery again." };
    await sleep(2000);
  }
  return { state: "pending" };
}

async function connectionSummary(connectionId: string): Promise<string> {
  const result = await callApi<ConnectionInfo>(`/api/connections/${encodeURIComponent(connectionId)}`);
  if (!result.ok) return `Connection id: ${connectionId}`;
  return `Connection "${result.data.displayName}" (name: ${result.data.name}, id: ${result.data.id})`;
}

export function registerConnectionTools(server: McpServer) {
  const connectBigQuery = server.tool(
    "connect_bigquery",
    "Connect the user's BigQuery account to Deloc so dashboards can be refreshed from warehouse queries on a daily schedule (see create_dashboard_query). Opens a Google consent page in the browser and waits for the user to approve. Deloc requests read-only BigQuery access and stores the credential encrypted server-side. Requires a Pro or higher plan (org accounts: Team/Enterprise admin).",
    {
      name: z.string().optional().describe("Identifier for the connection (lowercase letters/digits/underscores, must start with a letter). Auto-generated if omitted."),
      display_name: z.string().optional().describe("Human-readable label shown in the dashboard (default: 'BigQuery')"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const created = await callApi<{ sessionId: string; authorizeUrl: string; expiresAt: string }>(
        "/api/connections/bigquery/session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: args.name, displayName: args.display_name }),
        },
      );
      if (!created.ok) return text(`Error: ${created.message}`);

      const { sessionId, authorizeUrl } = created.data;
      let opened = true;
      try {
        const { default: open } = await import("open");
        await open(authorizeUrl);
      } catch {
        opened = false;
      }

      const outcome = await pollSession(sessionId, 120_000);
      if (outcome.state === "complete") {
        const summary = await connectionSummary(outcome.connectionId);
        return text([
          `BigQuery connected. ${summary}`,
          "",
          "Next steps:",
          "- bigquery_list_projects to browse what this connection can see",
          "- create_dashboard_query to schedule a daily query that feeds an app's data file",
        ].join("\n"));
      }
      if (outcome.state === "failed") return text(`Error: ${outcome.message}`);

      return text([
        opened
          ? "A Google consent page was opened in the browser, but the authorization hasn't completed yet."
          : `Could not open a browser. Ask the user to open this URL:\n${authorizeUrl}`,
        "",
        `Once the user approves, call check_bigquery_connection with session_id "${sessionId}" to finish (the link expires 10 minutes after connect_bigquery was called).`,
      ].join("\n"));
    },
  );

  const checkConnection = server.tool(
    "check_bigquery_connection",
    "Check whether a pending BigQuery connect session (started with connect_bigquery) has been approved. Polls briefly and reports the result.",
    {
      session_id: z.string().describe("The session_id returned by connect_bigquery"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const outcome = await pollSession(args.session_id, 15_000);
      if (outcome.state === "complete") {
        const summary = await connectionSummary(outcome.connectionId);
        return text(`BigQuery connected. ${summary}`);
      }
      if (outcome.state === "failed") return text(`Error: ${outcome.message}`);
      return text("Still waiting for the user to approve in the browser. Call check_bigquery_connection again after they finish.");
    },
  );

  const listConnections = server.tool(
    "list_data_connections",
    "List the user's data connections (BigQuery), including any that need re-authorization.",
    {},
    async () => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const result = await callApi<{ connections: ConnectionInfo[] }>("/api/connections");
      if (!result.ok) return text(`Error: ${result.message}`);
      if (result.data.connections.length === 0) {
        return text("No data connections yet. Use connect_bigquery to add one.");
      }
      return text([
        "Data connections:",
        ...result.data.connections.map(describeConnection),
      ].join("\n"));
    },
  );

  const deleteConnection = server.tool(
    "delete_data_connection",
    "Delete a data connection. Fails if any dashboard query still uses it — repoint or delete those queries first.",
    {
      connection_id: z.string().describe("The connection id (see list_data_connections)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const result = await callApi<{ id: string }>(`/api/connections/${encodeURIComponent(args.connection_id)}`, {
        method: "DELETE",
      });
      if (!result.ok) {
        if (result.code === "CONNECTION_IN_USE") {
          return text(`Error: ${result.message}\nUse list_dashboard_queries on the affected apps, then update_dashboard_query or delete_dashboard_query before retrying.`);
        }
        return text(`Error: ${result.message}`);
      }
      return text("Connection deleted.");
    },
  );

  const introspect = async (path: string, render: (data: never) => string) => {
    const result = await callApi<never>(path);
    if (!result.ok) {
      if (result.code === "NEEDS_REAUTH") return text(reauthGuidance(result.message));
      return text(`Error: ${result.message}`);
    }
    return text(render(result.data));
  };

  const listProjects = server.tool(
    "bigquery_list_projects",
    "List the GCP projects a BigQuery connection can access. Use the project id as gcp_project_id when creating dashboard queries.",
    {
      connection_id: z.string().describe("The connection id (see list_data_connections)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      return introspect(
        `/api/connections/${encodeURIComponent(args.connection_id)}/projects`,
        (data: { projects: Array<{ id: string; friendlyName?: string }> }) =>
          data.projects.length === 0
            ? "No projects visible to this connection."
            : ["Projects:", ...data.projects.map((p) => `• ${p.id}${p.friendlyName ? ` (${p.friendlyName})` : ""}`)].join("\n"),
      );
    },
  );

  const listDatasets = server.tool(
    "bigquery_list_datasets",
    "List the datasets in a GCP project visible to a BigQuery connection.",
    {
      connection_id: z.string().describe("The connection id"),
      project: z.string().describe("GCP project id (see bigquery_list_projects)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      return introspect(
        `/api/connections/${encodeURIComponent(args.connection_id)}/datasets?project=${encodeURIComponent(args.project)}`,
        (data: { datasets: Array<{ datasetId: string; location?: string }> }) =>
          data.datasets.length === 0
            ? "No datasets in this project."
            : ["Datasets:", ...data.datasets.map((d) => `• ${d.datasetId}${d.location ? ` (${d.location})` : ""}`)].join("\n"),
      );
    },
  );

  const listTables = server.tool(
    "bigquery_list_tables",
    "List the tables in a BigQuery dataset.",
    {
      connection_id: z.string().describe("The connection id"),
      project: z.string().describe("GCP project id"),
      dataset: z.string().describe("Dataset id (see bigquery_list_datasets)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      return introspect(
        `/api/connections/${encodeURIComponent(args.connection_id)}/tables?project=${encodeURIComponent(args.project)}&dataset=${encodeURIComponent(args.dataset)}`,
        (data: { tables: Array<{ tableId: string; type?: string }> }) =>
          data.tables.length === 0
            ? "No tables in this dataset."
            : ["Tables:", ...data.tables.map((t) => `• ${t.tableId}${t.type && t.type !== "TABLE" ? ` (${t.type})` : ""}`)].join("\n"),
      );
    },
  );

  const getTableSchema = server.tool(
    "bigquery_get_table_schema",
    "Get the column names and types of a BigQuery table. Use this to write correct SQL for create_dashboard_query.",
    {
      connection_id: z.string().describe("The connection id"),
      project: z.string().describe("GCP project id"),
      dataset: z.string().describe("Dataset id"),
      table: z.string().describe("Table id (see bigquery_list_tables)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const qs = `project=${encodeURIComponent(args.project)}&dataset=${encodeURIComponent(args.dataset)}&table=${encodeURIComponent(args.table)}`;
      return introspect(
        `/api/connections/${encodeURIComponent(args.connection_id)}/table-schema?${qs}`,
        (data: { fields: Array<{ name: string; type: string; mode?: string }> }) =>
          data.fields.length === 0
            ? "No fields returned for this table."
            : [
                `Schema of ${args.project}.${args.dataset}.${args.table}:`,
                ...data.fields.map((f) => `• ${f.name}: ${f.type}${f.mode === "REPEATED" ? "[]" : ""}${f.mode === "REQUIRED" ? " (required)" : ""}`),
              ].join("\n"),
      );
    },
  );

  return [
    connectBigQuery,
    checkConnection,
    listConnections,
    deleteConnection,
    listProjects,
    listDatasets,
    listTables,
    getTableSchema,
  ];
}
