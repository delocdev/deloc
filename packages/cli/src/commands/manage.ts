import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { getToken, getApiUrl, loadConfig, apiFetch } from "../config.js";
import { chalk, ora, errorMessage } from "../ui.js";
import { formatBytes, TIER_LIMITS } from "@deloc/shared";

async function requireAuth(): Promise<string> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }
  return token;
}

export async function openCommand(slug: string): Promise<void> {
  const token = await getToken();
  let url: string;

  if (token) {
    try {
      const resp = await fetch(`${getApiUrl()}/api/apps/${slug}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await resp.json() as { success: boolean; data?: { url: string }; error?: string };
      if (body.success && body.data?.url) {
        url = body.data.url;
      } else {
        console.log(errorMessage(body.error ?? "App not found"));
        process.exit(1);
      }
    } catch {
      const config = await loadConfig();
      const subdomain = config.orgSlug ?? config.username ?? "user";
      url = `https://${slug}--${subdomain}.deloc.app`;
    }
  } else {
    const config = await loadConfig();
    const subdomain = config.orgSlug ?? config.username ?? "user";
    url = `https://${subdomain}.deloc.app/${slug}`;
  }

  const { default: open } = await import("open");
  await open(url);
  console.log(chalk.dim(`  Opening ${url}`));
}

export async function disableCommand(slug: string): Promise<void> {
  const token = await requireAuth();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const answer = await rl.question(`Disable ${chalk.bold(slug)}? This will take it offline. (y/N) `);
    if (answer.toLowerCase() !== "y") {
      console.log(chalk.dim("  Cancelled."));
      return;
    }
  } finally {
    rl.close();
  }

  const resp = await apiFetch(`/api/apps/${slug}/disable`, token, { method: "POST" });

  const body = await resp.json() as { success: boolean; error?: string };
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Failed to disable app"));
    process.exit(1);
  }

  console.log(chalk.green("✔") + ` ${chalk.bold(slug)} is now disabled.`);
}

export async function renewCommand(slug: string): Promise<void> {
  const token = await requireAuth();
  const spinner = ora("Renewing...").start();

  const resp = await apiFetch(`/api/apps/${slug}/renew`, token, { method: "POST" });

  const body = await resp.json() as {
    success: boolean;
    data?: { expiresAt: string };
    error?: string;
  };

  if (!body.success) {
    spinner.fail(body.error ?? "Failed to renew app");
    process.exit(1);
  }

  const days = Math.ceil((new Date(body.data!.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  spinner.succeed(`${chalk.bold(slug)} renewed — expires in ${days} days.`);
}

export async function statusCommand(slug: string): Promise<void> {
  const token = await requireAuth();

  // Fetch app detail and user profile in parallel
  const [appResp, meResp] = await Promise.all([
    apiFetch(`/api/apps/${slug}`, token),
    apiFetch(`/api/auth/me`, token),
  ]);

  const appBody = await appResp.json() as {
    success: boolean;
    data?: {
      name: string; slug: string; url: string; status: string; visibility: string;
      totalSizeBytes: number; fileCount: number; bandwidthUsedBytes: number;
      expiresAt: string | null; createdAt: string;
    };
    error?: string;
  };

  if (!appBody.success) {
    console.log(errorMessage(appBody.error ?? "App not found"));
    process.exit(1);
  }

  const meBody = await meResp.json() as {
    success: boolean;
    data?: { tier: string };
  };

  const app = appBody.data!;
  const tier = (meBody.data?.tier ?? "free") as keyof typeof TIER_LIMITS;
  const limits = TIER_LIMITS[tier];
  const statusColor = app.status === "active" ? chalk.green : app.status === "expired" ? chalk.yellow : chalk.red;

  console.log("");
  console.log(`  ${chalk.bold(app.name)}`);
  console.log(chalk.dim("  " + "─".repeat(40)));
  console.log(`  ${chalk.dim("URL")}        ${chalk.cyan(app.url)}`);
  console.log(`  ${chalk.dim("Status")}     ${statusColor(app.status)}`);
  console.log(`  ${chalk.dim("Tier")}       ${chalk.bold(tier.charAt(0).toUpperCase() + tier.slice(1))}${tier === "free" ? chalk.dim(` (${limits.maxApps} apps, ${formatBytes(limits.maxStorageBytes)} storage)`) : ""}`);
  console.log(`  ${chalk.dim("Files")}      ${app.fileCount}`);
  console.log(`  ${chalk.dim("Size")}       ${formatBytes(app.totalSizeBytes)}`);
  console.log(`  ${chalk.dim("Bandwidth")}  ${formatBytes(app.bandwidthUsedBytes)} used`);
  if (app.expiresAt) {
    const days = Math.ceil((new Date(app.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    console.log(`  ${chalk.dim("Expires")}    ${days > 0 ? `in ${days} days` : chalk.red("expired")}`);
  } else {
    console.log(`  ${chalk.dim("Expires")}    ${chalk.green("never")} (paid tier)`);
  }
  console.log(`  ${chalk.dim("Created")}    ${new Date(app.createdAt).toLocaleDateString()}`);
  console.log("");
}

export async function upgradeCommand(plan?: string): Promise<void> {
  const token = await getToken();
  const { default: open } = await import("open");

  if (!token) {
    // Not logged in — just open pricing page
    await open("https://deloc.dev/pricing");
    console.log(chalk.dim("  Opening deloc.dev/pricing"));
    return;
  }

  const validPlans = ["pro", "pro_unlimited", "team"] as const;
  const selectedPlan = validPlans.includes(plan as typeof validPlans[number])
    ? (plan as typeof validPlans[number])
    : "pro";
  const spinner = ora(`Creating ${selectedPlan} checkout...`).start();

  try {
    const resp = await fetch(`${getApiUrl()}/api/billing/create-checkout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: selectedPlan }),
    });

    const body = await resp.json() as { success: boolean; data?: { url: string }; error?: string };

    if (!body.success || !body.data?.url) {
      spinner.fail(body.error ?? "Could not create checkout session");
      console.log(chalk.dim("  Opening pricing page instead..."));
      await open("https://deloc.dev/pricing");
      return;
    }

    spinner.succeed("Opening checkout...");
    await open(body.data.url);
  } catch {
    spinner.fail("Could not connect to API");
    await open("https://deloc.dev/pricing");
  }
}

export async function billingCommand(): Promise<void> {
  const token = await requireAuth();
  const spinner = ora("Opening billing portal...").start();

  try {
    const resp = await fetch(`${getApiUrl()}/api/billing/portal`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = await resp.json() as { success: boolean; data?: { url: string }; error?: string };

    if (!body.success || !body.data?.url) {
      spinner.fail(body.error ?? "No active subscription");
      console.log(chalk.dim("  Run " + chalk.bold("deloc upgrade") + " to subscribe."));
      return;
    }

    spinner.succeed("Opening billing portal...");
    const { default: open } = await import("open");
    await open(body.data.url);
  } catch {
    spinner.fail("Could not connect to API");
  }
}

export async function deleteCommand(slug: string): Promise<void> {
  const token = await requireAuth();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    const answer = await rl.question(
      `Delete ${chalk.bold(slug)}? This is permanent and cannot be undone.\n` +
      `Type the app slug to confirm: `,
    );
    if (answer !== slug) {
      console.log(chalk.dim("  Cancelled. Slug didn't match."));
      return;
    }
  } finally {
    rl.close();
  }

  const spinner = ora("Deleting...").start();

  const resp = await apiFetch(`/api/apps/${slug}`, token, { method: "DELETE" });

  const body = await resp.json() as { success: boolean; error?: string };
  if (!body.success) {
    spinner.fail(body.error ?? "Failed to delete app");
    process.exit(1);
  }

  spinner.succeed(`${chalk.bold(slug)} has been permanently deleted.`);
}

export async function enableCommand(slug: string): Promise<void> {
  const token = await requireAuth();
  const spinner = ora("Enabling...").start();

  const resp = await apiFetch(`/api/apps/${slug}/enable`, token, { method: "POST" });

  const body = await resp.json() as { success: boolean; error?: string };
  if (!body.success) {
    spinner.fail(body.error ?? "Failed to enable app");
    process.exit(1);
  }

  spinner.succeed(`${chalk.bold(slug)} is now active again.`);
}

export async function whoamiCommand(): Promise<void> {
  const token = await requireAuth();
  const config = await loadConfig();

  const resp = await apiFetch(`/api/auth/me`, token);

  const body = await resp.json() as {
    success: boolean;
    data?: {
      email: string;
      username: string;
      name: string;
      tier: string;
      totalStorageUsedBytes: number;
      orgName?: string;
      orgSlug?: string | null;
      limits?: { maxApps: number | null; maxStorageBytes: number | null; deploysPerDay: number | null; appExpiryDays: number | null };
    };
    error?: string;
  };

  if (!body.success) {
    console.log(errorMessage(body.error ?? "Failed to get account info"));
    process.exit(1);
  }

  const me = body.data!;
  const tier = (me.tier ?? "free") as keyof typeof TIER_LIMITS;
  const limits = me.limits ?? TIER_LIMITS[tier];
  const fmt = (v: number | null | undefined) => v == null ? "unlimited" : String(v);
  const fmtBytes = (v: number | null | undefined) => v == null ? "unlimited" : formatBytes(v as number);

  console.log("");
  console.log(`  ${chalk.bold(me.name)}`);
  console.log(chalk.dim("  " + "─".repeat(40)));
  console.log(`  ${chalk.dim("Email")}      ${me.email}`);
  console.log(`  ${chalk.dim("Username")}   ${chalk.cyan(me.username)}`);
  const appSubdomain = me.orgSlug ?? me.username;
  console.log(`  ${chalk.dim("App URLs")}   ${chalk.cyan(`{app}--${appSubdomain}.deloc.app`)}`);
  console.log(`  ${chalk.dim("Tier")}       ${chalk.bold(tier.charAt(0).toUpperCase() + tier.slice(1))}`);
  console.log(`  ${chalk.dim("Storage")}    ${formatBytes(me.totalStorageUsedBytes)} / ${fmtBytes(limits.maxStorageBytes)}`);
  console.log(`  ${chalk.dim("Max apps")}   ${fmt(limits.maxApps)}`);
  if (me.orgName) {
    console.log(`  ${chalk.dim("Org")}        ${me.orgName}`);
  }
  console.log("");
}

export async function passwordCommand(slug: string, options: { remove?: boolean }): Promise<void> {
  const token = await requireAuth();

  if (options.remove) {
    const spinner = ora("Removing password...").start();
    const resp = await apiFetch(`/api/apps/${slug}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
    const body = await resp.json() as { success: boolean; error?: string };
    if (!body.success) {
      spinner.fail(body.error ?? "Failed to update app");
      process.exit(1);
    }
    spinner.succeed(`${chalk.bold(slug)} is now public (password removed).`);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let password: string;
  try {
    password = await rl.question(chalk.bold("New password (leave empty to auto-generate): "));
  } finally {
    rl.close();
  }

  if (!password) {
    const { randomBytes } = await import("node:crypto");
    password = randomBytes(6).toString("base64url").slice(0, 8);
  }

  const spinner = ora("Setting password...").start();
  const resp = await apiFetch(`/api/apps/${slug}`, token, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility: "password_protected", password }),
  });

  const body = await resp.json() as { success: boolean; error?: string };
  if (!body.success) {
    spinner.fail(body.error ?? "Failed to update app");
    process.exit(1);
  }

  spinner.succeed(`${chalk.bold(slug)} is now password protected.`);
  console.log(`  ${chalk.dim("Password:")} ${chalk.cyan(password)}`);
}

export async function logoutCommand(): Promise<void> {
  const { saveConfig } = await import("../config.js");
  await saveConfig({});
  console.log(chalk.green("✔") + " Logged out.");
}
