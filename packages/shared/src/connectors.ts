// Shared types and constants for data connectors (BigQuery first). Kept free
// of imports so it stays both API-safe (no client-only deps) and CLI-safe
// (no DB or server internals). Mirrored manually into the public clients repo.

// The only connector provider in V1. Designed as a union so the output,
// scheduling, and storage layers stay source-agnostic when Snowflake lands.
export type DataConnectionProvider = "bigquery";

// Lifecycle of a stored connection. `needs_reauth` is set by the token
// refresher when the upstream returns invalid_grant (revoked or expired
// refresh token); the dashboard surfaces a one-click re-auth from this state.
export type DataConnectionStatus = "active" | "needs_reauth" | "disabled";

// The short-lived OAuth handshake the CLI/MCP polls while the browser consent
// completes. The session id doubles as the polling bearer; the connection it
// produces is owned by the authenticated principal that created the session.
export type ConnectionSessionStatus = "pending" | "complete" | "error";

// How often the scheduled runner refreshes a stored query. V1 ships daily
// only; the column exists so hourly can land without a migration.
export type QueryRefreshFrequency = "daily";

export type QueryRunStatus = "ok" | "error" | "skipped_needs_reauth";

// The shape the runner writes to per-app storage and the static frontend reads.
// `columns` carries BigQuery field names + types so the dashboard can render
// without guessing; `rows` is an array of objects keyed by column name.
export interface QueryResultColumn {
  name: string;
  // BigQuery standard SQL type, e.g. STRING, INT64, FLOAT64, BOOL, TIMESTAMP.
  type: string;
}

export interface QueryResultPayload {
  columns: QueryResultColumn[];
  rows: Array<Record<string, unknown>>;
  // ISO-8601 timestamp of the run that produced this file.
  refreshedAt: string;
  rowCount: number;
}

// BigQuery OAuth scope. Read-only authorizes running SELECT query jobs while
// blocking writes (DML/DDL), so it satisfies introspection AND scheduled
// query execution without granting write access. Verify in the connect spike;
// fall back to BIGQUERY_READONLY_FALLBACK_SCOPE only if Google rejects this one
// for jobs.query.
export const BIGQUERY_READONLY_SCOPE = "https://www.googleapis.com/auth/bigquery.readonly";
export const BIGQUERY_READONLY_FALLBACK_SCOPE = "https://www.googleapis.com/auth/cloud-platform.read-only";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const BIGQUERY_API_BASE = "https://bigquery.googleapis.com/bigquery/v2";

// Default cap on bytes BigQuery is allowed to bill per query. Mandatory on
// every query: it protects the customer from unreviewed (often AI-authored)
// SQL scanning huge tables on a daily cron, and protects Deloc from the
// support fallout of a surprise warehouse bill. ~10 GB ≈ a few US cents
// on on-demand pricing. Overridable per connection and per query.
export const DEFAULT_MAX_BYTES_BILLED = 10 * 1024 * 1024 * 1024; // 10 GB

// Default cap on the assembled JSON result written to per-app storage. The
// speed pitch depends on a small payload served from the CDN, so the runner
// fails a query whose output exceeds this rather than shipping a giant file
// that loses the load comparison (and bumps the 100 MB data-file ceiling).
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024; // 8 MB

// Connection-session lifetime. Long enough to complete a browser consent,
// short enough that a leaked session id is useless after the window.
export const CONNECTION_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
