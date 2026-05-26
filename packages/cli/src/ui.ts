import chalk from "chalk";
import boxen from "boxen";
import ora from "ora";

export { chalk, ora };

export function successBox(url: string, slug: string, fileCount: number, sizeLabel: string): string {
  const lines = [
    "",
    chalk.bold.green("  Deployed successfully!"),
    "",
    `  ${chalk.dim("URL")}    ${chalk.cyan.bold(url)}`,
    `  ${chalk.dim("App")}    ${slug}`,
    `  ${chalk.dim("Files")}  ${fileCount} files (${sizeLabel})`,
    "",
    chalk.dim("  Share this link — it's live now."),
    "",
  ];

  return boxen(lines.join("\n"), {
    padding: { top: 0, bottom: 0, left: 0, right: 2 },
    borderColor: "cyan",
    borderStyle: "round",
    title: " deloc ",
    titleAlignment: "center",
  });
}

export function errorMessage(msg: string): string {
  return `${chalk.red("✖")} ${msg}`;
}

export function warnMessage(msg: string): string {
  return `${chalk.yellow("⚠")} ${msg}`;
}

export function infoMessage(msg: string): string {
  return `${chalk.blue("ℹ")} ${msg}`;
}
