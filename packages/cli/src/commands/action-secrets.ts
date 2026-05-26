import { createInterface } from "node:readline/promises";
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

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

// Prompts for a value without echoing it back. Terminals without TTY support
// fall back to a regular prompt with a warning.
async function readSecretFromTty(prompt: string): Promise<string> {
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
  if (!stdin.isTTY) {
    console.log(chalk.yellow("  Warning: stdin is not a TTY; value will be echoed."));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(prompt);
    rl.close();
    return answer;
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise<string>((resolveValue) => {
    let buf = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolveValue(buf);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

interface SecretRecord {
  secretName: string;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export async function actionSecretsListCommand(slug: string, action: string): Promise<void> {
  const token = await requireAuth();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${action}/secrets`, token);
  const body = await resp.json() as { success: boolean; data?: { secrets: SecretRecord[] }; error?: string };
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Failed to list secrets"));
    process.exit(1);
  }
  const rows = body.data?.secrets ?? [];
  if (rows.length === 0) {
    console.log(chalk.dim(`  No secrets set for ${chalk.bold(action)}.`));
    return;
  }
  console.log("");
  for (const r of rows) {
    console.log(`  ${chalk.bold(r.secretName)} ${chalk.dim(`v${r.keyVersion}, updated ${relativeTime(r.updatedAt)}`)}`);
  }
  console.log("");
}

interface SetOptions {
  value?: string;
}

export async function actionSecretSetCommand(slug: string, action: string, secretName: string, options: SetOptions): Promise<void> {
  const token = await requireAuth();
  const value = options.value ?? await readSecretFromTty(`Value for ${chalk.bold(secretName)}: `);
  if (!value) {
    console.log(errorMessage("Empty value"));
    process.exit(1);
  }
  const spinner = ora(`Setting ${chalk.bold(secretName)}...`).start();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${action}/secrets/${secretName}`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  const body = await resp.json() as { success: boolean; data?: SecretRecord; error?: string; code?: string };
  if (!body.success || !body.data) {
    spinner.fail(body.error ?? "Set failed");
    if (body.code === "ACTIONS_TIER_REQUIRED") {
      console.log(chalk.dim("  Upgrade to Pro ($10/mo) or higher to use Actions."));
    }
    process.exit(1);
  }
  spinner.succeed(`Set ${chalk.bold(body.data.secretName)} (v${body.data.keyVersion})`);
}

export async function actionSecretDeleteCommand(slug: string, action: string, secretName: string): Promise<void> {
  const token = await requireAuth();
  const resp = await apiFetch(`/api/apps/${slug}/actions/${action}/secrets/${secretName}`, token, { method: "DELETE" });
  const body = await resp.json() as { success: boolean; error?: string };
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Delete failed"));
    process.exit(1);
  }
  console.log(chalk.green("✔") + ` Deleted ${chalk.bold(secretName)}`);
}
