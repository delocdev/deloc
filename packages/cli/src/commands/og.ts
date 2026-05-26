import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getToken, getApiUrl } from "../config.js";
import { chalk, errorMessage } from "../ui.js";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function ogCommand(slug: string, imagePath: string): Promise<void> {
  const token = await getToken();
  if (!token) {
    console.log(errorMessage("Not logged in. Run " + chalk.bold("deloc login") + " first."));
    process.exit(1);
  }

  const filePath = resolve(imagePath);
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    console.log(errorMessage(`Could not read file: ${filePath}`));
    process.exit(1);
  }

  if (buffer.length > MAX_SIZE) {
    console.log(errorMessage(`Image too large (${Math.round(buffer.length / 1024)}KB). Max is 2MB.`));
    process.exit(1);
  }

  const isPng = PNG_MAGIC.every((byte, i) => buffer[i] === byte);
  if (!isPng) {
    console.log(errorMessage("Image must be a PNG file."));
    process.exit(1);
  }

  // Copy into a fresh ArrayBuffer so the Blob constructor accepts it.
  // Node's Buffer is typed Buffer<ArrayBufferLike>, which doesn't satisfy
  // BlobPart's ArrayBufferView<ArrayBuffer> constraint — a raw ArrayBuffer
  // sidesteps the variance.
  const ab = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(ab).set(buffer);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([ab], { type: "image/png" }),
    "og-screenshot.png",
  );

  const resp = await fetch(`${getApiUrl()}/api/apps/${slug}/og-image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const body = await resp.json() as { success: boolean; error?: string };
  if (!body.success) {
    console.log(errorMessage(body.error ?? "Upload failed"));
    process.exit(1);
  }

  console.log(chalk.green("  OG image set!") + " Link previews on X, Slack, etc. will now show your screenshot.");
}
