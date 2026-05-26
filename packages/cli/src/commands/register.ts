import { getApiUrl } from "../config.js";
import { chalk, ora } from "../ui.js";
import { loginCommand } from "./login.js";

export async function registerCommand(): Promise<void> {
  const spinner = ora("Opening registration page...").start();

  try {
    const { default: open } = await import("open");
    const appUrl = process.env.DELOC_APP_URL ?? "https://deloc.dev";
    await open(`${appUrl}/register`);
    spinner.succeed("Registration page opened in browser");
  } catch {
    spinner.fail("Could not open browser");
    const appUrl = process.env.DELOC_APP_URL ?? "https://deloc.dev";
    console.log(`  Visit ${chalk.cyan(`${appUrl}/register`)} to create an account.`);
  }

  console.log("");
  console.log(chalk.dim("  After registering, log in here to connect your CLI:"));
  console.log("");

  await loginCommand({});
}
