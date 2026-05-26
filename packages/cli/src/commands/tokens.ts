import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getToken, apiFetch } from "../config.js";
import { chalk, ora, errorMessage } from "../ui.js";

async function requireAuth(): Promise<string> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }
  return token;
}

export async function tokensListCommand(): Promise<void> {
  const token = await requireAuth();

  const resp = await apiFetch("/api/tokens", token);
  const body = await resp.json() as {
    success: boolean;
    data?: Array<{
      id: string;
      name: string;
      lastChars: string;
      lastUsedAt: string | null;
      expiresAt: string;
      createdAt: string;
    }>;
    error?: string;
  };

  if (!body.success) {
    console.log(errorMessage(body.error ?? "Failed to list tokens"));
    process.exit(1);
  }

  const tokens = body.data ?? [];
  if (tokens.length === 0) {
    console.log(chalk.dim("  No API tokens. Create one with ") + chalk.bold("deloc tokens create"));
    return;
  }

  console.log("");
  console.log(
    chalk.dim("  ") +
    chalk.dim("Name".padEnd(25)) +
    chalk.dim("Token".padEnd(14)) +
    chalk.dim("Last used".padEnd(16)) +
    chalk.dim("Expires"),
  );
  console.log(chalk.dim("  " + "─".repeat(70)));

  for (const t of tokens) {
    const lastUsed = t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never";
    const expires = new Date(t.expiresAt).toLocaleDateString();
    console.log(
      "  " +
      chalk.bold(t.name.slice(0, 24).padEnd(25)) +
      chalk.dim(`···${t.lastChars}`.padEnd(14)) +
      chalk.dim(lastUsed.padEnd(16)) +
      chalk.dim(expires),
    );
  }
  console.log("");
}

export async function tokensCreateCommand(name?: string): Promise<void> {
  const token = await requireAuth();

  if (!name) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      name = await rl.question(chalk.bold("Token name (e.g. 'My MacBook'): "));
    } finally {
      rl.close();
    }
  }

  if (!name) {
    // Use quick-create for auto-naming
    const spinner = ora("Creating token...").start();
    const resp = await apiFetch("/api/tokens/quick-create", token, { method: "POST" });
    const body = await resp.json() as {
      success: boolean;
      data?: { name: string; token: string; expiresAt: string };
      error?: string;
    };

    if (!body.success) {
      spinner.fail(body.error ?? "Failed to create token");
      process.exit(1);
    }

    spinner.succeed(`Token created: ${chalk.bold(body.data!.name)}`);
    console.log("");
    console.log(`  ${chalk.dim("Token:")} ${chalk.cyan(body.data!.token)}`);
    console.log(chalk.dim("  Copy this now — it won't be shown again."));
    console.log("");
    return;
  }

  const spinner = ora("Creating token...").start();
  const resp = await apiFetch("/api/tokens/create", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  const body = await resp.json() as {
    success: boolean;
    data?: { name: string; token: string; expiresAt: string };
    error?: string;
  };

  if (!body.success) {
    spinner.fail(body.error ?? "Failed to create token");
    process.exit(1);
  }

  spinner.succeed(`Token created: ${chalk.bold(body.data!.name)}`);
  console.log("");
  console.log(`  ${chalk.dim("Token:")} ${chalk.cyan(body.data!.token)}`);
  console.log(chalk.dim("  Copy this now — it won't be shown again."));
  console.log("");
}

export async function tokensRevokeCommand(id: string): Promise<void> {
  const token = await requireAuth();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const answer = await rl.question(`Revoke token ${chalk.bold(id)}? (y/N) `);
    if (answer.toLowerCase() !== "y") {
      console.log(chalk.dim("  Cancelled."));
      return;
    }
  } finally {
    rl.close();
  }

  const spinner = ora("Revoking token...").start();
  const resp = await apiFetch(`/api/tokens/${id}`, token, { method: "DELETE" });
  const body = await resp.json() as { success: boolean; error?: string };

  if (!body.success) {
    spinner.fail(body.error ?? "Token not found");
    process.exit(1);
  }

  spinner.succeed("Token revoked.");
}
