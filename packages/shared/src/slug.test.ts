import { describe, it, expect } from "vitest";
import { generateSlug, makeUniqueSlug } from "./slug.js";

describe("generateSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(generateSlug("My Cool App")).toBe("my-cool-app");
  });

  it("strips special characters", () => {
    expect(generateSlug("Q3 Revenue (Final)!")).toBe("q3-revenue-final");
  });

  it("collapses multiple hyphens", () => {
    expect(generateSlug("a---b")).toBe("a-b");
  });

  it("trims leading/trailing hyphens", () => {
    expect(generateSlug("--hello--")).toBe("hello");
  });

  it("truncates to 63 chars", () => {
    const long = "a".repeat(100);
    expect(generateSlug(long).length).toBeLessThanOrEqual(63);
  });
});

describe("makeUniqueSlug", () => {
  it("returns base slug if unique", () => {
    expect(makeUniqueSlug("my-app", new Set())).toBe("my-app");
  });

  it("appends number if taken", () => {
    expect(makeUniqueSlug("my-app", new Set(["my-app"]))).toBe("my-app-2");
  });

  it("increments until unique", () => {
    expect(makeUniqueSlug("app", new Set(["app", "app-2", "app-3"]))).toBe("app-4");
  });
});
