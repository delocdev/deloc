import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { API_URL, apiFetch, setToken } from "./api.js";

const CONFIG_DIR = join(homedir(), ".deloc");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  token?: string;
  email?: string;
  username?: string;
  apiUrl?: string;
}

async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, "utf-8")) as Config;
  } catch {
    return {};
  }
}

async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
  await chmod(CONFIG_FILE, 0o600);
}

export async function resolveToken(): Promise<string> {
  // 1. Env var takes priority
  if (process.env.DELOC_TOKEN) return process.env.DELOC_TOKEN;
  // 2. Config file
  const config = await loadConfig();
  if (config.token) return config.token;
  // 3. Unauthenticated
  return "";
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

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

async function clearConfig(): Promise<void> {
  try {
    await writeFile(CONFIG_FILE, "{}\n", "utf-8");
    await chmod(CONFIG_FILE, 0o600);
  } catch {
    // Config file may not exist yet — that's fine
  }
}

export function registerSetupTool(server: McpServer, onAuthenticated: () => void) {
  return server.tool(
    "setup_deloc",
    "Set up Deloc — sign in to start deploying. Ask the user which sign-in method they prefer: Google, Microsoft, or if they already have an API token. If they don't have Google or Microsoft, tell them to register at https://deloc.dev and generate an API token from their dashboard, then call this tool with the token.",
    {
      provider: z.enum(["google", "microsoft"]).optional().describe("OAuth provider — ask the user whether they want to sign in with Google or Microsoft, or paste an existing API token"),
      token: z.string().optional().describe("Existing Deloc API token (dl_...) for users who registered via the website"),
    },
    async (args) => {
      // Token-based auth: user already has an account and token
      if (args.token) {
        setToken(args.token);
        const config = await loadConfig();
        config.token = args.token;
        await saveConfig(config);

        // Verify the token works
        const resp = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${args.token}` },
        });
        if (!resp.ok) {
          return text("Invalid token. Check your token and try again, or sign in with Google or Microsoft instead.");
        }
        const body = await resp.json() as {
          success: boolean;
          data?: { email: string; username: string; orgSlug?: string | null };
        };

        if (!body.success || !body.data) {
          return text("Invalid token. Check your token and try again, or sign in with Google or Microsoft instead.");
        }

        config.email = body.data.email;
        config.username = body.data.username;
        await saveConfig(config);
        onAuthenticated();

        const appSubdomain = body.data.orgSlug ?? body.data.username;
        return text(
          `You're logged in as ${body.data.email}! Your apps will live at {app-name}--${appSubdomain}.deloc.app.\n\n` +
          "I can now deploy projects for you. Try:\n" +
          "- deploy — Build and deploy the current project\n" +
          "- suggest_deploy_options — Analyze the project before deploying\n" +
          "- list_apps — See your published apps",
        );
      }

      if (!args.provider) {
        return text(
          "To set up Deloc, I need to know how you'd like to sign in:\n\n" +
          "1. **Google** — Sign in with your Google account\n" +
          "2. **Microsoft** — Sign in with your Microsoft account\n" +
          "3. **API token** — If you already have a Deloc account, paste your API token (find it at https://deloc.dev/settings)\n\n" +
          "If you don't have any of these, register at https://deloc.dev first.",
        );
      }

      const provider = args.provider;
      const port = await findFreePort();

      // PKCE
      const codeVerifier = randomBytes(64).toString("base64url");
      const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

      // Wait for browser callback
      const result = await new Promise<{ code: string } | null>((resolve) => {
        const timeout = setTimeout(() => {
          callbackServer.close();
          resolve(null);
        }, 120_000);

        const callbackServer = createServer((req, res) => {
          const url = new URL(req.url ?? "/", `http://localhost:${port}`);
          if (url.pathname === "/callback") {
            const code = url.searchParams.get("code");
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`<html><body style="font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh"><div style="text-align:center"><h1>Logged in!</h1><p>You can close this tab and return to your editor.</p></div></body></html>`);
            clearTimeout(timeout);
            callbackServer.close();
            resolve(code ? { code } : null);
          } else {
            res.writeHead(404);
            res.end();
          }
        });

        callbackServer.listen(port, async () => {
          const params = new URLSearchParams({
            cli_port: port.toString(),
            code_challenge: codeChallenge,
          });
          const authUrl = `${API_URL}/api/auth/oauth/${provider}?${params}`;

          try {
            const { default: open } = await import("open");
            await open(authUrl);
          } catch {
            // Browser didn't open — the URL will be in the response if this fails
            console.error(`Open this URL in your browser: ${authUrl}`);
          }
        });
      });

      if (!result) {
        return text("Authentication timed out. Please try again by calling setup_deloc.");
      }

      // Exchange code for token
      const exchangeResp = await fetch(`${API_URL}/api/auth/cli-exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: result.code, code_verifier: codeVerifier }),
      });

      const body = await exchangeResp.json() as {
        success: boolean;
        data?: { token: string; user: { email: string; username: string; orgSlug?: string | null } };
        error?: string;
      };

      if (!body.success || !body.data) {
        return text("Authentication failed. Please try again by calling setup_deloc.");
      }

      // Save token
      const { token, user } = body.data;
      setToken(token);
      const config = await loadConfig();
      config.token = token;
      config.email = user.email;
      config.username = user.username;
      await saveConfig(config);

      // Switch tool visibility
      onAuthenticated();

      const appSubdomain = user.orgSlug ?? user.username;
      return text(
        `You're logged in as ${user.email}! Your apps will live at {app-name}--${appSubdomain}.deloc.app.\n\n` +
        "I can now deploy projects for you. Try:\n" +
        "- deploy — Build and deploy the current project\n" +
        "- suggest_deploy_options — Analyze the project before deploying\n" +
        "- list_apps — See your published apps",
      );
    },
  );
}

export function registerLogoutTool(server: McpServer, onLoggedOut: () => void) {
  return server.tool(
    "logout",
    "Log out of Deloc and clear stored credentials. Use this to switch to a different account.",
    {},
    async () => {
      // Try to revoke the token server-side (best-effort)
      try {
        await apiFetch("/api/auth/revoke", { method: "POST" });
      } catch {
        // Server revocation failed — still clear local credentials
      }

      // Clear local state
      setToken("");
      await clearConfig();

      onLoggedOut();

      return text(
        "You've been logged out of Deloc. Your local credentials have been cleared.\n\n" +
        "To sign in with a different account, use setup_deloc.",
      );
    },
  );
}
