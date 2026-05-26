import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".deloc");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  token?: string;
  email?: string;
  username?: string;
  orgSlug?: string | null;
  apiUrl?: string;
}

export async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as Config;
  } catch {
    return {};
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
  await chmod(CONFIG_FILE, 0o600);
}

export async function getToken(): Promise<string | null> {
  const config = await loadConfig();
  return config.token ?? null;
}

export function getApiUrl(): string {
  return process.env.DELOC_API_URL ?? "https://api.deloc.dev";
}

export function getWebUrl(): string {
  return process.env.DELOC_WEB_URL ?? "https://deloc.dev";
}

export async function apiFetch(path: string, token: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${getApiUrl()}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    });
  } catch {
    console.error("\x1b[31m✖\x1b[0m Could not connect to Deloc API. Check your internet connection.");
    process.exit(1);
  }
}
