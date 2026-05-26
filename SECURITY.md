# Security policy

## Reporting a vulnerability

If you've found a security issue in `@deloc/cli`, `@deloc/mcp`, or the Deloc hosting service, please report it privately rather than opening a public GitHub issue.

**Email:** `security@deloc.dev`

Please include:

- A description of the issue
- Steps to reproduce
- Affected version(s) (`npx @deloc/cli --version` / `npx @deloc/mcp --version`)
- Any proof-of-concept code or screenshots
- Your name / handle if you'd like credit in the eventual fix announcement

We'll acknowledge receipt within **3 business days** and aim to provide a substantive response within **10 business days**. For confirmed vulnerabilities we'll coordinate a fix and a public disclosure date with you.

## Scope

In scope:

- The `@deloc/cli` and `@deloc/mcp` packages in this repository
- The Deloc hosting service (`*.deloc.dev`, `api.deloc.dev`)
- Anything that could expose user tokens, deployed app contents, or account data

Out of scope:

- Issues that require a compromised user machine (the npm packages are run with the user's full filesystem access by design)
- Vulnerabilities in third-party dependencies — please report those upstream and let us know so we can update
- Reports that depend on social engineering of a Deloc operator

## Supported versions

Security fixes ship as patch releases against the latest minor of each package. Older minors do not receive backports — please upgrade.

| Package | Supported |
|---------|-----------|
| `@deloc/cli@latest` | ✅ |
| `@deloc/mcp@latest` | ✅ |
| Older versions | ❌ — upgrade first |
