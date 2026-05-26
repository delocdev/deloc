# @deloc/cli

CLI for [Deloc](https://deloc.dev) — the fastest way to deploy a static web app and get a shareable URL.

```bash
npx @deloc/cli deploy
```

That's it. The CLI builds your project (if needed), uploads the output, and prints a live URL.

[![npm](https://img.shields.io/npm/v/@deloc/cli)](https://www.npmjs.com/package/@deloc/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)

## Quick start

```bash
# Sign in (opens browser)
npx @deloc/cli login

# Deploy the current project
npx @deloc/cli deploy

# Deploy with a custom name
npx @deloc/cli deploy --name my-dashboard

# Deploy with password protection
npx @deloc/cli deploy --password

# List your apps
npx @deloc/cli list

# Check account info
npx @deloc/cli whoami
```

## Install globally (optional)

If you prefer not to use `npx` every time:

```bash
npm install -g @deloc/cli
deloc deploy
```

## All commands

| Command | Description |
|---------|-------------|
| `deloc login` | Authenticate via browser (Google / Microsoft) |
| `deloc deploy [dir]` | Deploy a project. Auto-detects build output if `dir` not given. |
| `deloc list` | List your apps with URLs and status |
| `deloc status <slug>` | Show app details (size, bandwidth, expiry) |
| `deloc open <slug>` | Open an app in your browser |
| `deloc disable <slug>` | Take an app offline |
| `deloc enable <slug>` | Re-enable a disabled app |
| `deloc delete <slug>` | Permanently delete an app |
| `deloc renew <slug>` | Extend a free-tier app's expiry by 30 days |
| `deloc password <slug>` | Set or remove password protection |
| `deloc whoami` | Show signed-in account info |
| `deloc upgrade` | Open the upgrade page |
| `deloc tokens list` | List your API tokens |
| `deloc tokens create` | Create a new API token (for CI/CD) |
| `deloc tokens revoke` | Revoke an API token |
| `deloc logout` | Sign out and clear stored credentials |

Run any command with `--help` for full options.

## Deploy details

`deloc deploy` automatically:

1. Detects your project type (Vite, Next.js, Astro, Remix, plain HTML, etc.)
2. Runs your build command if there's no existing build output
3. Finds the build output (`dist/`, `build/`, `out/`, `.next/`, etc.)
4. Validates that an `index.html` exists
5. Zips and uploads
6. Returns a live URL (and copies it to your clipboard)

Override any step:

```bash
deloc deploy ./dist           # skip build, use this folder
deloc deploy --name q3-revenue --password
```

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DELOC_TOKEN` | API token (overrides `~/.deloc/config.json`) | unset |
| `DELOC_API_URL` | API endpoint | `https://api.deloc.dev` |
| `DELOC_WEB_URL` | Web dashboard URL (for opening pricing/account pages) | `https://deloc.dev` |

## Free tier

Three live apps, 100MB total storage, 30-day auto-expiry, 1GB bandwidth per app per month. Password protection included. See [deloc.dev/pricing](https://deloc.dev/pricing) for paid tiers.

## Development

This package lives in the [delocdev/deloc](https://github.com/delocdev/deloc) monorepo. See the root [CONTRIBUTING.md](../../CONTRIBUTING.md) for local dev setup.

## Links

- [Deloc website](https://deloc.dev)
- [`@deloc/mcp`](https://www.npmjs.com/package/@deloc/mcp) — MCP server for Claude Code, Cursor, and other AI coding agents
- [Source on GitHub](https://github.com/delocdev/deloc)

## License

MIT
