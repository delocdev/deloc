import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { apiFetch, getToken } from "../config.js";
import { chalk, ora, errorMessage } from "../ui.js";

type GrantType = "client_credentials" | "password" | "jwt_bearer";

interface CredentialRecord {
  id: string;
  name: string;
  displayName: string;
  grantType: GrantType;
  tokenUrl: string;
  scopes: string | null;
  clientId: string | null;
  username: string | null;
  issuer: string | null;
  subject: string | null;
  audience: string | null;
  keyId: string | null;
  algorithm: string | null;
  cachedExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  const absMin = Math.floor(Math.abs(diffMs) / 60_000);
  if (absMin < 1) return "just now";
  const suffix = diffMs >= 0 ? " ago" : " from now";
  if (absMin < 60) return `${absMin}m${suffix}`;
  const absHr = Math.floor(absMin / 60);
  if (absHr < 24) return `${absHr}h${suffix}`;
  return `${Math.floor(absHr / 24)}d${suffix}`;
}

// Read a secret from TTY without echoing. Shares the pattern with
// action-secrets.ts so the experience is consistent.
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

// --- list / test / delete --------------------------------------------------

export async function credentialsListCommand(): Promise<void> {
  const token = await requireAuth();
  const resp = await apiFetch(`/api/oauth-credentials`, token);
  const body = await resp.json() as {
    success: boolean;
    data?: { credentials: CredentialRecord[] };
    error?: string;
  };
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Failed to list credentials"));
    process.exit(1);
  }
  const rows = body.data?.credentials ?? [];
  if (rows.length === 0) {
    console.log(chalk.dim("  No OAuth credentials configured."));
    console.log(chalk.dim("  Create one: " + chalk.bold("deloc credentials create <name> --grant <type> ...")));
    return;
  }
  console.log("");
  for (const r of rows) {
    const idBits: string[] = [];
    if (r.grantType === "client_credentials" && r.clientId) idBits.push(`client_id=${r.clientId}`);
    if (r.grantType === "password" && r.username) idBits.push(`username=${r.username}`);
    if (r.grantType === "jwt_bearer" && r.issuer) idBits.push(`issuer=${r.issuer}`);
    if (r.scopes) idBits.push(`scopes=${r.scopes}`);
    const cache = r.cachedExpiresAt
      ? `cached until ${relativeTime(r.cachedExpiresAt)}`
      : "no cached token yet";
    console.log(`  ${chalk.bold(r.name)} ${chalk.dim(`(${r.grantType})`)} — ${r.tokenUrl}`);
    if (idBits.length > 0) console.log(chalk.dim(`    ${idBits.join(" · ")}`));
    console.log(chalk.dim(`    ${cache}`));
  }
  console.log("");
}

export async function credentialsTestCommand(name: string): Promise<void> {
  const token = await requireAuth();
  const spinner = ora(`Testing ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/oauth-credentials/${name}/test`, token, { method: "POST" });
  const body = await resp.json() as {
    success: boolean;
    data?: { ok: boolean; cachedExpiresAt: string | null; accessTokenPreview: string };
    error?: string;
    errorType?: string;
  };
  if (!body.success || !body.data) {
    const tag = body.errorType ? ` (${body.errorType})` : "";
    spinner.fail(`${body.error ?? "Test failed"}${tag}`);
    process.exit(1);
  }
  const ttl = body.data.cachedExpiresAt
    ? `${Math.round((new Date(body.data.cachedExpiresAt).getTime() - Date.now()) / 1000)}s`
    : "unknown";
  spinner.succeed(
    `Exchanged credentials (token ${chalk.bold(body.data.accessTokenPreview)}, valid ~${ttl})`,
  );
}

export async function credentialsDeleteCommand(name: string): Promise<void> {
  const token = await requireAuth();
  const spinner = ora(`Deleting ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/oauth-credentials/${name}`, token, { method: "DELETE" });
  const body = await resp.json() as {
    success: boolean;
    data?: {
      name?: string;
      referencingActions?: { id: string; name: string; appId: string }[];
    };
    error?: string;
    code?: string;
  };
  if (body.code === "CREDENTIAL_IN_USE" && body.data?.referencingActions) {
    spinner.fail(`"${name}" is still used by ${body.data.referencingActions.length} action(s)`);
    for (const r of body.data.referencingActions) {
      console.log(chalk.dim(`    - ${r.name} (app ${r.appId.slice(0, 8)}…)`));
    }
    console.log(chalk.dim("  Reassign or delete those actions first."));
    process.exit(1);
  }
  if (!body.success) {
    spinner.fail(body.error ?? "Delete failed");
    process.exit(1);
  }
  spinner.succeed(`Deleted ${chalk.bold(name)}`);
}

// --- create ----------------------------------------------------------------

export interface CreateOptions {
  displayName?: string;
  grant?: string;
  type?: string; // "google-service-account" shortcut
  file?: string; // SA JSON path
  tokenUrl?: string;
  scopes?: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  privateKeyFile?: string;
  issuer?: string;
  subject?: string;
  audience?: string;
  keyId?: string;
  algorithm?: string;
}

async function resolveSaFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    console.log(errorMessage(`Could not read ${path}: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

async function resolvePrivateKey(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    console.log(errorMessage(`Could not read private key at ${path}: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}

/**
 * Build the request body for create/update from CLI options. Prompts
 * interactively for any missing secret value so users can avoid putting
 * them in shell history.
 */
async function buildCredentialBody(
  name: string | undefined,
  opts: CreateOptions,
  mode: "create" | "update",
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (opts.displayName !== undefined) body.displayName = opts.displayName;
  if (opts.scopes !== undefined) body.scopes = opts.scopes;
  if (opts.tokenUrl !== undefined) body.tokenUrl = opts.tokenUrl;

  // Google service-account shortcut — reads the SA JSON file and sends it
  // wholesale. Server parses it into jwt_bearer fields.
  if (opts.type === "google-service-account" || opts.file) {
    if (!opts.file) {
      console.log(errorMessage("--type google-service-account requires --file <path>"));
      process.exit(1);
    }
    body.googleServiceAccountJson = await resolveSaFile(opts.file);
    return body;
  }

  // Explicit grant path
  const grant = opts.grant;
  if (!grant) {
    if (mode === "create") {
      console.log(errorMessage("--grant <client_credentials|password|jwt_bearer> is required (or use --type google-service-account --file)"));
      process.exit(1);
    }
    return body;
  }

  if (!["client_credentials", "password", "jwt_bearer"].includes(grant)) {
    console.log(errorMessage(`unknown --grant "${grant}" (expected client_credentials, password, or jwt_bearer)`));
    process.exit(1);
  }

  if (mode === "create" && !opts.tokenUrl) {
    console.log(errorMessage("--token-url is required"));
    process.exit(1);
  }

  if (grant === "client_credentials") {
    const clientId = opts.clientId ?? await readSecretFromTty("client_id: ");
    const clientSecret = opts.clientSecret ?? await readSecretFromTty("client_secret: ");
    if (!clientId || !clientSecret) {
      console.log(errorMessage("client_id and client_secret are required"));
      process.exit(1);
    }
    body.grant = { grantType: "client_credentials", clientId, clientSecret };
  } else if (grant === "password") {
    const username = opts.username ?? await readSecretFromTty("username: ");
    const password = opts.password ?? await readSecretFromTty("password: ");
    if (!username || !password) {
      console.log(errorMessage("username and password are required"));
      process.exit(1);
    }
    const g: Record<string, unknown> = { grantType: "password", username, password };
    if (opts.clientId) g.clientId = opts.clientId;
    if (opts.clientSecret) g.clientSecret = opts.clientSecret;
    body.grant = g;
  } else {
    // jwt_bearer
    if (!opts.privateKeyFile) {
      console.log(errorMessage("jwt_bearer requires --private-key-file <path>"));
      process.exit(1);
    }
    const privateKeyPem = await resolvePrivateKey(opts.privateKeyFile);
    const issuer = opts.issuer;
    if (!issuer) {
      console.log(errorMessage("jwt_bearer requires --issuer <value>"));
      process.exit(1);
    }
    const g: Record<string, unknown> = {
      grantType: "jwt_bearer",
      privateKeyPem,
      issuer,
    };
    if (opts.algorithm) g.algorithm = opts.algorithm;
    if (opts.subject) g.subject = opts.subject;
    if (opts.audience) g.audience = opts.audience;
    if (opts.keyId) g.keyId = opts.keyId;
    body.grant = g;
  }

  return body;
}

export async function credentialsCreateCommand(name: string, options: CreateOptions): Promise<void> {
  const token = await requireAuth();
  if (!options.displayName) {
    console.log(errorMessage("--display-name <name> is required"));
    process.exit(1);
  }
  const body = await buildCredentialBody(name, options, "create");
  const spinner = ora(`Creating credential ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/oauth-credentials`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await resp.json() as {
    success: boolean;
    data?: CredentialRecord;
    error?: string;
    code?: string;
  };
  if (!payload.success || !payload.data) {
    spinner.fail(payload.error ?? "Create failed");
    if (payload.code === "ACTIONS_TIER_REQUIRED") {
      console.log(chalk.dim("  OAuth credentials require Pro ($10/mo) or a Team/Enterprise org plan."));
    }
    process.exit(1);
  }
  spinner.succeed(`Created ${chalk.bold(payload.data.name)} (${payload.data.grantType})`);
  console.log(chalk.dim(`  Next: ${chalk.bold(`deloc credentials test ${payload.data.name}`)} to verify the exchange.`));
}

export async function credentialsUpdateCommand(name: string, options: CreateOptions): Promise<void> {
  const token = await requireAuth();
  const body = await buildCredentialBody(undefined, options, "update");
  if (Object.keys(body).length === 0) {
    console.log(errorMessage("No fields supplied to update"));
    process.exit(1);
  }
  const rotate = body.grant !== undefined || body.googleServiceAccountJson !== undefined;
  const spinner = ora(`Updating ${chalk.bold(name)}...`).start();
  const resp = await apiFetch(`/api/oauth-credentials/${name}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await resp.json() as {
    success: boolean;
    data?: CredentialRecord;
    error?: string;
  };
  if (!payload.success || !payload.data) {
    spinner.fail(payload.error ?? "Update failed");
    process.exit(1);
  }
  spinner.succeed(
    rotate
      ? `Rotated ${chalk.bold(payload.data.name)} — cached token cleared`
      : `Updated ${chalk.bold(payload.data.name)}`,
  );
}
