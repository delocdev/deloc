const ALLOWED_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".cjs",
  ".json", ".map",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico", ".bmp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".wasm",
  ".txt", ".xml", ".webmanifest", ".manifest",
  ".mp4", ".webm", ".ogg", ".mp3", ".wav",
  ".pdf",
  ".csv", ".tsv",
]);

export function isAllowedFileExtension(filePath: string): boolean {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1) return false;
  const ext = filePath.slice(lastDot).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}
