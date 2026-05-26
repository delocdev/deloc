import { apiFetch } from "../config.js";
import { chalk, ora, errorMessage } from "../ui.js";
import { getToken } from "../config.js";

async function requireAuth(): Promise<string> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }
  return token;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

interface ActionSummary {
  name: string;
  displayName: string;
  method: string;
  status: string;
  invocationsThisMonth: number;
  errorRatePercent: number;
  lastInvokedAt: string | null;
}

export async function actionsListCommand(slug: string): Promise<void> {
  const token = await requireAuth();
  const resp = await apiFetch(`/api/apps/${slug}/actions`, token);
  const body = await resp.json() as {
    success: boolean;
    data?: { actions: ActionSummary[] };
    error?: string;
  };
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Failed to list actions"));
    process.exit(1);
  }
  const rows = body.data?.actions ?? [];
  if (rows.length === 0) {
    console.log(chalk.dim(`  No actions configured for ${chalk.bold(slug)}.`));
    console.log(chalk.dim("  Create one in the dashboard under ") + chalk.bold("Actions") + chalk.dim("."));
    return;
  }

  console.log("");
  console.log(
    chalk.dim("  ") +
    chalk.dim("Name".padEnd(22)) +
    chalk.dim("Method".padEnd(8)) +
    chalk.dim("Status".padEnd(10)) +
    chalk.dim("This month".padEnd(12)) +
    chalk.dim("Error %".padEnd(10)) +
    chalk.dim("Last run"),
  );
  console.log(chalk.dim("  " + "─".repeat(86)));

  for (const a of rows) {
    const statusColor = a.status === "active"
      ? chalk.green
      : a.status === "auto_disabled"
        ? chalk.red
        : chalk.yellow;
    console.log(
      "  " +
      chalk.bold(a.name.slice(0, 21).padEnd(22)) +
      chalk.dim(a.method.padEnd(8)) +
      statusColor(a.status.padEnd(10)) +
      chalk.dim(String(a.invocationsThisMonth).padEnd(12)) +
      (a.errorRatePercent >= 10 ? chalk.red : chalk.dim)(`${a.errorRatePercent}%`.padEnd(10)) +
      chalk.dim(relativeTime(a.lastInvokedAt)),
    );
  }
  console.log("");
}

interface TestOptions {
  body?: string;
}

export async function actionsTestCommand(slug: string, name: string, options: TestOptions): Promise<void> {
  const token = await requireAuth();

  let bodyJson: Record<string, unknown> = {};
  if (options.body) {
    try {
      const parsed = JSON.parse(options.body);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.log(errorMessage("--body must be a JSON object"));
        process.exit(1);
      }
      bodyJson = parsed as Record<string, unknown>;
    } catch {
      console.log(errorMessage("--body is not valid JSON"));
      process.exit(1);
    }
  }

  const spinner = ora(`Testing ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${name}/test`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: bodyJson }),
  });
  const body = await resp.json() as {
    success: boolean;
    data?:
      | { success: true; data: unknown; statusCode: number; latencyMs: number }
      | { success: false; error: string; errorType: string; statusCode: number | null; latencyMs: number };
    error?: string;
  };

  if (!body.success || !body.data) {
    spinner.fail(body.error ?? "Test failed");
    process.exit(1);
  }

  const r = body.data;
  if (r.success) {
    spinner.succeed(`${chalk.green(`OK ${r.statusCode}`)} ${chalk.dim(`(${r.latencyMs}ms)`)}`);
    const preview = typeof r.data === "string"
      ? r.data
      : JSON.stringify(r.data, null, 2);
    console.log(chalk.dim("  " + preview.split("\n").slice(0, 40).join("\n  ")));
  } else {
    spinner.fail(`${chalk.red(r.errorType)}${r.statusCode ? ` ${r.statusCode}` : ""} ${chalk.dim(`(${r.latencyMs}ms)`)}`);
    console.log(chalk.dim("  " + r.error));
    process.exit(1);
  }
}

interface LogsOptions {
  action?: string;
  status?: string;
  externalId?: string;
  limit?: string;
}

interface InvocationLog {
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

export async function actionsLogsCommand(slug: string, options: LogsOptions): Promise<void> {
  const token = await requireAuth();

  if (options.status && !["success", "error", "test"].includes(options.status)) {
    console.log(errorMessage("--status must be one of: success, error, test"));
    process.exit(1);
  }

  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.limit) params.set("limit", options.limit);

  let path: string;
  if (options.externalId) {
    if (options.action) params.set("action", options.action);
    params.set("externalId", options.externalId);
    path = `/api/apps/${slug}/invocations?${params}`;
  } else if (options.action) {
    path = `/api/apps/${slug}/actions/${options.action}/logs?${params}`;
  } else {
    path = `/api/apps/${slug}/invocations?${params}`;
  }

  const resp = await apiFetch(path, token);
  const body = await resp.json() as {
    success: boolean;
    data?: { invocations: InvocationLog[]; nextCursor: string | null };
    error?: string;
  };
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Failed to fetch logs"));
    process.exit(1);
  }
  const rows = body.data?.invocations ?? [];
  if (rows.length === 0) {
    console.log(chalk.dim("  No invocations matched."));
    return;
  }

  console.log("");
  console.log(
    chalk.dim("  ") +
    chalk.dim("When".padEnd(12)) +
    chalk.dim("Action".padEnd(20)) +
    chalk.dim("Status".padEnd(14)) +
    chalk.dim("Latency".padEnd(10)) +
    chalk.dim("Viewer"),
  );
  console.log(chalk.dim("  " + "─".repeat(86)));

  for (const r of rows) {
    const statusCell = r.errorType === "test"
      ? chalk.yellow("test".padEnd(14))
      : r.success
        ? chalk.green(`OK ${r.statusCode ?? ""}`.padEnd(14))
        : chalk.red(`${r.errorType ?? "err"}`.padEnd(14));
    const viewer = (r.viewerEmail ?? "anon").slice(0, 40);
    const suffix = r.externalId ? chalk.dim(` id=${r.externalId}`) : "";
    console.log(
      "  " +
      chalk.dim(relativeTime(r.createdAt).padEnd(12)) +
      chalk.bold(r.actionName.slice(0, 19).padEnd(20)) +
      statusCell +
      chalk.dim(`${r.latencyMs}ms`.padEnd(10)) +
      chalk.dim(viewer) +
      suffix,
    );
    if (!r.success && r.errorMessage) {
      console.log(chalk.dim("    └─ " + r.errorMessage.slice(0, 120)));
    }
  }
  console.log("");
}
