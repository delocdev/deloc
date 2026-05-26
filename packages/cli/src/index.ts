#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { registerCommand } from "./commands/register.js";
import { deployCommand } from "./commands/deploy.js";
import { listCommand } from "./commands/list.js";
import {
  openCommand,
  disableCommand,
  enableCommand,
  deleteCommand,
  renewCommand,
  statusCommand,
  upgradeCommand,
  billingCommand,
  whoamiCommand,
  passwordCommand,
  logoutCommand,
} from "./commands/manage.js";
import { tokensListCommand, tokensCreateCommand, tokensRevokeCommand } from "./commands/tokens.js";
import { installMcpCommand } from "./commands/install-mcp.js";
import { ogCommand } from "./commands/og.js";
import { uploadDataCommand } from "./commands/upload-data.js";
import { actionsListCommand, actionsTestCommand, actionsLogsCommand } from "./commands/actions.js";
import {
  actionsCreateCommand,
  actionsUpdateCommand,
  actionsDeleteCommand,
  actionsEnableCommand,
  actionsDisableCommand,
  collectHeader,
} from "./commands/actions-write.js";
import {
  actionSecretsListCommand,
  actionSecretSetCommand,
  actionSecretDeleteCommand,
} from "./commands/action-secrets.js";
import {
  credentialsListCommand,
  credentialsCreateCommand,
  credentialsUpdateCommand,
  credentialsDeleteCommand,
  credentialsTestCommand,
} from "./commands/credentials.js";

const program = new Command();

program
  .name("deloc")
  .description("Deploy static web apps and get a shareable URL in seconds")
  .version("0.1.0");

program
  .command("deploy [dir]")
  .description("Build and deploy the current project")
  .option("--name <name>", "Set the app name")
  .option("--dir <dir>", "Specify build output directory")
  .option("--no-build", "Skip the build step")
  .option("--password [password]", "Password protect the app (auto-generates if no value given)")
  .option("--public", "Make app public (removes password on re-deploy)")
  .option("--domain-restrict <domains>", "Restrict viewers to comma-separated email domains (e.g. company.com,partner.com). Pro Unlimited, Team, or Enterprise only.")
  .action(deployCommand);

program
  .command("login")
  .description("Log in to Deloc (opens browser picker by default)")
  .option("--email", "Use email/password login instead of browser")
  .option("--provider <provider>", "OAuth provider shortcut: microsoft or google (skips the picker)")
  .option("--org <org>", "Organization slug for domain restriction")
  .action(loginCommand);

program
  .command("register")
  .description("Create a Deloc account")
  .action(registerCommand);

program
  .command("list")
  .description("List your published apps")
  .option("--status <status>", "Filter by status: active, disabled, expired, all")
  .option("--all", "Fetch all pages (default shows first 25)")
  .action(listCommand);

program
  .command("open <slug>")
  .description("Open an app in the browser")
  .action(openCommand);

program
  .command("disable <slug>")
  .description("Disable a published app")
  .action(disableCommand);

program
  .command("enable <slug>")
  .description("Re-enable a disabled app")
  .action(enableCommand);

program
  .command("delete <slug>")
  .description("Permanently delete an app")
  .action(deleteCommand);

program
  .command("renew <slug>")
  .description("Extend app expiry by 30 days (free tier)")
  .action(renewCommand);

program
  .command("whoami")
  .description("Show current user, tier, and usage")
  .action(whoamiCommand);

program
  .command("password <slug>")
  .description("Set or change the password on an app")
  .option("--remove", "Remove password protection (make public)")
  .action(passwordCommand);

program
  .command("status <slug>")
  .description("Show detailed app info")
  .action(statusCommand);

program
  .command("upgrade [plan]")
  .description("Upgrade your plan (pro $10/mo, pro_unlimited $25/mo, team $35/mo)")
  .action(upgradeCommand);

program
  .command("billing")
  .description("Manage your subscription")
  .action(billingCommand);

program
  .command("logout")
  .description("Clear stored credentials")
  .action(logoutCommand);

program
  .command("og <slug> <image>")
  .description("Set a custom OG image for link previews (PNG, max 2MB)")
  .action(ogCommand);

program
  .command("upload-data <slug> <files...>")
  .description("Upload or refresh data files (CSV, JSON, TSV, XML, TXT) in a deployed app without redeploying")
  .option("--filename <name>", "Override filename (single file only)")
  .action(uploadDataCommand);

program
  .command("install-mcp")
  .description("Add Deloc MCP server to your AI tool (Claude Code, Cursor, etc.)")
  .action(installMcpCommand);

const tokens = program
  .command("tokens")
  .description("Manage API tokens");

tokens
  .command("list")
  .description("List your API tokens")
  .action(tokensListCommand);

tokens
  .command("create [name]")
  .description("Create a new API token")
  .action(tokensCreateCommand);

tokens
  .command("revoke <id>")
  .description("Revoke an API token")
  .action(tokensRevokeCommand);

const actions = program
  .command("actions")
  .description("Manage server-side Actions configured on an app");

actions
  .command("list <slug>")
  .description("List actions configured for an app")
  .action(actionsListCommand);

actions
  .command("test <slug> <name>")
  .description("Run a single test invocation against an action")
  .option("--body <json>", "JSON body to send (e.g. '{\"amount\":10}')")
  .action(actionsTestCommand);

actions
  .command("logs <slug>")
  .description("Fetch invocation history for an app's actions")
  .option("--action <name>", "Filter to a single action")
  .option("--status <status>", "Filter: success, error, or test")
  .option("--external-id <id>", "Filter by externalId")
  .option("--limit <n>", "Max rows (default 50, max 200)")
  .action(actionsLogsCommand);

actions
  .command("create <slug> <name>")
  .description("Create a new Action on an app")
  .requiredOption("--display-name <name>", "Human-readable label shown in the dashboard")
  .requiredOption("--method <method>", "HTTP method: GET, POST, PUT, PATCH, DELETE")
  .requiredOption("--target-url <url>", "Full https:// URL. Templates: {var} for lowercase runtime variables, ${SECRET_NAME} for uppercase-named secrets, {{viewer.email}} for trusted context. e.g. https://api.example.com/v1/placement/{placement_id}")
  .option("--description <text>", "Optional note explaining what the action does")
  .option("--header <kv>", 'Outbound header "key=value" (repeatable). Value templates: {var}, ${SECRET_NAME}, {{viewer.email}}. e.g. Authorization=Bearer ${API_KEY}', collectHeader, {})
  .option("--body <json>", "JSON body template. Use {var} for runtime variables (lowercase), ${SECRET_NAME} for secrets (uppercase), {{viewer.email}} for trusted context. NOT ${var} — that is secret syntax and requires uppercase names.")
  .option("--allowed-variables <csv>", "Comma-separated lowercase variable names the browser may pass")
  .option("--allowed-roles <csv>", "Comma-separated roles: publisher,admin,viewer (default publisher,admin)")
  .option("--external-id-variable <name>", "Variable whose value is recorded for audit/dedupe")
  .option("--rate-viewer <n>", "Max invocations per viewer per hour (default 60)")
  .option("--rate-app <n>", "Max invocations app-wide per hour (default 1000)")
  .option("--timeout <ms>", "Upstream request timeout in ms (default 30000)")
  .option("--max-bytes <n>", "Max upstream response size in bytes (default 1048576)")
  .option("--credential <name>", "OAuth credential to attach (see `deloc credentials list`). Injects fresh access token as ${OAUTH_ACCESS_TOKEN}.")
  .action(actionsCreateCommand);

actions
  .command("update <slug> <name>")
  .description("Update an existing Action (all fields optional)")
  .option("--display-name <name>")
  .option("--method <method>")
  .option("--target-url <url>")
  .option("--description <text>")
  .option("--header <kv>", "Replace header template with these key=value pairs (repeatable)", collectHeader, {})
  .option("--body <json>")
  .option("--allowed-variables <csv>")
  .option("--allowed-roles <csv>")
  .option("--external-id-variable <name>")
  .option("--rate-viewer <n>")
  .option("--rate-app <n>")
  .option("--timeout <ms>")
  .option("--max-bytes <n>")
  .option("--credential <name>", "Attach OAuth credential by name")
  .option("--no-credential", "Detach the currently attached OAuth credential")
  .action(actionsUpdateCommand);

actions
  .command("delete <slug> <name>")
  .description("Permanently delete an Action")
  .action(actionsDeleteCommand);

actions
  .command("enable <slug> <name>")
  .description("Re-enable a disabled Action")
  .action(actionsEnableCommand);

actions
  .command("disable <slug> <name>")
  .description("Disable an Action so invocations are rejected")
  .action(actionsDisableCommand);

const actionSecrets = actions
  .command("secret")
  .description("Manage Action secrets (encrypted at rest, never returned)");

actionSecrets
  .command("list <slug> <action>")
  .description("List secret names configured on an Action")
  .action(actionSecretsListCommand);

actionSecrets
  .command("set <slug> <action> <name>")
  .description("Set or rotate a secret. Prompts for the value if --value is omitted.")
  .option("--value <value>", "Secret value (omit to prompt with hidden input)")
  .action(actionSecretSetCommand);

actionSecrets
  .command("delete <slug> <action> <name>")
  .description("Delete a secret from an Action")
  .action(actionSecretDeleteCommand);

const credentials = program
  .command("credentials")
  .description("Manage OAuth credentials (used by Actions via ${OAUTH_ACCESS_TOKEN})");

credentials
  .command("list")
  .description("List OAuth credentials you can see in your current scope")
  .action(credentialsListCommand);

credentials
  .command("create <name>")
  .description("Create an OAuth credential. Supports client_credentials, password, and jwt_bearer grants.")
  .requiredOption("--display-name <name>", "Human-readable label")
  .option("--grant <type>", "OAuth grant type: client_credentials, password, or jwt_bearer")
  .option("--token-url <url>", "https:// token endpoint")
  .option("--scopes <scopes>", "Space-separated OAuth scopes")
  .option("--client-id <id>", "OAuth client_id (for client_credentials / password)")
  .option("--client-secret <val>", "OAuth client_secret (prompts with hidden input if omitted)")
  .option("--username <user>", "ROPC username (for password grant)")
  .option("--password <pw>", "ROPC password (prompts if omitted)")
  .option("--private-key-file <path>", "Path to PEM private key file (for jwt_bearer)")
  .option("--issuer <iss>", "JWT issuer (client_email for Google SAs)")
  .option("--subject <sub>", "JWT subject (defaults to issuer)")
  .option("--audience <aud>", "JWT audience (defaults to token_url)")
  .option("--key-id <kid>", "JWT key id header (private_key_id for Google SAs)")
  .option("--algorithm <alg>", "JWT algorithm: RS256 (default) or ES256")
  .option("--type <type>", "Shortcut: google-service-account (use with --file)")
  .option("--file <path>", "Path to a Google service-account JSON file (for --type google-service-account)")
  .action(credentialsCreateCommand);

credentials
  .command("update <name>")
  .description("Update an OAuth credential. Rotate secrets by re-passing grant-specific fields.")
  .option("--display-name <name>")
  .option("--token-url <url>")
  .option("--scopes <scopes>")
  .option("--grant <type>", "Must match the existing grant type (cannot be changed)")
  .option("--client-id <id>")
  .option("--client-secret <val>")
  .option("--username <user>")
  .option("--password <pw>")
  .option("--private-key-file <path>")
  .option("--issuer <iss>")
  .option("--subject <sub>")
  .option("--audience <aud>")
  .option("--key-id <kid>")
  .option("--algorithm <alg>")
  .option("--type <type>", "Shortcut: google-service-account (rotate via --file)")
  .option("--file <path>", "Path to new Google service-account JSON file")
  .action(credentialsUpdateCommand);

credentials
  .command("delete <name>")
  .description("Delete an OAuth credential (blocked if any action still references it)")
  .action(credentialsDeleteCommand);

credentials
  .command("test <name>")
  .description("Exchange credentials for a fresh access token against the upstream (bypasses cache)")
  .action(credentialsTestCommand);

program.parse();
