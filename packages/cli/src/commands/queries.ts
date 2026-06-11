// `deloc query` group: saved BigQuery SQL attached to an app, run daily by
// Deloc's scheduler. Each run writes {name}.json next to the app's files, so
// the dashboard reads fresh data with fetch('./{name}.json').

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { formatBytes } from "@deloc/shared";
import { getToken, apiFetch } from "../config.js";
import { chalk, ora, errorMessage, infoMessage } from "../ui.js";
import { resolveConnection } from "./connect.js";

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

async function parseEnvelope<T>(resp: Response): Promise<Envelope<T>> {
  try {
    return (await resp.json()) as Envelope<T>;
  } catch {
    return { success: false, error: `Server returned ${resp.status} (${resp.statusText})` };
  }
}

async function requireLogin(): Promise<string> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }
  return token;
}

// --sql and --sql-file are mutually exclusive; exactly one is required when
// the caller must provide SQL (add), at most one when optional (update).
async function readSql(options: { sql?: string; sqlFile?: string }, required: boolean): Promise<string | undefined> {
  if (options.sql && options.sqlFile) {
    console.log(errorMessage("Pass either --sql or --sql-file, not both."));
    process.exit(1);
  }
  if (options.sqlFile) {
    try {
      return await readFile(resolve(options.sqlFile), "utf-8");
    } catch {
      console.log(errorMessage(`Could not read SQL file: ${options.sqlFile}`));
      process.exit(1);
    }
  }
  if (options.sql) return options.sql;
  if (required) {
    console.log(errorMessage("SQL is required. Pass --sql '<select ...>' or --sql-file <path>."));
    process.exit(1);
  }
  return undefined;
}

function parsePositiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.log(errorMessage(`${flag} must be a positive integer.`));
    process.exit(1);
  }
  return n;
}

function printQuery(q: QueryInfo): void {
  const schedule = q.enabled ? chalk.green(`runs ${q.frequency}`) : chalk.yellow("disabled");
  console.log(`${chalk.bold(q.name)} → ./${q.outputFilename} — ${schedule}`);
  if (q.lastRunAt) {
    const status = q.lastRunStatus === "ok" ? chalk.green("ok") : chalk.red(q.lastRunStatus ?? "?");
    const bits = [`${new Date(q.lastRunAt).toLocaleString()}`, status];
    if (q.lastRunStatus === "ok" && q.lastRowCount !== null) bits.push(`${q.lastRowCount} rows`);
    if (q.lastBytesBilled !== null) bits.push(`${formatBytes(q.lastBytesBilled)} billed`);
    console.log(`  ${chalk.dim("last run")}  ${bits.join(" — ")}`);
    if (q.lastError) console.log(`  ${chalk.dim("error")}  ${q.lastError}`);
  } else {
    console.log(`  ${chalk.dim("last run")}  never`);
  }
}

interface QueryAddOptions {
  connection: string;
  project: string;
  sql?: string;
  sqlFile?: string;
  maxBytesBilled?: string;
  maxOutputBytes?: string;
  disabled?: boolean;
}

export async function queryAddCommand(slug: string, name: string, options: QueryAddOptions): Promise<void> {
  const token = await requireLogin();
  const sql = (await readSql(options, true))!;

  const connection = await resolveConnection(token, options.connection);
  if (!connection) {
    console.log(errorMessage(`No connection matching '${options.connection}'. Run ${chalk.bold("deloc connections list")}.`));
    process.exit(1);
  }

  const resp = await apiFetch(`/api/apps/${encodeURIComponent(slug)}/queries`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      connectionId: connection.id,
      sql,
      gcpProjectId: options.project,
      maxBytesBilled: parsePositiveInt(options.maxBytesBilled, "--max-bytes-billed"),
      maxOutputBytes: parsePositiveInt(options.maxOutputBytes, "--max-output-bytes"),
      enabled: options.disabled ? false : undefined,
    }),
  });
  const body = await parseEnvelope<QueryInfo>(resp);
  if (!body.success || !body.data) {
    console.log(errorMessage(body.error ?? "Could not create the query"));
    process.exit(1);
  }

  console.log(`${chalk.green("✓")} Created query ${chalk.bold(name)} on ${chalk.cyan(slug)} → ./${body.data.outputFilename}`);
  console.log(infoMessage(`Load it in the app with fetch('./${body.data.outputFilename}'). Run it now: ${chalk.bold(`deloc query run ${slug} ${name}`)}`));
}

export async function queryListCommand(slug: string): Promise<void> {
  const token = await requireLogin();

  const resp = await apiFetch(`/api/apps/${encodeURIComponent(slug)}/queries`, token);
  const body = await parseEnvelope<{ queries: QueryInfo[] }>(resp);
  if (!body.success || !body.data) {
    console.log(errorMessage(body.error ?? "Could not list queries"));
    process.exit(1);
  }
  if (body.data.queries.length === 0) {
    console.log(infoMessage(`No queries on ${slug} yet. Add one with ${chalk.bold(`deloc query add ${slug} <name> --connection <conn> --project <gcp-project> --sql '...'`)}`));
    return;
  }
  for (const q of body.data.queries) printQuery(q);
}

interface QueryUpdateOptions {
  connection?: string;
  project?: string;
  sql?: string;
  sqlFile?: string;
  maxBytesBilled?: string;
  maxOutputBytes?: string;
  enable?: boolean;
  disable?: boolean;
}

export async function queryUpdateCommand(slug: string, name: string, options: QueryUpdateOptions): Promise<void> {
  const token = await requireLogin();

  if (options.enable && options.disable) {
    console.log(errorMessage("Pass either --enable or --disable, not both."));
    process.exit(1);
  }

  const patch: Record<string, unknown> = {};
  const sql = await readSql(options, false);
  if (sql !== undefined) patch.sql = sql;
  if (options.connection !== undefined) {
    const connection = await resolveConnection(token, options.connection);
    if (!connection) {
      console.log(errorMessage(`No connection matching '${options.connection}'. Run ${chalk.bold("deloc connections list")}.`));
      process.exit(1);
    }
    patch.connectionId = connection.id;
  }
  if (options.project !== undefined) patch.gcpProjectId = options.project;
  const maxBytesBilled = parsePositiveInt(options.maxBytesBilled, "--max-bytes-billed");
  if (maxBytesBilled !== undefined) patch.maxBytesBilled = maxBytesBilled;
  const maxOutputBytes = parsePositiveInt(options.maxOutputBytes, "--max-output-bytes");
  if (maxOutputBytes !== undefined) patch.maxOutputBytes = maxOutputBytes;
  if (options.enable) patch.enabled = true;
  if (options.disable) patch.enabled = false;

  if (Object.keys(patch).length === 0) {
    console.log(errorMessage("Nothing to update — pass at least one option."));
    process.exit(1);
  }

  const resp = await apiFetch(`/api/apps/${encodeURIComponent(slug)}/queries/${encodeURIComponent(name)}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await parseEnvelope<QueryInfo>(resp);
  if (!body.success || !body.data) {
    console.log(errorMessage(body.error ?? "Could not update the query"));
    process.exit(1);
  }
  console.log(`${chalk.green("✓")} Updated query ${chalk.bold(name)} on ${chalk.cyan(slug)}`);
  printQuery(body.data);
}

export async function queryRemoveCommand(slug: string, name: string): Promise<void> {
  const token = await requireLogin();

  const resp = await apiFetch(`/api/apps/${encodeURIComponent(slug)}/queries/${encodeURIComponent(name)}`, token, {
    method: "DELETE",
  });
  const body = await parseEnvelope<{ name: string }>(resp);
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Could not delete the query"));
    process.exit(1);
  }
  console.log(`${chalk.green("✓")} Deleted query ${chalk.bold(name)} from ${chalk.cyan(slug)}`);
}

export async function queryRunCommand(slug: string, name: string): Promise<void> {
  const token = await requireLogin();

  const spinner = ora(`Running ${name}...`).start();
  const resp = await apiFetch(`/api/apps/${encodeURIComponent(slug)}/queries/${encodeURIComponent(name)}/run`, token, {
    method: "POST",
  });
  const body = await parseEnvelope<{ outcome: string; query: QueryInfo | null }>(resp);
  if (!body.success || !body.data) {
    spinner.fail(body.error ?? "Query run failed");
    if (body.code === "needs_reauth") {
      console.log(infoMessage(`Reconnect with ${chalk.bold("deloc connect bigquery")}, then repoint: ${chalk.bold(`deloc query update ${slug} ${name} --connection <new>`)}`));
    }
    process.exit(1);
  }

  const q = body.data.query;
  if (!q || q.lastRunStatus !== "ok") {
    spinner.fail(`Run finished with status: ${q?.lastRunStatus ?? body.data.outcome}`);
    if (q?.lastError) console.log(`  ${chalk.dim("error")}  ${q.lastError}`);
    process.exit(1);
  }

  const bits = [`${q.lastRowCount ?? "?"} rows`];
  if (q.lastBytesBilled !== null) bits.push(`${formatBytes(q.lastBytesBilled)} billed`);
  spinner.succeed(`Query ran (${bits.join(", ")}) — fresh data at ./${q.outputFilename}`);
}
