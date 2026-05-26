import { BLOCKED_EXTENSIONS } from "./constants.js";

export interface ScanWarning {
  file: string;
  reason: string;
}

const CRYPTO_MINER_PATTERNS = [
  /coinhive\.min\.js/i,
  /coinhive\.com/i,
  /coin-hive\.com/i,
  /jsecoin\.com/i,
  /cryptoloot\.pro/i,
  /crypto-loot\.com/i,
  /minero\.cc/i,
  /authedmine\.com/i,
  /CoinImp\.min\.js/i,
  /mineralts\.io/i,
];

const PHISHING_FORM_PATTERN =
  /<form[^>]*action\s*=\s*["']https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+["'][^>]*>/gi;

// HTML patterns for iframe, meta refresh, object, embed pointing to external URLs
const EXTERNAL_IFRAME_PATTERN =
  /<iframe[^>]*src\s*=\s*["']https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+["'][^>]*>/gi;

const META_REFRESH_PATTERN =
  /<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url\s*=\s*https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+["'][^>]*>/gi;

const EXTERNAL_OBJECT_PATTERN =
  /<object[^>]*data\s*=\s*["']https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+["'][^>]*>/gi;

const EXTERNAL_EMBED_PATTERN =
  /<embed[^>]*src\s*=\s*["']https?:\/\/(?!(?:localhost|127\.0\.0\.1))[^"']+["'][^>]*>/gi;

// JavaScript-specific dangerous patterns (checked in .js/.mjs/.cjs and inline <script> in HTML)
const JS_EVAL_PATTERN = /\beval\s*\(/gi;
const JS_NEW_FUNCTION_PATTERN = /\bnew\s+Function\s*\(/gi;
const JS_DOCUMENT_COOKIE_PATTERN = /\bdocument\s*\.\s*cookie\b/gi;

// SVG-specific dangerous patterns
const SVG_SCRIPT_PATTERN = /<script[\s>]/gi;
const SVG_EVENT_HANDLER_PATTERN = /\bon\w+\s*=/gi;
const SVG_FOREIGN_OBJECT_PATTERN = /<foreignObject[\s>]/gi;

export function scanFileContent(filePath: string, content: string): ScanWarning[] {
  const warnings: ScanWarning[] = [];
  const lower = filePath.toLowerCase();

  // Crypto miner check — all files
  for (const pattern of CRYPTO_MINER_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push({ file: filePath, reason: "Contains known crypto miner script reference" });
      break;
    }
  }

  const isHtml = lower.endsWith(".html") || lower.endsWith(".htm");
  const isSvg = lower.endsWith(".svg");
  const isJs = lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs");

  // JavaScript-specific scanning (JS files and inline scripts in HTML)
  if (isJs || isHtml) {
    if (JS_EVAL_PATTERN.test(content)) {
      warnings.push({ file: filePath, reason: "Contains eval() call (potential code injection)" });
    }
    JS_EVAL_PATTERN.lastIndex = 0;

    if (JS_NEW_FUNCTION_PATTERN.test(content)) {
      warnings.push({ file: filePath, reason: "Contains new Function() (potential code injection)" });
    }
    JS_NEW_FUNCTION_PATTERN.lastIndex = 0;

    if (JS_DOCUMENT_COOKIE_PATTERN.test(content)) {
      warnings.push({ file: filePath, reason: "Accesses document.cookie (potential cookie theft)" });
    }
    JS_DOCUMENT_COOKIE_PATTERN.lastIndex = 0;
  }

  // HTML-specific scanning
  if (isHtml) {
    if (PHISHING_FORM_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "HTML contains form posting to external domain (potential phishing)",
      });
    }
    PHISHING_FORM_PATTERN.lastIndex = 0;

    if (EXTERNAL_IFRAME_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "HTML contains iframe pointing to external URL",
      });
    }
    EXTERNAL_IFRAME_PATTERN.lastIndex = 0;

    if (META_REFRESH_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "HTML contains meta refresh redirect to external URL",
      });
    }
    META_REFRESH_PATTERN.lastIndex = 0;

    if (EXTERNAL_OBJECT_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "HTML contains object element with external data source",
      });
    }
    EXTERNAL_OBJECT_PATTERN.lastIndex = 0;

    if (EXTERNAL_EMBED_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "HTML contains embed element with external source",
      });
    }
    EXTERNAL_EMBED_PATTERN.lastIndex = 0;
  }

  // SVG-specific scanning (defense-in-depth — SVGs are also served with Content-Disposition: attachment)
  if (isSvg) {
    if (SVG_SCRIPT_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "SVG contains <script> tag (potential XSS)",
      });
    }
    SVG_SCRIPT_PATTERN.lastIndex = 0;

    if (SVG_EVENT_HANDLER_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "SVG contains event handler attribute (potential XSS)",
      });
    }
    SVG_EVENT_HANDLER_PATTERN.lastIndex = 0;

    if (SVG_FOREIGN_OBJECT_PATTERN.test(content)) {
      warnings.push({
        file: filePath,
        reason: "SVG contains <foreignObject> element (can embed arbitrary HTML)",
      });
    }
    SVG_FOREIGN_OBJECT_PATTERN.lastIndex = 0;
  }

  return warnings;
}

export function checkBlockedExtension(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  for (const ext of BLOCKED_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return ext;
    }
  }
  return null;
}
