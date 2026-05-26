# @deloc/mcp

MCP server for [Deloc](https://deloc.dev) — deploy static sites from AI coding agents.

Say "deploy this to Deloc" in Claude Code or Cursor and get a live URL back without leaving your editor.

## Tools

| Tool | Description |
|------|-------------|
| `setup_deloc` | Sign in with Google or Microsoft. Shown when not yet authenticated. |
| `deploy` | Build and deploy a static site. Returns a live URL. |
| `list_apps` | List your published apps with URLs and status. |
| `get_app` | Get detailed info about an app (bandwidth, expiry, size). |
| `disable_app` | Take an app offline. |
| `enable_app` | Re-enable a disabled app. |
| `delete_app` | Permanently delete an app and its files. |
| `renew_app` | Extend a free-tier app's expiry by 30 days. |
| `set_password` | Set, change, or remove password protection on an app. |
| `get_account` | Get current user info, tier, and usage limits. |
| `suggest_deploy_options` | Analyze a project and suggest deployment options. |

## Setup

Add this to your editor config — no token needed. The MCP server handles authentication on first use.

**Claude Code** — run this in your terminal:

```bash
claude mcp add deloc --scope user -- npx -y @deloc/mcp@latest
```

**Cursor** — add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "deloc": {
      "command": "npx",
      "args": ["-y", "@deloc/mcp@latest"]
    }
  }
}
```

The first time you say "deploy this to Deloc", the MCP server opens your browser to sign in (or create an account). After that, your token is saved to `~/.deloc/config.json` and all tools are available.

## Usage

In Claude Code:
> "Deploy this dashboard to Deloc so my team can see it"

In Cursor:
> "Publish this to Deloc as 'Q3 Revenue Dashboard'"

The agent will call the `deploy` tool and return a live URL.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DELOC_TOKEN` | API token (optional — for CI/CD or pre-configured setups) | Read from `~/.deloc/config.json` |
| `DELOC_API_URL` | API endpoint | `https://api.deloc.dev` |

## Token resolution order

1. `DELOC_TOKEN` environment variable (set in MCP config)
2. `~/.deloc/config.json` (saved by `setup_deloc` or `deloc login`)
3. Neither — the `setup_deloc` tool is shown for interactive authentication

## License

MIT
