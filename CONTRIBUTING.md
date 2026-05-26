# Contributing to Deloc

Thanks for your interest in Deloc! This repo holds the open-source clients (`@deloc/cli`, `@deloc/mcp`, and shared utilities) that talk to the Deloc hosting service.

We welcome bug reports, feature requests, and pull requests — especially around new framework detection in the CLI, new MCP tools, and improvements to the deploy experience.

> **No SLA on issues or PRs.** This is a small project. We aim to respond within a week or two, but life happens.

## Project layout

```
packages/
  cli/      @deloc/cli      CLI entry point and commands
  mcp/      @deloc/mcp      MCP server + tools exposed to AI agents
  shared/   @deloc/shared   shared types, constants, build/upload helpers
                            (workspace-only, bundled into cli/mcp at build time)
```

## Local development

You'll need:

- Node 20 or 22 (the dev toolchain uses vitest 4, which requires Node 20+; published packages still run on Node 18+)
- [pnpm](https://pnpm.io/) 10+

```bash
# Clone and install
git clone https://github.com/delocdev/deloc.git
cd deloc
pnpm install

# Build everything
pnpm -r build

# Run all tests
pnpm -r test

# Typecheck everything
pnpm -r exec tsc --noEmit
```

### Working on the CLI

```bash
# Watch mode — rebuild on save
pnpm --filter @deloc/cli dev

# Run the built CLI
node packages/cli/dist/index.js --help
```

### Working on the MCP server

```bash
# Watch mode
pnpm --filter @deloc/mcp dev

# Test the MCP locally with Claude Code
claude mcp add deloc-local --scope project -- node /absolute/path/to/packages/mcp/dist/index.js
```

### Running against a local Deloc API

If you have access to a local Deloc API (the private hosting service), point the clients at it via env vars:

```bash
export DELOC_API_URL=http://localhost:3001
export DELOC_WEB_URL=http://localhost:5173

node packages/cli/dist/index.js login
```

The clients fall back to production (`api.deloc.dev`) when these are unset.

## Pull requests

1. **Fork and branch.** Open feature branches off `main`.
2. **Keep PRs focused.** One change per PR. Smaller is easier to review.
3. **Tests required for shared utilities.** Anything in `packages/shared/` should have a colocated `*.test.ts` (we use vitest).
4. **Match existing style.** No formatter config yet — please mirror the conventions of nearby code (named exports, no `any`, strict mode).
5. **Commit messages:** imperative mood, under 72 chars on the first line (e.g. `Add Astro build-folder detection to CLI`).
6. **Run before pushing:**
   ```bash
   pnpm -r build && pnpm -r test
   ```

If you're adding a new framework's build detection, please include an integration test or at minimum a sample `package.json` fixture under `packages/shared/src/__fixtures__/`.

## Reporting bugs

Use the issue templates at [github.com/delocdev/deloc/issues](https://github.com/delocdev/deloc/issues). Include:

- Which command / MCP tool you ran
- What you expected vs. what happened
- Your Node version (`node --version`)
- Your OS

If it's a deploy bug, the contents of `~/.deloc/config.json` (with the token redacted) help a lot.

## Security issues

Do **not** open a public issue. See [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the same [MIT License](./LICENSE) that covers the project.
