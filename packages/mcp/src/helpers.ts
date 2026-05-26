import crypto from "node:crypto";

export const AUTO_GENERATE_KEYWORDS = new Set(["true", "yes", "generate"]);

export function generatePassword(): string {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

export function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function formatExpiry(expiresAt: string | null): string {
  if (!expiresAt) return "no expiry";
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "expired";
  return `expires in ${days}d`;
}
