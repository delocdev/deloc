import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { requireToken, apiFetch } from "../api.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

type GrantType = "client_credentials" | "password" | "jwt_bearer";

interface CredentialRecord {
  id: string;
  name: string;
  displayName: string;
  grantType: GrantType;
  tokenUrl: string;
  scopes: string | null;
  clientId: string | null;
  username: string | null;
  issuer: string | null;
  subject: string | null;
  audience: string | null;
  keyId: string | null;
  algorithm: string | null;
  cachedExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function shortDate(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function summarize(c: CredentialRecord): string {
  const bits: string[] = [`${c.grantType}`, c.tokenUrl];
  if (c.grantType === "client_credentials" && c.clientId) bits.push(`client_id=${c.clientId}`);
  if (c.grantType === "password" && c.username) bits.push(`username=${c.username}`);
  if (c.grantType === "jwt_bearer" && c.issuer) bits.push(`issuer=${c.issuer}`);
  if (c.scopes) bits.push(`scopes=${c.scopes}`);
  const cache = c.cachedExpiresAt
    ? `cached until ${shortDate(c.cachedExpiresAt)}`
    : "no cached token yet";
  return `• ${c.name} (${c.displayName}) — ${bits.join(" ")} — ${cache}`;
}

export function registerOauthCredentialTools(server: McpServer) {
  const listCredentials = server.tool(
    "list_oauth_credentials",
    "List OAuth credentials the authenticated user can see. Org users see the team-shared credentials for their org; solo users see their personal credentials. Secret values (client_secret, password, private key) are NEVER returned.",
    {},
    async () => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/oauth-credentials`);
      const body = await resp.json() as {
        success: boolean;
        data?: { credentials: CredentialRecord[] };
        error?: string;
      };
      if (!body.success) return text(`Error: ${body.error}`);
      const rows = body.data?.credentials ?? [];
      if (rows.length === 0) {
        return text(
          "No OAuth credentials configured. Create one with create_oauth_credential. Common setups:\n" +
            "• FreeWheel → grant_type='password', token_url='https://api.freewheel.tv/auth/token'\n" +
            "• Auth0/Okta M2M → grant_type='client_credentials'\n" +
            "• Google Cloud / Workspace → grant_type='jwt_bearer' (or use google_service_account_json)",
        );
      }
      return text(rows.map(summarize).join("\n"));
    },
  );

  const createSchema = {
    name: z
      .string()
      .describe("Internal credential name (lowercase letters/digits/underscores, starts with a letter, max 64). Referenced from actions via credential_name."),
    display_name: z.string().describe("Human label shown in the dashboard (e.g. 'FreeWheel prod')."),
    grant_type: z
      .enum(["client_credentials", "password", "jwt_bearer"])
      .optional()
      .describe("OAuth grant type. Omit ONLY if passing google_service_account_json (which forces jwt_bearer)."),
    token_url: z
      .string()
      .optional()
      .describe("https:// token endpoint (e.g. https://api.freewheel.tv/auth/token). Required unless google_service_account_json provides token_uri."),
    scopes: z
      .string()
      .optional()
      .describe("Space-separated OAuth scopes. Omit if the upstream doesn't use scopes (e.g. FreeWheel)."),
    // client_credentials / password fields
    client_id: z.string().optional().describe("OAuth client_id. Required for grant_type='client_credentials'; optional for 'password'."),
    client_secret: z.string().optional().describe("OAuth client_secret. Stored encrypted. Do NOT echo back to the user."),
    username: z.string().optional().describe("ROPC username. Required for grant_type='password' (e.g. FreeWheel login)."),
    password: z.string().optional().describe("ROPC password. Stored encrypted. Do NOT echo back."),
    // jwt_bearer fields
    private_key_pem: z.string().optional().describe("PEM-encoded private key for jwt_bearer. Stored encrypted."),
    issuer: z.string().optional().describe("JWT issuer (`iss`). For Google SAs: the client_email. Required for jwt_bearer."),
    subject: z.string().optional().describe("Optional JWT `sub` claim. Defaults to issuer. Only set for Google domain-wide delegation."),
    audience: z.string().optional().describe("Optional JWT `aud`. Defaults to token_url."),
    key_id: z.string().optional().describe("Optional JWT `kid` header. For Google SAs: the private_key_id."),
    algorithm: z.enum(["RS256", "ES256"]).optional().describe("JWT signing algorithm. Defaults to RS256 (Google SAs)."),
    // Convenience — one-shot Google SA ingestion
    google_service_account_json: z
      .string()
      .optional()
      .describe(
        "Paste the full Google service account JSON (or the file contents). Auto-maps private_key→PEM, client_email→issuer, private_key_id→keyId, token_uri→token_url. When present, forces grant_type='jwt_bearer' and skips the individual fields above.",
      ),
    google_service_account_file: z
      .string()
      .optional()
      .describe("Alternative to google_service_account_json — a local path to the SA JSON file. The MCP server reads it and sends the contents."),
  };

  async function buildCreatePayload(args: Record<string, unknown>): Promise<{ body: Record<string, unknown> } | { error: string }> {
    const body: Record<string, unknown> = {
      name: args.name,
      displayName: args.display_name,
    };
    if (args.scopes !== undefined) body.scopes = args.scopes;

    // SA file path → read from disk
    let saJson: string | undefined = args.google_service_account_json as string | undefined;
    if (!saJson && args.google_service_account_file) {
      try {
        saJson = await readFile(args.google_service_account_file as string, "utf8");
      } catch (err) {
        return { error: `Could not read google_service_account_file: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    if (saJson) {
      body.googleServiceAccountJson = saJson;
      if (args.token_url !== undefined) body.tokenUrl = args.token_url;
    } else {
      if (!args.grant_type) return { error: "grant_type is required (unless google_service_account_json is supplied)" };
      if (!args.token_url) return { error: "token_url is required" };
      body.tokenUrl = args.token_url;
      const gt = args.grant_type as GrantType;
      if (gt === "client_credentials") {
        if (!args.client_id || !args.client_secret) {
          return { error: "client_credentials requires client_id and client_secret" };
        }
        body.grant = {
          grantType: "client_credentials",
          clientId: args.client_id,
          clientSecret: args.client_secret,
        };
      } else if (gt === "password") {
        if (!args.username || !args.password) {
          return { error: "password grant requires username and password" };
        }
        const grant: Record<string, unknown> = {
          grantType: "password",
          username: args.username,
          password: args.password,
        };
        if (args.client_id) grant.clientId = args.client_id;
        if (args.client_secret) grant.clientSecret = args.client_secret;
        body.grant = grant;
      } else {
        if (!args.private_key_pem || !args.issuer) {
          return { error: "jwt_bearer requires private_key_pem and issuer (or use google_service_account_json)" };
        }
        const grant: Record<string, unknown> = {
          grantType: "jwt_bearer",
          privateKeyPem: args.private_key_pem,
          issuer: args.issuer,
        };
        if (args.algorithm) grant.algorithm = args.algorithm;
        if (args.subject) grant.subject = args.subject;
        if (args.audience) grant.audience = args.audience;
        if (args.key_id) grant.keyId = args.key_id;
        body.grant = grant;
      }
    }

    return { body };
  }

  const createCredential = server.tool(
    "create_oauth_credential",
    "Create an OAuth credential that actions can reference by name to get a fresh access token at invoke time (injected as ${OAUTH_ACCESS_TOKEN}). Walk the user through: (1) which upstream API, (2) which grant type fits (client_credentials for M2M like Auth0/Okta; password for FreeWheel/legacy; jwt_bearer for Google Cloud). For Google, prefer google_service_account_json — ask them to paste the whole JSON. Do NOT echo client_secret, password, or private keys back to the user after they're sent. After creation, call test_oauth_credential to prove the token exchange works.",
    createSchema,
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const built = await buildCreatePayload(args as Record<string, unknown>);
      if ("error" in built) return text(`Error: ${built.error}`);
      const resp = await apiFetch(`/api/oauth-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      });
      const body = await resp.json() as {
        success: boolean;
        data?: CredentialRecord;
        error?: string;
        code?: string;
      };
      if (!body.success || !body.data) {
        const hint = body.code === "ACTIONS_TIER_REQUIRED"
          ? " OAuth credentials require Pro ($10/mo) or a Team/Enterprise org plan."
          : "";
        return text(`Error: ${body.error ?? "Create failed"}${hint}`);
      }
      const lines = [
        `Created OAuth credential "${body.data.name}" (${body.data.grantType}).`,
        `Token URL: ${body.data.tokenUrl}`,
        `Next: call test_oauth_credential with name="${body.data.name}" to verify the exchange works.`,
        `Then reference it from an action via credential_name="${body.data.name}" and use \${OAUTH_ACCESS_TOKEN} in your header_template (Authorization: Bearer \${OAUTH_ACCESS_TOKEN}).`,
      ];
      return text(lines.join("\n"));
    },
  );

  const updateSchema = {
    name: z.string().describe("Existing credential name to update"),
    display_name: z.string().optional().describe("New human label"),
    token_url: z.string().optional().describe("New https:// token endpoint. Rotating the URL clears the cached token."),
    scopes: z.string().nullable().optional().describe("New space-separated scopes, or null to clear."),
    // rotation fields — same as create
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    private_key_pem: z.string().optional(),
    issuer: z.string().optional(),
    subject: z.string().optional(),
    audience: z.string().optional(),
    key_id: z.string().optional(),
    algorithm: z.enum(["RS256", "ES256"]).optional(),
    google_service_account_json: z.string().optional().describe("Paste new Google SA JSON to rotate the signing key. Forces jwt_bearer."),
    google_service_account_file: z.string().optional().describe("Alternative — local path to SA JSON file."),
    grant_type: z
      .enum(["client_credentials", "password", "jwt_bearer"])
      .optional()
      .describe("Must match the credential's existing grant_type. Grant type itself cannot be changed — delete and recreate if you need to switch."),
  };

  const updateCredential = server.tool(
    "update_oauth_credential",
    "Update an OAuth credential. Rotate the secret (client_secret/password/private key) by passing a new grant + secret field; this clears the cached token so the next invoke re-fetches. Leave grant fields out to edit only display_name/token_url/scopes. Grant type cannot be changed — delete and recreate to switch.",
    updateSchema,
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const body: Record<string, unknown> = {};
      if (args.display_name !== undefined) body.displayName = args.display_name;
      if (args.token_url !== undefined) body.tokenUrl = args.token_url;
      if (args.scopes !== undefined) body.scopes = args.scopes;

      let saJson: string | undefined = args.google_service_account_json;
      if (!saJson && args.google_service_account_file) {
        try {
          saJson = await readFile(args.google_service_account_file, "utf8");
        } catch (err) {
          return text(`Error: Could not read google_service_account_file: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (saJson) {
        body.googleServiceAccountJson = saJson;
      } else if (args.grant_type) {
        const gt = args.grant_type;
        if (gt === "client_credentials") {
          if (!args.client_id || !args.client_secret) {
            return text("Error: rotating client_credentials requires client_id and client_secret");
          }
          body.grant = {
            grantType: "client_credentials",
            clientId: args.client_id,
            clientSecret: args.client_secret,
          };
        } else if (gt === "password") {
          if (!args.username || !args.password) {
            return text("Error: rotating password grant requires username and password");
          }
          const grant: Record<string, unknown> = {
            grantType: "password",
            username: args.username,
            password: args.password,
          };
          if (args.client_id) grant.clientId = args.client_id;
          if (args.client_secret) grant.clientSecret = args.client_secret;
          body.grant = grant;
        } else {
          if (!args.private_key_pem || !args.issuer) {
            return text("Error: rotating jwt_bearer requires private_key_pem and issuer (or use google_service_account_json)");
          }
          const grant: Record<string, unknown> = {
            grantType: "jwt_bearer",
            privateKeyPem: args.private_key_pem,
            issuer: args.issuer,
          };
          if (args.algorithm) grant.algorithm = args.algorithm;
          if (args.subject) grant.subject = args.subject;
          if (args.audience) grant.audience = args.audience;
          if (args.key_id) grant.keyId = args.key_id;
          body.grant = grant;
        }
      }

      if (Object.keys(body).length === 0) {
        return text("Error: no fields supplied to update.");
      }

      const resp = await apiFetch(`/api/oauth-credentials/${args.name}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await resp.json() as {
        success: boolean;
        data?: CredentialRecord;
        error?: string;
      };
      if (!json.success || !json.data) return text(`Error: ${json.error ?? "Update failed"}`);
      const rotated = body.grant !== undefined || body.googleServiceAccountJson !== undefined;
      return text(
        rotated
          ? `Rotated credential "${json.data.name}". Cached token cleared — the next action invoke will fetch fresh.`
          : `Updated credential "${json.data.name}".`,
      );
    },
  );

  const deleteCredential = server.tool(
    "delete_oauth_credential",
    "Permanently delete an OAuth credential. Fails with a list of referencing actions if any still use it — reassign or remove those actions first.",
    {
      name: z.string().describe("Credential name to delete"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/oauth-credentials/${args.name}`, { method: "DELETE" });
      const json = await resp.json() as {
        success: boolean;
        data?: {
          name?: string;
          referencingActions?: { id: string; name: string; appId: string }[];
        };
        error?: string;
        code?: string;
      };
      if (json.code === "CREDENTIAL_IN_USE" && json.data?.referencingActions) {
        const refs = json.data.referencingActions
          .map((r) => `  - ${r.name} (app ${r.appId.slice(0, 8)}…)`)
          .join("\n");
        return text(
          `Cannot delete "${args.name}" — still used by ${json.data.referencingActions.length} action(s):\n${refs}\n\nReassign or delete those actions first.`,
        );
      }
      if (!json.success) return text(`Error: ${json.error ?? "Delete failed"}`);
      return text(`Deleted credential "${args.name}".`);
    },
  );

  const testCredential = server.tool(
    "test_oauth_credential",
    "Exchange credentials for a fresh access token against the upstream. Bypasses the server-side cache so you always see the live behavior — useful for verifying a newly created or rotated credential. Returns a short preview of the token (first 6 chars) plus the new cache expiry. The full token is never exposed.",
    {
      name: z.string().describe("Credential name to test"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/oauth-credentials/${args.name}/test`, { method: "POST" });
      const json = await resp.json() as {
        success: boolean;
        data?: { ok: boolean; cachedExpiresAt: string | null; accessTokenPreview: string };
        error?: string;
        errorType?: string;
      };
      if (!json.success || !json.data) {
        return text(`FAIL${json.errorType ? ` (${json.errorType})` : ""}: ${json.error ?? "Test failed"}`);
      }
      const d = json.data;
      const ttl = d.cachedExpiresAt
        ? `${Math.round((new Date(d.cachedExpiresAt).getTime() - Date.now()) / 1000)}s`
        : "unknown";
      return text(
        `OK — exchanged credentials for access token (${d.accessTokenPreview}), valid for ~${ttl}.`,
      );
    },
  );

  return [listCredentials, createCredential, updateCredential, deleteCredential, testCredential];
}
