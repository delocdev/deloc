// Dashboard query tools: saved BigQuery SQL attached to an app, executed
// daily by Deloc's scheduler. Each run writes the result to {name}.json next
// to the app's static files, so the dashboard reads fresh data with a plain
// fetch — no warehouse query at view time, no customer-run pipeline.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatBytes } from "@deloc/shared";
import { requireToken, apiFetch } from "../api.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

interface QueryInfo {
  id: string;
  name: string;
  connectionId: string;
  sql: string;
  gcpProjectId: string;
  maxBytesBilled: number | null;
  maxOutputBytes: number | null;
  enabled: boolean;
  frequency: string;
  outputFilename: string;
  lastRunAt: string | null;
  lastRunStatus: "ok" | "error" | "skipped_needs_reauth" | null;
  lastBytesBilled: number | null;
  lastRowCount: number | null;
  lastError: string | null;
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

function jsonBody(payload: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function describeQuery(q: QueryInfo): string {
  const lines = [
    `• ${q.name} → ./${q.outputFilename} — ${q.enabled ? `runs ${q.frequency}` : "DISABLED"}`,
  ];
  if (q.lastRunAt) {
    const bits = [`last run ${new Date(q.lastRunAt).toLocaleString()}: ${q.lastRunStatus}`];
    if (q.lastRunStatus === "ok" && q.lastRowCount !== null) bits.push(`${q.lastRowCount} rows`);
    if (q.lastBytesBilled !== null) bits.push(`${formatBytes(q.lastBytesBilled)} billed`);
    lines.push(`  ${bits.join(", ")}`);
    if (q.lastError) lines.push(`  error: ${q.lastError}`);
  } else {
    lines.push("  never run yet");
  }
  return lines.join("\n");
}

const queryNameDesc = "Query name (lowercase letters/digits/underscores, starts with a letter). The result file is served as {name}.json";

export function registerDashboardQueryTools(server: McpServer) {
  const createQuery = server.tool(
    "create_dashboard_query",
    [
      "Schedule a BigQuery SQL query that keeps a deployed Deloc app's data fresh automatically. Deloc runs the query daily (02:00 UTC) and writes the result to {name}.json next to the app's files, so the app should read it with fetch('./{name}.json').",
      "The JSON payload shape is: { columns: [{ name, type }], rows: [{ <column>: <value> }], refreshedAt: ISO-8601, rowCount: number }.",
      "The SQL must be a single read-only SELECT statement (no DML/DDL). Bytes billed per run are capped (default 10 GB) and the output file is capped at 8 MB — keep results pre-aggregated and small.",
      "Requires a BigQuery connection (connect_bigquery). After creating, call run_dashboard_query once so the data file exists before the app first loads it.",
    ].join(" "),
    {
      slug: z.string().describe("The app slug the query belongs to"),
      name: z.string().describe(queryNameDesc),
      connection_id: z.string().describe("BigQuery connection id (see list_data_connections)"),
      sql: z.string().describe("A single read-only SELECT statement (BigQuery standard SQL)"),
      gcp_project_id: z.string().describe("GCP project to bill the query to (see bigquery_list_projects)"),
      max_bytes_billed: z.number().int().positive().optional().describe("Override the per-run BigQuery bytes-billed cap (default 10 GB)"),
      max_output_bytes: z.number().int().positive().optional().describe("Override the output file size cap (default 8 MB)"),
      enabled: z.boolean().optional().describe("Set false to create the query without scheduling it (default true)"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const result = await callApi<QueryInfo>(
        `/api/apps/${encodeURIComponent(args.slug)}/queries`,
        jsonBody({
          name: args.name,
          connectionId: args.connection_id,
          sql: args.sql,
          gcpProjectId: args.gcp_project_id,
          maxBytesBilled: args.max_bytes_billed,
          maxOutputBytes: args.max_output_bytes,
          enabled: args.enabled,
        }),
      );
      if (!result.ok) return text(`Error: ${result.message}`);

      const q = result.data;
      return text([
        `Created query "${q.name}" on ${args.slug}. It will run daily and write ./${q.outputFilename}.`,
        "",
        `Make sure the app loads its data with fetch('./${q.outputFilename}') and renders the { columns, rows, refreshedAt, rowCount } payload.`,
        `Run it now with run_dashboard_query so ${q.outputFilename} exists immediately.`,
      ].join("\n"));
    },
  );

  const listQueries = server.tool(
    "list_dashboard_queries",
    "List the scheduled dashboard queries on an app, with their output files and last-run results.",
    {
      slug: z.string().describe("The app slug"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const result = await callApi<{ queries: QueryInfo[] }>(`/api/apps/${encodeURIComponent(args.slug)}/queries`);
      if (!result.ok) return text(`Error: ${result.message}`);
      if (result.data.queries.length === 0) {
        return text(`No dashboard queries on ${args.slug} yet. Use create_dashboard_query to add one.`);
      }
      return text([
        `Dashboard queries on ${args.slug}:`,
        ...result.data.queries.map(describeQuery),
      ].join("\n"));
    },
  );

  const updateQuery = server.tool(
    "update_dashboard_query",
    "Update a scheduled dashboard query: change its SQL, repoint it to a different connection, adjust caps, or enable/disable the schedule. Omitted fields are unchanged.",
    {
      slug: z.string().describe("The app slug"),
      name: z.string().describe("The query name"),
      sql: z.string().optional().describe("New SQL (single read-only SELECT)"),
      connection_id: z.string().optional().describe("Repoint to this connection id"),
      gcp_project_id: z.string().optional().describe("New GCP project to bill to"),
      max_bytes_billed: z.number().int().positive().optional(),
      max_output_bytes: z.number().int().positive().optional(),
      enabled: z.boolean().optional().describe("false pauses the schedule, true resumes it"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const patch: Record<string, unknown> = {};
      if (args.sql !== undefined) patch.sql = args.sql;
      if (args.connection_id !== undefined) patch.connectionId = args.connection_id;
      if (args.gcp_project_id !== undefined) patch.gcpProjectId = args.gcp_project_id;
      if (args.max_bytes_billed !== undefined) patch.maxBytesBilled = args.max_bytes_billed;
      if (args.max_output_bytes !== undefined) patch.maxOutputBytes = args.max_output_bytes;
      if (args.enabled !== undefined) patch.enabled = args.enabled;
      if (Object.keys(patch).length === 0) {
        return text("Error: Nothing to update — pass at least one field.");
      }

      const result = await callApi<QueryInfo>(
        `/api/apps/${encodeURIComponent(args.slug)}/queries/${encodeURIComponent(args.name)}`,
        { ...jsonBody(patch), method: "PATCH" },
      );
      if (!result.ok) return text(`Error: ${result.message}`);
      return text(`Updated query "${args.name}" on ${args.slug}.\n${describeQuery(result.data)}`);
    },
  );

  const deleteQuery = server.tool(
    "delete_dashboard_query",
    "Delete a scheduled dashboard query. The already-written {name}.json data file stays in the app; it just stops refreshing.",
    {
      slug: z.string().describe("The app slug"),
      name: z.string().describe("The query name"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const result = await callApi<{ name: string }>(
        `/api/apps/${encodeURIComponent(args.slug)}/queries/${encodeURIComponent(args.name)}`,
        { method: "DELETE" },
      );
      if (!result.ok) return text(`Error: ${result.message}`);
      return text(`Deleted query "${args.name}" from ${args.slug}.`);
    },
  );

  const runQuery = server.tool(
    "run_dashboard_query",
    "Run a scheduled dashboard query immediately instead of waiting for the daily refresh. Writes the result to the app's {name}.json on success.",
    {
      slug: z.string().describe("The app slug"),
      name: z.string().describe("The query name"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");

      const result = await callApi<{ outcome: string; query: QueryInfo | null }>(
        `/api/apps/${encodeURIComponent(args.slug)}/queries/${encodeURIComponent(args.name)}/run`,
        { method: "POST" },
      );
      if (!result.ok) {
        if (result.code === "needs_reauth") {
          return text(`Error: ${result.message}\nThe connection needs re-authorization — run connect_bigquery, then repoint this query with update_dashboard_query.`);
        }
        return text(`Error: ${result.message}`);
      }

      const q = result.data.query;
      if (!q || q.lastRunStatus !== "ok") {
        return text(`Query run finished with status: ${q?.lastRunStatus ?? result.data.outcome}${q?.lastError ? `\nError: ${q.lastError}` : ""}`);
      }
      const bits = [`${q.lastRowCount ?? "?"} rows`];
      if (q.lastBytesBilled !== null) bits.push(`${formatBytes(q.lastBytesBilled)} billed`);
      return text(`Query "${q.name}" ran successfully (${bits.join(", ")}). Fresh data written to ./${q.outputFilename}.`);
    },
  );

  return [createQuery, listQueries, updateQuery, deleteQuery, runQuery];
}
