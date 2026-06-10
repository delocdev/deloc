// Curated default allowlist for new orgs. Kept intentionally small — these are
// domains where a brand-new user can try the webhook preset + custom form
// without talking to an admin first. Anything broader should be opted into
// at the org level via the admin console on Pro Unlimited+ tiers.
//
// Wildcard entries are matched by matchesAllowlist(); "*.example.com" matches
// "api.example.com" and "x.y.example.com" but NOT "example.com" itself.
export const DEFAULT_ALLOWED_ACTION_DOMAINS: string[] = [
  // Workflow-automation catch hooks — the generic-webhook escape hatch.
  // These accept a POST and hand it to a user-owned automation; they do not
  // redirect or echo arbitrary requests, so they cannot be turned into an SSRF
  // springboard or a public exfiltration sink. Generic test endpoints that CAN
  // (httpbin.org + postman-echo.com follow attacker-controlled redirects;
  // webhook.site captures and displays whatever is POSTed) are deliberately
  // NOT defaulted — an org that needs one adds it via the admin console.
  "hooks.zapier.com",
  "hook.eu1.make.com",
  "hook.us1.make.com",
  "hook.eu2.make.com",
  "hook.us2.make.com",
];

// Case-insensitive, wildcard-aware host match. "*.foo.com" matches
// "bar.foo.com" and "a.b.foo.com" but NOT bare "foo.com" — register both
// explicitly if needed.
export function matchesAllowlist(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const entry of allowlist) {
    const e = entry.toLowerCase();
    if (e.startsWith("*.")) {
      const suffix = e.slice(1); // ".foo.com"
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    } else if (h === e) {
      return true;
    }
  }
  return false;
}
