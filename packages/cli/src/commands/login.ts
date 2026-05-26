import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { loadConfig, saveConfig, getApiUrl, getWebUrl } from "../config.js";
import { chalk, ora, errorMessage } from "../ui.js";
import { promptMcpInstall } from "./install-mcp.js";

interface LoginOptions {
  email?: boolean;
  provider?: string;
  org?: string;
}

export async function loginCommand(options: LoginOptions): Promise<void> {
  if (options.email) {
    return emailLogin();
  }
  return browserLogin(options.provider, options.org ?? "");
}

async function emailLogin(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  let email: string;
  try {
    email = await rl.question(chalk.bold("Email: "));
  } finally {
    // Close readline before reading the password so its terminal-mode
    // echo handler stops echoing keystrokes to stdout.
    rl.close();
  }

  const password = await readPassword(chalk.bold("Password: "));

  if (!email || !password) {
    console.log(errorMessage("Email and password are required."));
    return;
  }

  const spinner = ora("Logging in...").start();

  const resp = await fetch(`${getApiUrl()}/api/auth/cli-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const body = await resp.json() as {
    success: boolean;
    data?: { token: string; user: { email: string; username: string; orgSlug?: string | null } };
    error?: string;
  };

  if (!body.success || !body.data?.token) {
    spinner.fail(body.error ?? "Login failed");
    return;
  }

  const config = await loadConfig();
  config.token = body.data.token;
  config.email = body.data.user.email;
  config.username = body.data.user.username;
  config.orgSlug = body.data.user.orgSlug ?? null;
  await saveConfig(config);

  spinner.succeed(`Logged in as ${chalk.bold(body.data.user.email)}`);
  await promptMcpInstall();
}

function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt);
    const input = stdin;
    const wasRaw = input.isRaw;
    if (input.isTTY) {
      input.setRawMode(true);
    }
    let password = "";
    const onData = (chunk: Buffer) => {
      const char = chunk.toString("utf-8");
      if (char === "\n" || char === "\r" || char === "\u0004") {
        if (input.isTTY) input.setRawMode(wasRaw ?? false);
        input.removeListener("data", onData);
        input.pause();
        stdout.write("\n");
        resolve(password);
      } else if (char === "\u007F" || char === "\b") {
        // backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
        }
      } else if (char === "\u0003") {
        // ctrl+c
        process.exit(1);
      } else {
        password += char;
      }
    };
    input.on("data", onData);
  });
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

async function browserLogin(provider: string | undefined, org: string): Promise<void> {
  const port = await findFreePort();
  const { codeVerifier, codeChallenge } = generatePkce();
  const spinner = ora("Waiting for browser authentication...").start();

  const result = await new Promise<{ code: string } | null>((resolve) => {
    const timeout = setTimeout(() => {
      server.close();
      resolve(null);
    }, 120_000);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<html><body style="font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><h1>Logged in!</h1><p>You can close this tab and return to the terminal.</p></div></body></html>`);

        clearTimeout(timeout);
        server.close();
        resolve(code ? { code } : null);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(port, async () => {
      const params = new URLSearchParams({
        cli_port: port.toString(),
        code_challenge: codeChallenge,
      });
      if (org) params.set("org", org);
      const authUrl = provider
        ? `${getApiUrl()}/api/auth/oauth/${provider}?${params}`
        : `${getWebUrl()}/cli-login?${params}`;

      try {
        const { default: open } = await import("open");
        await open(authUrl);
      } catch {
        spinner.stop();
        console.log(`Open this URL in your browser:\n  ${authUrl}`);
      }
    });
  });

  if (!result) {
    spinner.fail("Authentication timed out");
    return;
  }

  spinner.text = "Exchanging auth code...";
  const exchangeResp = await fetch(`${getApiUrl()}/api/auth/cli-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: result.code, code_verifier: codeVerifier }),
  });

  const exchangeBody = await exchangeResp.json() as {
    success: boolean;
    data?: { token: string; user: { email: string; username: string; orgSlug?: string | null } };
    error?: string;
  };

  if (!exchangeBody.success || !exchangeBody.data) {
    spinner.fail("Authentication failed. Please try again.");
    return;
  }

  spinner.succeed("Authenticated");

  const config = await loadConfig();
  config.token = exchangeBody.data.token;
  config.email = exchangeBody.data.user.email;
  config.username = exchangeBody.data.user.username;
  config.orgSlug = exchangeBody.data.user.orgSlug ?? null;
  await saveConfig(config);

  console.log(chalk.green("✔") + ` Logged in as ${chalk.bold(exchangeBody.data.user.email)}`);
  await promptMcpInstall();
}

function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}
