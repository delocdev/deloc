const VIEWPORT = { width: 1200, height: 630 };
const RENDER_WAIT_MS = 3000;
const NAVIGATION_TIMEOUT_MS = 15000;

interface ScreenshotResult {
  success: boolean;
  message?: string;
}

/**
 * Capture an OG screenshot of a deployed app and upload it via the API.
 * Requires Puppeteer to be installed — silently skips if unavailable.
 * Designed for fire-and-forget use from MCP and CLI.
 */
export async function captureAndUploadScreenshot(
  appUrl: string,
  appSlug: string,
  apiUrl: string,
  token: string,
): Promise<ScreenshotResult> {
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */

  // Dynamic import — Puppeteer is an optional peer dependency.
  // We deliberately avoid importing types so the shared package compiles
  // without Puppeteer installed.
  let mod: Record<string, unknown>;
  try {
    mod = await (Function('return import("puppeteer")')() as Promise<Record<string, unknown>>);
  } catch {
    return { success: false, message: "Puppeteer not installed — skipping screenshot" };
  }

  const launch = (mod.default as Record<string, unknown>)?.launch ?? (mod as Record<string, unknown>).launch;
  if (typeof launch !== "function") {
    return { success: false, message: "Puppeteer module has no launch function" };
  }

  let browser: { newPage: () => Promise<unknown>; close: () => Promise<void> } | undefined;
  try {
    browser = await (launch as Function)({
      headless: true,
      defaultViewport: VIEWPORT,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }) as typeof browser;

    const page = await browser!.newPage() as {
      goto: (url: string, opts: Record<string, unknown>) => Promise<void>;
      screenshot: (opts: Record<string, unknown>) => Promise<Buffer>;
    };

    await page.goto(appUrl, {
      waitUntil: "networkidle2",
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    // Extra wait for React/SPA apps that load data after initial render
    await new Promise((resolve) => setTimeout(resolve, RENDER_WAIT_MS));

    const pngBuffer = await page.screenshot({ type: "png" });

    await browser!.close();
    browser = undefined;

    // Upload to API
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(pngBuffer).buffer], { type: "image/png" }),
      "og-screenshot.png",
    );

    const resp = await fetch(`${apiUrl}/api/apps/${appSlug}/og-image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!resp.ok) {
      const body = await resp.text();
      return { success: false, message: `Upload failed: ${resp.status} ${body}` };
    }

    return { success: true, message: "Preview image generated for link sharing" };
  } catch (err) {
    return {
      success: false,
      message: `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }

  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
}
