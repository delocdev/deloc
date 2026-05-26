import { describe, it, expect } from "vitest";
import { isAllowedFileExtension } from "./file-types.js";

describe("isAllowedFileExtension", () => {
  it.each([
    "index.html", "style.css", "app.js", "data.json",
    "logo.png", "photo.jpg", "icon.svg", "font.woff2",
    "module.wasm", "robots.txt", "sitemap.xml", "manifest.webmanifest",
  ])("allows %s", (file) => {
    expect(isAllowedFileExtension(file)).toBe(true);
  });

  it.each([
    "script.py", "run.sh", "app.exe", "shell.php",
    "lib.dll", "prog.bat", "noextension",
  ])("rejects %s", (file) => {
    expect(isAllowedFileExtension(file)).toBe(false);
  });
});
