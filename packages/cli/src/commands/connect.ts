// `deloc connect bigquery` + `deloc connections` group. The OAuth handshake
// is hosted by the API: we create a connect session, open the consent URL in
// the browser, and poll the session until the connection exists. The Google
// refresh token never touches this machine.

import { getToken, apiFetch } from "../config.js";
import { chalk, ora, errorMessage, infoMessage } from "../ui.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // matches the API's session TTL

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface ConnectionInfo {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  status: "active" | "needs_reauth" | "disabled";
  lastError: string | null;
  lastRefreshAt: string | null;
  createdAt: string;
}

async function parseEnvelope<T>(resp: Response): Promise<Envelope<T>> {
  try {
    return (await resp.json()) as Envelope<T>;
  } catch {
    return { success: false, error: `Server returned ${resp.status} (${resp.statusText})` };
  }
}

// Resolve a connection by id or name within the caller's scope. Used by the
// query commands so users can say --connection my_warehouse instead of a UUID.
export async function resolveConnection(token: string, idOrName: string): Promise<ConnectionInfo | null> {
  const resp = await apiFetch("/api/connections", token);
  const body = await parseEnvelope<{ connections: ConnectionInfo[] }>(resp);
  if (!body.success || !body.data) return null;
  return body.data.connections.find((c) => c.id === idOrName || c.name === idOrName) ?? null;
}

interface ConnectOptions {
  name?: string;
  displayName?: string;
}

export async function connectCommand(provider: string, options: ConnectOptions): Promise<void> {
  if (provider !== "bigquery") {
    console.log(errorMessage(`Unknown provider '${provider}'. Supported: bigquery`));
    process.exit(1);
  }

  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }

  const createResp = await apiFetch("/api/connections/bigquery/session", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: options.name, displayName: options.displayName }),
  });
  const created = await parseEnvelope<{ sessionId: string; authorizeUrl: string; expiresAt: string }>(createResp);
  if (!created.success || !created.data) {
    console.log(errorMessage(created.error ?? "Could not start the connect flow"));
    process.exit(1);
  }

  const { sessionId, authorizeUrl } = created.data;
  try {
    const { default: open } = await import("open");
    await open(authorizeUrl);
  } catch {
    console.log(infoMessage(`Open this URL in your browser:\n  ${authorizeUrl}`));
  }

  const spinner = ora("Waiting for Google consent in the browser...").start();
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollResp = await apiFetch(`/api/connections/sessions/${encodeURIComponent(sessionId)}`, token);
    const poll = await parseEnvelope<{ status: string; connectionId: string | null; error: string | null }>(pollResp);
    if (!poll.success || !poll.data) {
      spinner.fail(poll.error ?? "Lost track of the connect session");
      process.exit(1);
    }
    const { status, connectionId, error } = poll.data;
    if (status === "complete" && connectionId) {
      spinner.succeed("BigQuery connected");
      const detailResp = await apiFetch(`/api/connections/${encodeURIComponent(connectionId)}`, token);
      const detail = await parseEnvelope<ConnectionInfo>(detailResp);
      const name = detail.data?.name ?? connectionId;
      console.log(`  ${chalk.dim("Connection")}  ${chalk.bold(name)} ${chalk.dim(`(${connectionId})`)}`);
      console.log("");
      console.log(`Schedule a daily query with ${chalk.bold(`deloc query add <app-slug> <name> --connection ${name} ...`)}`);
      return;
    }
    if (status === "error") {
      spinner.fail(error ?? "Authorization failed");
      process.exit(1);
    }
    if (status === "expired") {
      spinner.fail("The connect session expired. Run the command again.");
      process.exit(1);
    }
  }

  spinner.fail("Timed out waiting for browser approval.");
  process.exit(1);
}

export async function connectionsListCommand(): Promise<void> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }

  const resp = await apiFetch("/api/connections", token);
  const body = await parseEnvelope<{ connections: ConnectionInfo[] }>(resp);
  if (!body.success || !body.data) {
    console.log(errorMessage(body.error ?? "Could not list connections"));
    process.exit(1);
  }

  if (body.data.connections.length === 0) {
    console.log(infoMessage("No data connections yet. Run " + chalk.bold("deloc connect bigquery") + " to add one."));
    return;
  }

  for (const c of body.data.connections) {
    const status =
      c.status === "active"
        ? chalk.green("active")
        : c.status === "needs_reauth"
          ? chalk.red("needs re-auth")
          : chalk.yellow(c.status);
    console.log(`${chalk.bold(c.displayName)} ${chalk.dim(`(${c.name})`)} — ${c.provider} — ${status}`);
    console.log(`  ${chalk.dim("id")}  ${c.id}`);
    if (c.lastError) console.log(`  ${chalk.dim("last error")}  ${c.lastError}`);
  }

  if (body.data.connections.some((c) => c.status === "needs_reauth")) {
    console.log("");
    console.log(
      infoMessage(
        "Re-auth: run " + chalk.bold("deloc connect bigquery") + " for a fresh connection, then repoint queries with " + chalk.bold("deloc query update <slug> <name> --connection <new>"),
      ),
    );
  }
}

export async function connectionsDeleteCommand(idOrName: string): Promise<void> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }

  const connection = await resolveConnection(token, idOrName);
  if (!connection) {
    console.log(errorMessage(`No connection matching '${idOrName}'. Run ${chalk.bold("deloc connections list")}.`));
    process.exit(1);
  }

  const resp = await apiFetch(`/api/connections/${encodeURIComponent(connection.id)}`, token, { method: "DELETE" });
  const body = await parseEnvelope<{ id: string }>(resp);
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Could not delete the connection"));
    if (body.code === "CONNECTION_IN_USE") {
      console.log(infoMessage(`Remove or repoint its queries first (${chalk.bold("deloc query list <slug>")}).`));
    }
    process.exit(1);
  }
  console.log(`${chalk.green("✓")} Deleted connection ${chalk.bold(connection.name)}`);
}
