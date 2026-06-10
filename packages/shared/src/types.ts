export type UserTier = "free" | "pro" | "pro_unlimited";

export type OrgTier = "team" | "enterprise";

export type UserRole = "publisher" | "admin" | "viewer";

export type AppStatus = "active" | "disabled" | "archived" | "expired" | "deleted";

export type AppVisibility = "public" | "domain_restricted" | "password_protected";

export type OAuthProvider = "microsoft" | "google" | "okta" | "entra";

export type AuthTier = "standard" | "enterprise";

// How a deploy arrived. `client` is self-reported via the X-Deloc-Client
// header — analytics only, never authorization. "api" = no/unrecognized
// header (curl, CI, third-party); "unknown" = row predates tracking.
export const DEPLOY_CLIENTS = ["cli", "mcp", "web", "api"] as const;
export type DeployClient = (typeof DEPLOY_CLIENTS)[number];
export type DeployMethod = "zip" | "paste";

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  username: string;
  tier: UserTier;
  orgId: string | null;
  role: UserRole | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface FolderSummary {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  appCount: number;
  createdAt: string;
}

export interface AppSummary {
  id: string;
  name: string;
  slug: string;
  url: string;
  status: AppStatus;
  totalSizeBytes: number;
  folderId: string | null;
  createdAt: string;
}

export interface AppDetail extends AppSummary {
  visibility: AppVisibility;
  fileCount: number;
  bandwidthUsedBytes: number;
  expiresAt: string | null;
  publishedBy: string;
  // Latest deploy's source. "unknown" for apps that predate tracking.
  deployClient: DeployClient | "unknown";
  deployMethod: DeployMethod | "unknown";
}

// Actions ------------------------------------------------------------------

export const ACTION_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type ActionMethod = (typeof ACTION_METHODS)[number];

export type ActionStatus = "active" | "disabled" | "auto_disabled";

export type ActionErrorType =
  | "timeout"
  | "rate_limit"
  | "ssrf_blocked"
  | "upstream_error"
  | "schema_invalid"
  | "variable_missing"
  | "variable_not_allowed"
  | "domain_not_allowed"
  | "forbidden_role"
  | "response_too_large"
  | "content_type_blocked"
  | "oauth_refresh_failed"
  | "test";

export type ActionInvokableRole = "publisher" | "admin" | "viewer";

export type PresetRequestStatus = "pending" | "in_progress" | "shipped" | "declined";

// Sent to the browser via @deloc/client.
export type ActionInvocationResult<T = unknown> =
  | { success: true; data: T; statusCode: number; latencyMs: number }
  | { success: false; error: string; errorType: ActionErrorType; statusCode?: number; latencyMs: number };

export interface ActionSummary {
  id: string;
  name: string;
  displayName: string;
  method: ActionMethod;
  status: ActionStatus;
  externalIdVariable: string | null;
  invocationsThisMonth: number;
  errorRatePercent: number;
  lastInvokedAt: string | null;
  createdAt: string;
}

export interface ActionSecretSummary {
  secretName: string;
  keyVersion: number;
  updatedAt: string;
}

export interface ActionDetail extends ActionSummary {
  description: string | null;
  targetUrl: string;
  headerTemplate: Record<string, string>;
  // Arbitrary JSON tree with `{var}`, `${SECRET}`, `{{trusted.key}}` placeholders.
  bodyTemplate: unknown;
  allowedVariables: string[];
  allowedRoles: ActionInvokableRole[];
  rateLimitPerViewerPerHour: number;
  rateLimitPerAppPerHour: number;
  timeoutMs: number;
  maxResponseBytes: number;
  secrets: ActionSecretSummary[];
}

export interface InvocationSummary {
  id: string;
  actionName: string;
  viewerEmail: string | null;
  externalId: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  errorType: ActionErrorType | null;
  success: boolean;
  createdAt: string;
}
