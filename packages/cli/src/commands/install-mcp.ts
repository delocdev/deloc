import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFile, writeFile, access } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { chalk, infoMessage } from "../ui.js";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ToolInfo {
  name: string;
  configPath: string;
  useCliCommand?: boolean;
}

const DELOC_MCP_ENTRY = {
  command: "npx",
  args: ["-y", "@deloc/mcp@latest"],
};

const CLAUDE_CODE_MCP_COMMAND = "claude mcp add deloc --scope user -- npx -y @deloc/mcp@latest";

const AI_TOOLS: ToolInfo[] = [
  { name: "Claude Code", configPath: join(homedir(), ".claude.json"), useCliCommand: true },
  { name: "Cursor", configPath: join(homedir(), ".cursor", "mcp.json") },
  { name: "Windsurf", configPath: join(homedir(), ".windsurf", "mcp_config.json") },
  { name: "Codex", configPath: join(homedir(), ".codex", "mcp.json") },
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<McpConfig> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as McpConfig;
  } catch {
    return {};
  }
}

async function installToTool(tool: ToolInfo): Promise<boolean> {
  if (tool.useCliCommand) {
    execSync(CLAUDE_CODE_MCP_COMMAND, { stdio: "ignore" });
    return true;
  }
  const config = await readJsonFile(tool.configPath);
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers["deloc"] = DELOC_MCP_ENTRY;
  await writeFile(tool.configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return true;
}

function hasDelocMcp(config: McpConfig): boolean {
  return config.mcpServers != null && "deloc" in config.mcpServers;
}

async function confirm(rl: ReturnType<typeof createInterface>, prompt: string): Promise<boolean> {
  const answer = await rl.question(prompt);
  return answer.trim().toLowerCase() !== "n";
}

function isClaudeCodeInstalled(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Detect installed AI tools and offer to add Deloc MCP to each. */
export async function promptMcpInstall(): Promise<void> {
  // Check if any tool already has Deloc configured — skip if so
  for (const tool of AI_TOOLS) {
    if (await fileExists(tool.configPath)) {
      const config = await readJsonFile(tool.configPath);
      if (hasDelocMcp(config)) return; // Already installed somewhere, don't prompt
    }
  }

  // Detect which tools are installed
  const detected: ToolInfo[] = [];
  for (const tool of AI_TOOLS) {
    if (tool.useCliCommand) {
      if (isClaudeCodeInstalled()) detected.push(tool);
    } else if (await fileExists(tool.configPath)) {
      detected.push(tool);
    }
  }

  if (detected.length === 0) return; // No tools found, skip silently

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    console.log("");
    const wantMcp = await confirm(rl, `  Want to add Deloc to your AI tool for conversational deploys? ${chalk.dim("(Y/n)")} `);
    if (!wantMcp) return;

    let installed = 0;
    for (const tool of detected) {
      const config = await readJsonFile(tool.configPath);
      if (hasDelocMcp(config)) {
        console.log(chalk.dim(`  ${tool.name}: already configured`));
        installed++;
        continue;
      }

      const yes = await confirm(rl, `  Found ${chalk.bold(tool.name)}. Add Deloc MCP server? ${chalk.dim("(Y/n)")} `);
      if (yes) {
        await installToTool(tool);
        console.log(chalk.green("  ✔") + ` Added to ${tool.name}`);
        installed++;
      }
    }

    if (installed > 0) {
      console.log("");
      console.log(infoMessage(`Try saying ${chalk.cyan('"deploy this to Deloc"')} in your AI tool.`));
      console.log(chalk.dim("  If it doesn't pick it up, restart the tool first."));
    }
  } finally {
    rl.close();
  }
}

/** Standalone install-mcp command. */
export async function installMcpCommand(): Promise<void> {
  const detected: ToolInfo[] = [];
  for (const tool of AI_TOOLS) {
    if (tool.useCliCommand) {
      if (isClaudeCodeInstalled()) detected.push(tool);
    } else if (await fileExists(tool.configPath)) {
      detected.push(tool);
    }
  }

  if (detected.length === 0) {
    console.log("");
    console.log("  No AI tool configs found. You can manually add the MCP server:");
    console.log("");
    console.log(chalk.dim("  Add this to your editor's MCP config:"));
    console.log("");
    console.log(`  ${chalk.cyan(JSON.stringify({ mcpServers: { deloc: DELOC_MCP_ENTRY } }, null, 2).split("\n").join("\n  "))}`);
    console.log("");
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });

  try {
    let installed = 0;
    for (const tool of detected) {
      const config = await readJsonFile(tool.configPath);
      if (hasDelocMcp(config)) {
        console.log(chalk.dim(`  ${tool.name}: already configured`));
        installed++;
        continue;
      }

      const yes = await confirm(rl, `  Found ${chalk.bold(tool.name)}. Add Deloc MCP server? ${chalk.dim("(Y/n)")} `);
      if (yes) {
        await installToTool(tool);
        console.log(chalk.green("  ✔") + ` Added to ${tool.name}`);
        installed++;
      }
    }

    if (installed > 0) {
      console.log("");
      console.log(infoMessage(`Try saying ${chalk.cyan('"deploy this to Deloc"')} in your AI tool.`));
      console.log(chalk.dim("  If it doesn't pick it up, restart the tool first."));
    }
  } finally {
    rl.close();
  }
}
