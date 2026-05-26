import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireToken, apiFetch } from "../api.js";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const methodEnum = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const roleEnum = z.enum(["publisher", "admin", "viewer"]);

interface ActionResponse {
  id: string;
  name: string;
  displayName: string;
  method: string;
  targetUrl: string;
  allowedVariables: string[];
  allowedRoles: string[];
  externalIdVariable: string | null;
  status: string;
}

// Scans headerTemplate values + bodyTemplate for `${SECRET}` placeholders so
// the tool can tell the LLM exactly which secrets still need to be set.
function findSecretPlaceholders(
  headerTemplate: Record<string, string>,
  bodyTemplate: unknown,
): string[] {
  const names = new Set<string>();
  const re = /\$\{([A-Z][A-Z0-9_]{0,63})\}/g;
  const scan = (s: string) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) names.add(m[1]!);
  };
  for (const v of Object.values(headerTemplate)) scan(v);
  if (typeof bodyTemplate === "string") scan(bodyTemplate);
  else if (bodyTemplate != null) scan(JSON.stringify(bodyTemplate));
  return Array.from(names).sort();
}

function formatCreateSuccess(action: ActionResponse): string {
  const secrets = findSecretPlaceholders(
    {} as Record<string, string>, // headerTemplate isn't in ActionResponse; skip for now
    null,
  );
  const lines = [
    `Created action "${action.name}" (${action.method} ${action.targetUrl}).`,
    `Status: ${action.status}. Allowed roles: ${action.allowedRoles.join(", ")}.`,
  ];
  if (action.allowedVariables.length > 0) {
    lines.push(`Viewer variables: ${action.allowedVariables.join(", ")}.`);
  }
  if (action.externalIdVariable) {
    lines.push(`External ID variable: ${action.externalIdVariable} (used for dedupe/audit).`);
  }
  if (secrets.length > 0) {
    lines.push(`Secrets required: ${secrets.join(", ")}. Call set_action_secret for each.`);
  }
  lines.push(`Next: call test_action to verify, then invoke from the browser with @deloc/client.`);
  return lines.join("\n");
}

export function registerActionWriteTools(server: McpServer) {
  const createSchema = {
    slug: z.string().describe("App slug"),
    name: z
      .string()
      .describe("Internal action name — lowercase letters, digits, underscores; starts with a letter; max 64 chars. Used in the client SDK: deloc.actions.<name>()."),
    display_name: z.string().describe("Human-readable label shown in the dashboard (e.g. 'Fetch placement')."),
    description: z.string().optional().describe("Optional note explaining what the action does."),
    method: methodEnum.describe("HTTP method for the outbound request."),
    target_url: z
      .string()
      .describe("Full https:// URL to call. Three template syntaxes: {var} for a lowercase runtime variable (substituted from the body at invoke time, URL-encoded), ${SECRET_NAME} for an uppercase-named stored secret, and {{viewer.email}} / {{viewer.id}} / {{now}} / {{action.name}} for server-injected trusted context. Example: https://api.example.com/v1/placement/{placement_id}.xml — NOT ${placement_id} (that's secret syntax, requires an uppercase name). Host must be in the org's allowed_action_domains if the app is org-owned."),
    header_template: z
      .record(z.string(), z.string())
      .optional()
      .describe('Outbound headers. Values use the same three-namespace templating as target_url: {var} for runtime body variables, ${SECRET_NAME} for stored secrets (uppercase only), {{viewer.email}} etc. for trusted context. Example: {"Authorization":"Bearer ${API_KEY}","X-User":"{{viewer.email}}"}'),
    body_template: z
      .unknown()
      .optional()
      .describe('JSON body template. Objects/strings supported. Use {var} for lowercase runtime body variables, ${SECRET_NAME} for uppercase-named stored secrets, {{viewer.email}} / {{viewer.id}} / {{now}} / {{action.name}} for trusted context. Do NOT use ${var} (lowercase-after-$) — that matches nothing and will pass through literally as URL-encoded text.'),
    allowed_variables: z
      .array(z.string())
      .optional()
      .describe("Lowercase variable names the browser may pass at invoke time (e.g. ['placement_id','amount']). Anything not in this list is rejected."),
    allowed_roles: z
      .array(roleEnum)
      .optional()
      .describe("Which session roles may invoke this action. Default: ['publisher','admin']. Add 'viewer' to expose to end users."),
    external_id_variable: z
      .string()
      .optional()
      .describe("Name of a variable in allowed_variables whose value is recorded on each invocation for audit/dedupe. Must also appear in allowed_variables."),
    rate_limit_per_viewer_per_hour: z.number().int().min(1).max(3600).optional().describe("Max invocations per viewer per hour (default 60)."),
    rate_limit_per_app_per_hour: z.number().int().min(1).max(100_000).optional().describe("Max invocations app-wide per hour (default 1000)."),
    timeout_ms: z.number().int().min(1000).max(60_000).optional().describe("Upstream request timeout in ms (default 30000)."),
    max_response_bytes: z.number().int().min(1024).max(10 * 1024 * 1024).optional().describe("Max upstream response size in bytes (default 1048576)."),
    credential_name: z
      .string()
      .optional()
      .describe(
        "Name of an OAuth credential (see list_oauth_credentials). When set, the server refreshes the access token at invoke time and injects it as ${OAUTH_ACCESS_TOKEN} — reference it in header_template (e.g. 'Authorization: Bearer ${OAUTH_ACCESS_TOKEN}'). Must exist in the same scope as this app (org-scoped for team apps, personal for solo apps).",
      ),
  };

  const toBody = (args: Record<string, unknown>) => {
    const body: Record<string, unknown> = {
      name: args.name,
      displayName: args.display_name,
      method: args.method,
      targetUrl: args.target_url,
    };
    if (args.description !== undefined) body.description = args.description;
    if (args.header_template !== undefined) body.headerTemplate = args.header_template;
    if (args.body_template !== undefined) body.bodyTemplate = args.body_template;
    if (args.allowed_variables !== undefined) body.allowedVariables = args.allowed_variables;
    if (args.allowed_roles !== undefined) body.allowedRoles = args.allowed_roles;
    if (args.external_id_variable !== undefined) body.externalIdVariable = args.external_id_variable;
    if (args.rate_limit_per_viewer_per_hour !== undefined) body.rateLimitPerViewerPerHour = args.rate_limit_per_viewer_per_hour;
    if (args.rate_limit_per_app_per_hour !== undefined) body.rateLimitPerAppPerHour = args.rate_limit_per_app_per_hour;
    if (args.timeout_ms !== undefined) body.timeoutMs = args.timeout_ms;
    if (args.max_response_bytes !== undefined) body.maxResponseBytes = args.max_response_bytes;
    if (args.credential_name !== undefined) body.credentialName = args.credential_name;
    return body;
  };

  const createAction = server.tool(
    "create_action",
    "Create a new server-side Action on a published app. Actions let browser code call external APIs without exposing keys — secrets live server-side and are templated in at invoke time. Template syntax (IMPORTANT, do not mix up): {name} for runtime variables from the body (lowercase name, no dollar sign — e.g. {placement_id}), ${NAME} for stored secrets (uppercase name only — e.g. ${API_KEY}), {{viewer.email}} for trusted server-injected context. Walk the user through: (1) target URL + method, (2) any secrets they need (uppercase ${NAME}), (3) variables the browser will pass (lowercase {name}), (4) which roles can invoke. Then prompt them to set_action_secret for every ${SECRET} used, then test_action.",
    createSchema,
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(args as Record<string, unknown>)),
      });
      const body = await resp.json() as { success: boolean; data?: ActionResponse; error?: string; code?: string };
      if (!body.success || !body.data) {
        const hint = body.code === "ACTIONS_TIER_REQUIRED"
          ? " Upgrade to Pro ($10/mo) or higher to enable Actions."
          : body.code === "ACTION_LIMIT_REACHED"
            ? " Delete an unused action or upgrade for a higher limit."
            : "";
        return text(`Error: ${body.error ?? "Create failed"}${hint}`);
      }
      return text(formatCreateSuccess(body.data));
    },
  );

  const updateSchema = {
    slug: z.string().describe("App slug"),
    name: z.string().describe("Existing action name to update"),
    display_name: createSchema.display_name.optional(),
    description: createSchema.description,
    method: methodEnum.optional(),
    target_url: z.string().optional().describe("New full https:// URL. Same placeholder rules as create."),
    header_template: createSchema.header_template,
    body_template: createSchema.body_template,
    allowed_variables: createSchema.allowed_variables,
    allowed_roles: createSchema.allowed_roles,
    external_id_variable: createSchema.external_id_variable,
    rate_limit_per_viewer_per_hour: createSchema.rate_limit_per_viewer_per_hour,
    rate_limit_per_app_per_hour: createSchema.rate_limit_per_app_per_hour,
    timeout_ms: createSchema.timeout_ms,
    max_response_bytes: createSchema.max_response_bytes,
    credential_name: z
      .string()
      .nullable()
      .optional()
      .describe(
        "OAuth credential to attach. Pass the credential's name, or null to detach an existing credential.",
      ),
  };

  const updateAction = server.tool(
    "update_action",
    "Update an existing Action. Every field is optional — send only what's changing. Business rules (https-only, host allowlist, externalIdVariable ∈ allowedVariables) are re-checked on the merged result.",
    updateSchema,
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const fields = toBody(args as Record<string, unknown>);
      delete fields.name;
      const resp = await apiFetch(`/api/apps/${args.slug}/actions/${args.name}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await resp.json() as { success: boolean; data?: ActionResponse; error?: string };
      if (!body.success || !body.data) return text(`Error: ${body.error ?? "Update failed"}`);
      return text(`Updated action "${body.data.name}". Status: ${body.data.status}.`);
    },
  );

  const deleteAction = server.tool(
    "delete_action",
    "Permanently delete an Action. All secrets and invocation logs are cascaded. Irreversible.",
    {
      slug: z.string().describe("App slug"),
      name: z.string().describe("Action name to delete"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/actions/${args.name}`, { method: "DELETE" });
      const body = await resp.json() as { success: boolean; data?: { name: string }; error?: string };
      if (!body.success) return text(`Error: ${body.error ?? "Delete failed"}`);
      return text(`Deleted action "${args.name}".`);
    },
  );

  const enableAction = server.tool(
    "enable_action",
    "Re-enable a disabled or auto-disabled Action. Idempotent.",
    {
      slug: z.string().describe("App slug"),
      name: z.string().describe("Action name"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/actions/${args.name}/enable`, { method: "POST" });
      const body = await resp.json() as { success: boolean; data?: { name: string; status: string }; error?: string };
      if (!body.success) return text(`Error: ${body.error ?? "Enable failed"}`);
      return text(`Enabled "${args.name}".`);
    },
  );

  const disableAction = server.tool(
    "disable_action",
    "Disable an Action so invocations are rejected. Config and secrets are preserved.",
    {
      slug: z.string().describe("App slug"),
      name: z.string().describe("Action name"),
    },
    async (args) => {
      if (!requireToken()) return text("Error: Not authenticated. Use the setup_deloc tool first.");
      const resp = await apiFetch(`/api/apps/${args.slug}/actions/${args.name}/disable`, { method: "POST" });
      const body = await resp.json() as { success: boolean; data?: { name: string; status: string }; error?: string };
      if (!body.success) return text(`Error: ${body.error ?? "Disable failed"}`);
      return text(`Disabled "${args.name}". Invocations will return 403 until re-enabled.`);
    },
  );

  return [createAction, updateAction, deleteAction, enableAction, disableAction];
}
