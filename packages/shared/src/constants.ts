export const TIER_LIMITS = {
  free: {
    maxApps: 3,
    maxStorageBytes: 100 * 1024 * 1024, // 100MB
    maxUploadBytes: 50 * 1024 * 1024, // 50MB
    maxBandwidthBytesPerApp: 1 * 1024 * 1024 * 1024, // 1GB
    deploysPerDay: 5,
    appExpiryDays: 30,
    maxMembers: 1,
    showBranding: true,
    domainRestriction: false,
    // Actions — free tier is hard-walled. UI shows an upgrade CTA.
    actionsPerApp: 0,
    actionInvocationsPerMonth: 0,
    actionCustomDomains: false,
  },
  pro: {
    maxApps: 5,
    maxStorageBytes: 1 * 1024 * 1024 * 1024, // 1GB
    maxUploadBytes: 100 * 1024 * 1024, // 100MB
    maxBandwidthBytesPerApp: 10 * 1024 * 1024 * 1024, // 10GB
    deploysPerDay: 20,
    appExpiryDays: null,
    maxMembers: 1,
    showBranding: false,
    domainRestriction: false,
    actionsPerApp: 3,
    actionInvocationsPerMonth: 1_000,
    actionCustomDomains: false,
  },
  pro_unlimited: {
    maxApps: Infinity,
    maxStorageBytes: 5 * 1024 * 1024 * 1024, // 5GB
    maxUploadBytes: 250 * 1024 * 1024, // 250MB
    maxBandwidthBytesPerApp: 25 * 1024 * 1024 * 1024, // 25GB
    deploysPerDay: 50,
    appExpiryDays: null,
    maxMembers: 1,
    showBranding: false,
    domainRestriction: true,
    actionsPerApp: 10,
    actionInvocationsPerMonth: 10_000,
    actionCustomDomains: true,
  },
  team: {
    maxApps: Infinity,
    maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10GB
    maxUploadBytes: 500 * 1024 * 1024, // 500MB
    maxBandwidthBytesPerApp: 50 * 1024 * 1024 * 1024, // 50GB
    deploysPerDay: 100,
    appExpiryDays: null,
    maxMembers: null,
    showBranding: false,
    domainRestriction: true,
    actionsPerApp: 25,
    actionInvocationsPerMonth: 100_000,
    actionCustomDomains: true,
  },
  enterprise: {
    maxApps: Infinity,
    maxStorageBytes: Infinity,
    maxUploadBytes: Infinity,
    maxBandwidthBytesPerApp: Infinity,
    deploysPerDay: Infinity,
    appExpiryDays: null,
    maxMembers: null,
    showBranding: false,
    domainRestriction: true,
    actionsPerApp: Infinity,
    actionInvocationsPerMonth: Infinity,
    actionCustomDomains: true,
  },
} as const;

// Action log retention. 90 days for all tiers in V1; enterprise extensions
// happen via per-org override, not a tier constant.
export const ACTION_INVOCATION_RETENTION_DAYS = 90;

// Free apps keep serving past `maxBandwidthBytesPerApp` (the soft limit) with
// a prominent banner — viral free apps are free marketing. But at this
// multiplier of the soft limit they're abuse candidates: the Worker stops
// serving the app's content and returns an upgrade page instead. Caps
// Worker-invocation + R2-read spend on any single free app in a month.
// Paid tiers ignore this — they hard-block at their one published limit.
export const FREE_TIER_HARD_BANDWIDTH_MULTIPLIER = 5;

export const ALLOWED_MIME_TYPES = [
  "text/html",
  "text/css",
  "application/javascript",
  "text/javascript",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/svg+xml",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/wasm",
  "text/plain",
  "text/xml",
  "application/xml",
  "application/manifest+json",
] as const;

export const BLOCKED_EXTENSIONS = [
  ".exe", ".bat", ".sh", ".cmd", ".ps1", ".php", ".py", ".rb",
  ".pl", ".cgi", ".jar", ".msi", ".dll", ".so", ".dylib",
] as const;

export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "admin", "dashboard", "login", "billing",
  "status", "mail", "help", "support", "docs", "blog", "cdn",
  "assets", "static", "dev", "staging", "test", "demo", "team",
]);

// Data file uploads — see /api/apps/:slug/data endpoints
export const DATA_FILE_ALLOWED_EXTENSIONS = new Set([".csv", ".json", ".tsv", ".xml", ".txt"]);
export const DATA_FILE_RESERVED_NAMES = new Set([
  "index.html", "index.htm", "manifest.json", "robots.txt", "sitemap.xml", "og-screenshot.png",
]);
export const DATA_FILE_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB per file
export const DATA_FILE_BATCH_MAX_BYTES = 100 * 1024 * 1024; // 100 MB per request
export const DATA_UPLOAD_MAX_CONCURRENT = 10;
export const DATA_UPLOADS_PER_HOUR_PER_APP = 60;
