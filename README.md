# Deloc

Deploy static web apps to a shareable URL in seconds — from your terminal or your AI coding agent.

[![@deloc/cli](https://img.shields.io/npm/v/@deloc/cli?label=%40deloc%2Fcli)](https://www.npmjs.com/package/@deloc/cli)
[![@deloc/mcp](https://img.shields.io/npm/v/@deloc/mcp?label=%40deloc%2Fmcp)](https://www.npmjs.com/package/@deloc/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Deloc](https://deloc.dev) is the fastest way to ship a static web app and share it with your team. This repo contains the open-source clients that talk to the Deloc hosting service:

- **[`@deloc/cli`](./packages/cli)** — `npx @deloc/cli deploy` from any terminal
- **[`@deloc/mcp`](./packages/mcp)** — MCP server so Claude Code, Cursor, and other agents can deploy on your behalf

## Quickstart

### From your terminal

```bash
npx @deloc/cli deploy
```

That's it. The CLI builds your project (if needed), uploads the output, and prints a live URL. First run opens your browser to sign in.

[Full CLI docs →](./packages/cli/README.md)

### From your AI coding agent

**Claude Code:**

```bash
claude mcp add deloc --scope user -- npx -y @deloc/mcp@latest
```

**Cursor** — add to `.cursor/mcp.json`:

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

Then say "deploy this to Deloc" and get a live URL back in your chat.

[Full MCP docs →](./packages/mcp/README.md)

## What you get

- **Works with any static site** — React, Vue, Svelte, plain HTML, or anything with an `index.html`
- **JSX/TSX files deploy directly** — single or multi-file React projects work with no build step
- **Instant URLs** — deploy in seconds, share immediately
- **Password protection** — restrict access with a single parameter
- **OG previews** — set custom images and descriptions for Slack/X link previews
- **Auth at the edge** — Deloc's Cloudflare Worker can lock published apps to a list of allowed email domains. Publishers never write auth code.

## Free tier

Three live apps, 100MB total storage, 30-day auto-expiry, 1GB bandwidth per app per month. Password protection included. No credit card.

Need more? See [deloc.dev/pricing](https://deloc.dev/pricing) for Pro ($10/mo), Pro Unlimited ($25/mo), Team ($35/publisher/mo), and Enterprise.

## How it works

```
your project → @deloc/cli or @deloc/mcp → api.deloc.dev → Cloudflare R2
                                                            ↓
                                                  Cloudflare Worker (edge)
                                                            ↓
                                                    *.deloc.app URL
```

The CLI and MCP are thin clients around a single HTTP API. They zip your build output, upload it, and return a URL. All hosting, CDN, auth, and abuse prevention happens server-side on Deloc's infrastructure.

## Repository layout

```
packages/
  cli/      @deloc/cli      CLI entry point and commands
  mcp/      @deloc/mcp      MCP server + tools exposed to AI agents
  shared/   @deloc/shared   shared types, constants, build/upload helpers
                            (bundled into cli and mcp at build time)
```

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local dev setup, conventions, and how to run against a local API.

Quick start:

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Security

If you find a security issue, please email `security@deloc.dev` rather than opening a public issue. See [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE).
