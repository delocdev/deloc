import { apiFetch, getToken } from "../config.js";
import { chalk, ora, errorMessage } from "../ui.js";

async function requireAuth(): Promise<string> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }
  return token;
}

function parseHeaderKV(val: string, prev: Record<string, string>): Record<string, string> {
  const idx = val.indexOf("=");
  if (idx <= 0) {
    console.log(errorMessage(`--header must be key=value (got "${val}")`));
    process.exit(1);
  }
  const key = val.slice(0, idx).trim();
  const value = val.slice(idx + 1);
  return { ...prev, [key]: value };
}

function parseCsv(val: string): string[] {
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseJsonOption(flag: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    console.log(errorMessage(`${flag} is not valid JSON`));
    process.exit(1);
  }
}

interface CreateOptions {
  displayName: string;
  method: string;
  targetUrl: string;
  description?: string;
  header?: Record<string, string>;
  body?: string;
  allowedVariables?: string;
  allowedRoles?: string;
  externalIdVariable?: string;
  rateViewer?: string;
  rateApp?: string;
  timeout?: string;
  maxBytes?: string;
  credential?: string;
  noCredential?: boolean;
}

function buildWriteBody(opts: Partial<CreateOptions> & { name?: string }): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.displayName !== undefined) body.displayName = opts.displayName;
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.method !== undefined) body.method = opts.method.toUpperCase();
  if (opts.targetUrl !== undefined) body.targetUrl = opts.targetUrl;
  if (opts.header !== undefined) body.headerTemplate = opts.header;
  if (opts.body !== undefined) body.bodyTemplate = parseJsonOption("--body", opts.body);
  if (opts.allowedVariables !== undefined) body.allowedVariables = parseCsv(opts.allowedVariables);
  if (opts.allowedRoles !== undefined) body.allowedRoles = parseCsv(opts.allowedRoles);
  if (opts.externalIdVariable !== undefined) body.externalIdVariable = opts.externalIdVariable;
  if (opts.rateViewer !== undefined) body.rateLimitPerViewerPerHour = Number(opts.rateViewer);
  if (opts.rateApp !== undefined) body.rateLimitPerAppPerHour = Number(opts.rateApp);
  if (opts.timeout !== undefined) body.timeoutMs = Number(opts.timeout);
  if (opts.maxBytes !== undefined) body.maxResponseBytes = Number(opts.maxBytes);
  // Credential attach/detach. `--no-credential` detaches (maps to null),
  // `--credential <name>` attaches, absence leaves the current value alone.
  if (opts.noCredential) body.credentialName = null;
  else if (opts.credential !== undefined) body.credentialName = opts.credential;
  return body;
}

export const collectHeader = parseHeaderKV;

export async function actionsCreateCommand(slug: string, name: string, options: CreateOptions): Promise<void> {
  const token = await requireAuth();
  const body = buildWriteBody({ ...options, name });
  const spinner = ora(`Creating action ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/apps/${slug}/actions`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await resp.json() as { success: boolean; data?: { name: string; status: string }; error?: string; code?: string };
  if (!payload.success || !payload.data) {
    spinner.fail(payload.error ?? "Create failed");
    if (payload.code === "ACTIONS_TIER_REQUIRED") {
      console.log(chalk.dim("  Upgrade to Pro ($10/mo) or higher to use Actions."));
    }
    process.exit(1);
  }
  spinner.succeed(`Created ${chalk.bold(payload.data.name)} (${payload.data.status})`);
}

export async function actionsUpdateCommand(slug: string, name: string, options: Partial<CreateOptions>): Promise<void> {
  const token = await requireAuth();
  const body = buildWriteBody(options);
  const spinner = ora(`Updating ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${name}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await resp.json() as { success: boolean; data?: { name: string; status: string }; error?: string };
  if (!payload.success || !payload.data) {
    spinner.fail(payload.error ?? "Update failed");
    process.exit(1);
  }
  spinner.succeed(`Updated ${chalk.bold(payload.data.name)}`);
}

export async function actionsDeleteCommand(slug: string, name: string): Promise<void> {
  const token = await requireAuth();
  const spinner = ora(`Deleting ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${name}`, token, { method: "DELETE" });
  const payload = await resp.json() as { success: boolean; error?: string };
  if (!payload.success) {
    spinner.fail(payload.error ?? "Delete failed");
    process.exit(1);
  }
  spinner.succeed(`Deleted ${chalk.bold(name)}`);
}

export async function actionsEnableCommand(slug: string, name: string): Promise<void> {
  const token = await requireAuth();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${name}/enable`, token, { method: "POST" });
  const payload = await resp.json() as { success: boolean; error?: string };
  if (!payload.success) {
    console.log(errorMessage(payload.error ?? "Enable failed"));
    process.exit(1);
  }
  console.log(chalk.green("✔") + ` Enabled ${chalk.bold(name)}`);
}

export async function actionsDisableCommand(slug: string, name: string): Promise<void> {
  const token = await requireAuth();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${name}/disable`, token, { method: "POST" });
  const payload = await resp.json() as { success: boolean; error?: string };
  if (!payload.success) {
    console.log(errorMessage(payload.error ?? "Disable failed"));
    process.exit(1);
  }
  console.log(chalk.green("✔") + ` Disabled ${chalk.bold(name)}`);
}
