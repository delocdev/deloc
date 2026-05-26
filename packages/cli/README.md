# deloc

The fastest way to deploy static sites. Get a shareable URL in seconds.

## Install

No install needed. Just run:

```bash
npx @deloc/cli deploy
```

## Quick Start

```bash
# Login with Google or Microsoft
npx @deloc/cli login

# Deploy your project
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

## All Commands

- `deloc login` — authenticate via browser
- `deloc deploy [dir]` — deploy a project
- `deloc list` — list your apps
- `deloc status <slug>` — app details
- `deloc open <slug>` — open app in browser
- `deloc disable <slug>` — disable an app
- `deloc enable <slug>` — re-enable an app
- `deloc delete <slug>` — delete an app
- `deloc renew <slug>` — extend free tier expiry
- `deloc password <slug>` — set or remove password
- `deloc whoami` — account info
- `deloc upgrade` — upgrade your plan
- `deloc tokens list|create|revoke` — manage API tokens
- `deloc logout` — sign out

## Links

- Website: https://deloc.dev
- MCP Server: https://www.npmjs.com/package/@deloc/mcp
