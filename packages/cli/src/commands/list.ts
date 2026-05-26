import { getToken, apiFetch } from "../config.js";
import { chalk, errorMessage } from "../ui.js";
import { formatBytes } from "@deloc/shared";

interface ListOptions {
  status?: string;
  all?: boolean;
}

interface AppItem {
  name: string;
  slug: string;
  url: string;
  status: string;
  totalSizeBytes: number;
  fileCount: number;
  expiresAt: string | null;
  createdAt: string;
}

interface AppsPage {
  success: boolean;
  data?: {
    apps: AppItem[];
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
  error?: string;
}

function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return chalk.dim("No expiry");
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return chalk.red("Expired");
  if (days <= 3) return chalk.red(`${days}d left`);
  if (days <= 7) return chalk.yellow(`${days}d left`);
  return chalk.dim(`${days}d left`);
}

async function fetchPage(token: string, status: string | undefined, page: number): Promise<AppsPage> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("page", String(page));
  const qs = params.toString();
  const resp = await apiFetch(`/api/apps?${qs}`, token);
  return await resp.json() as AppsPage;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }

  const firstPage = await fetchPage(token, options.status, 1);

  if (!firstPage.success) {
    console.log(errorMessage(firstPage.error ?? "Failed to list apps"));
    process.exit(1);
  }

  const data = firstPage.data;
  if (!data || data.apps.length === 0) {
    console.log(chalk.dim("  No apps yet. Deploy one with ") + chalk.bold("deloc deploy"));
    return;
  }

  let apps = data.apps;

  if (options.all && data.total_pages > 1) {
    const pages = await Promise.all(
      Array.from({ length: data.total_pages - 1 }, (_, i) =>
        fetchPage(token, options.status, i + 2),
      ),
    );
    for (const page of pages) {
      if (page.success && page.data) {
        apps = apps.concat(page.data.apps);
      }
    }
  }

  console.log("");
  console.log(
    chalk.dim("  ") +
    chalk.dim("Name".padEnd(25)) +
    chalk.dim("Status".padEnd(12)) +
    chalk.dim("Size".padEnd(10)) +
    chalk.dim("Expiry".padEnd(12)) +
    chalk.dim("URL"),
  );
  console.log(chalk.dim("  " + "─".repeat(90)));

  for (const app of apps) {
    const statusColor = app.status === "active" ? chalk.green : app.status === "expired" ? chalk.yellow : chalk.red;
    console.log(
      "  " +
      chalk.bold(app.name.slice(0, 24).padEnd(25)) +
      statusColor(app.status.padEnd(12)) +
      chalk.dim(formatBytes(app.totalSizeBytes).padEnd(10)) +
      formatExpiry(app.expiresAt).padEnd(12) +
      chalk.cyan(app.url),
    );
  }

  if (!options.all && data.total > data.per_page) {
    console.log("");
    console.log(chalk.dim(`  Showing ${data.per_page} of ${data.total} apps. Use `) + chalk.bold("--all") + chalk.dim(" to see all."));
  }

  console.log("");
}
