# Deloc MCP Server

Deploy static web apps and get a shareable URL — directly from your AI coding agent.

Say **"deploy this to Deloc"** in Claude Code or Cursor and get a live URL back in seconds, without leaving your editor.

[![npm](https://img.shields.io/npm/v/@deloc/mcp)](https://www.npmjs.com/package/@deloc/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What is Deloc?

[Deloc](https://deloc.dev) is the fastest way to deploy a static web app and get a shareable URL. Built for developers who want to share dashboards, prototypes, and internal tools with teammates — without dealing with hosting configuration.

- **Works with any static site** — React, Vue, Svelte, plain HTML, or anything with an `index.html`
- **JSX/TSX files deploy directly** — single or multi-file React projects work without a build step
- **Instant URLs** — deploy in seconds, share immediately
- **Password protection** — restrict access with a single parameter
- **OG previews** — set custom images and descriptions for link previews on Slack, X, etc.

## Install

No install needed. The MCP server runs via `npx`.

### Claude Code

```bash
claude mcp add deloc --scope user -- npx -y @deloc/mcp@latest
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

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

### Windsurf

Add to your MCP configuration:

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

### Pre-configured token (CI/CD)

If you have an API token from [deloc.dev](https://deloc.dev), pass it as an environment variable:

```json
{
  "mcpServers": {
    "deloc": {
      "command": "npx",
      "args": ["-y", "@deloc/mcp@latest"],
      "env": {
        "DELOC_TOKEN": "dl_xxxxx"
      }
    }
  }
}
```

## Authentication

The first time you deploy, the MCP server opens your browser to sign in with Google or Microsoft (or create an account). Your token is saved to `~/.deloc/config.json` and all tools are available from then on.

You can also paste an existing API token if you registered at [deloc.dev](https://deloc.dev).

## Usage

Just talk to your AI agent naturally:

> "Deploy this to Deloc"

> "Publish this dashboard to Deloc as 'Q3 Revenue'"

> "Deploy this with a password"

> "List my Deloc apps"

> "Disable the old dashboard"

The agent calls the appropriate MCP tool and returns the result.

## Tools

### Deployment

| Tool | Description |
|------|-------------|
| `deploy` | Deploy or update a project. Returns a live URL. Supports directories with `index.html`, single JSX/TSX files, and multi-file JSX/TSX projects. Redeploying to the same name updates in place. |
| `suggest_deploy_options` | Analyze a project directory and suggest deployment options — framework detection, build command, app name, and size estimate. |

### App Management

| Tool | Description |
|------|-------------|
| `list_apps` | List published apps with URLs, status, and expiry info. Filter by status. |
| `get_app` | Get detailed info about an app — file count, size, bandwidth usage, expiry date. |
| `disable_app` | Take an app offline without deleting it. |
| `enable_app` | Re-enable a disabled app. |
| `delete_app` | Permanently delete an app and all its files. |
| `renew_app` | Extend a free-tier app's expiry by 30 days. |

### Settings

| Tool | Description |
|------|-------------|
| `set_password` | Set, change, or remove password protection on an app. Auto-generates a password if none specified. |
| `set_og_image` | Set a custom OG preview image for link previews (Slack, X, etc.). Accepts a local PNG path. |

### Account

| Tool | Description |
|------|-------------|
| `get_account` | Get current user info — email, tier, storage usage, and limits. |
| `setup_deloc` | Sign in with Google or Microsoft, or paste an API token. Shown when not yet authenticated. |
| `logout` | Log out and clear stored credentials. |

## Deploy Tool Details

The `deploy` tool handles three types of projects automatically:

**Directory with `index.html`** — zips and uploads as-is. Use ES module imports with [esm.sh](https://esm.sh) for CDN libraries.

**Single JSX/TSX file** — wraps with React, Babel, and Tailwind CSS automatically. No build step needed.

**Multi-file JSX/TSX project** — resolves local imports between files, bundles into a single HTML file with all dependencies. No build step needed.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | string | App name. Defaults to directory or package.json name. Use the same name to update an existing app. |
| `dir` | string | Path to build output directory. Auto-detected if not specified. |
| `password` | string \| boolean | Password protect the app. Use a string for a specific password, `true` to auto-generate. |
| `public` | boolean | Make app public (removes password protection). |
| `og_image` | string | Path to a PNG for link previews. Max 2MB, 1200x630 recommended. |
| `og_title` | string | Custom title for link previews. |
| `og_description` | string | Custom description for link previews. |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DELOC_TOKEN` | API token for pre-configured setups | Read from `~/.deloc/config.json` |
| `DELOC_API_URL` | API endpoint | `https://api.deloc.dev` |

## Links

- [Deloc Website](https://deloc.dev)
- [npm Package](https://www.npmjs.com/package/@deloc/mcp)
- [CLI Tool](https://www.npmjs.com/package/@deloc/cli)

## License

MIT
