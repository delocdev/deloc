#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setToken } from "./api.js";
import { resolveToken, registerSetupTool, registerLogoutTool } from "./auth.js";
import { registerDeployTool } from "./tools/deploy.js";
import { registerAppTools } from "./tools/apps.js";
import { registerAccountTools } from "./tools/account.js";
import { registerDataTools } from "./tools/data.js";
import { registerDataRefreshTool } from "./tools/data-refresh.js";
import { registerSuggestTool } from "./tools/suggest.js";
import { registerActionTools } from "./tools/actions.js";
import { registerActionWriteTools } from "./tools/actions-write.js";
import { registerActionSecretTools } from "./tools/action-secrets.js";
import { registerOauthCredentialTools } from "./tools/oauth-credentials.js";
import { registerConnectionTools } from "./tools/connections.js";
import { registerDashboardQueryTools } from "./tools/dashboard-queries.js";

// Injected at build time via tsup's `define` from this package's package.json.
declare const __PKG_VERSION__: string;

async function main() {
  const server = new McpServer({ name: "deloc", version: __PKG_VERSION__ });

  // Resolve token: env var -> ~/.deloc/config.json -> empty
  const token = await resolveToken();
  setToken(token);
  const isAuthenticated = token.length > 0;

  // Register all tools, then toggle visibility based on auth state
  const normalTools = [
    registerDeployTool(server),
    ...registerAppTools(server),
    ...registerAccountTools(server),
    ...registerDataTools(server),
    registerDataRefreshTool(server),
    registerSuggestTool(server),
    ...registerActionTools(server),
    ...registerActionWriteTools(server),
    ...registerActionSecretTools(server),
    ...registerOauthCredentialTools(server),
    ...registerConnectionTools(server),
    ...registerDashboardQueryTools(server),
  ];

  const onAuthenticated = () => {
    setupTool.disable();
    logoutTool.enable();
    for (const tool of normalTools) tool.enable();
  };

  const onLoggedOut = () => {
    setupTool.enable();
    logoutTool.disable();
    for (const tool of normalTools) tool.disable();
  };

  const setupTool = registerSetupTool(server, onAuthenticated);
  const logoutTool = registerLogoutTool(server, onLoggedOut);

  if (isAuthenticated) {
    setupTool.disable();
  } else {
    logoutTool.disable();
    for (const tool of normalTools) tool.disable();
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Deloc MCP server running on stdio");
}

main().catch(console.error);
