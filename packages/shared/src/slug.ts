import crypto from "node:crypto";

export function generateSubdomain(): string {
  const bytes = crypto.randomBytes(4).toString("hex");
  return `d-${bytes}`;
}

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63);
}

export function makeUniqueSlug(baseSlug: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseSlug}-${i}`;
    if (!existingSlugs.has(candidate)) return candidate;
  }
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${baseSlug}-${suffix}`;
}
