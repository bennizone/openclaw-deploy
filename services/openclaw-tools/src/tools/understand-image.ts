import { z } from "zod";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MiniMaxClient } from "../clients/minimax.js";

const SUPPORTED_FORMATS: Record<string, string> = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
};

function detectFormat(source: string, contentType?: string): string {
  if (contentType) {
    if (contentType.includes("png")) return "png";
    if (contentType.includes("webp")) return "webp";
    if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpeg";
  }
  const ext = source.toLowerCase().match(/\.\w+$/)?.[0] ?? "";
  return SUPPORTED_FORMATS[ext] ?? "jpeg";
}

async function toBase64DataUrl(imageSource: string): Promise<string> {
  // Strip @ prefix (MiniMax convention)
  const source = imageSource.startsWith("@") ? imageSource.slice(1) : imageSource;

  // Already a data URL
  if (source.startsWith("data:")) return source;

  // HTTP/HTTPS URL
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const res = await fetch(source, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const format = detectFormat(source, res.headers.get("content-type") ?? undefined);
    return `data:image/${format};base64,${buf.toString("base64")}`;
  }

  // Local file — validate extension to prevent arbitrary file reads
  const ext = source.toLowerCase().match(/\.\w+$/)?.[0] ?? "";
  if (!SUPPORTED_FORMATS[ext]) {
    throw new Error(`Unsupported image format: ${ext || "unknown"}. Supported: JPEG, PNG, WebP`);
  }
  if (!existsSync(source)) {
    throw new Error(`Image file not found: ${source}`);
  }
  const buf = await readFile(source);
  const format = detectFormat(source);
  return `data:image/${format};base64,${buf.toString("base64")}`;
}

export function registerUnderstandImage(server: McpServer, minimax: MiniMaxClient): void {
  server.registerTool(
    "understand_image",
    {
      title: "Understand Image",
      description:
        "Analyze and interpret image content using MiniMax Vision (VLM). " +
        "Accepts local file paths or HTTP URLs. Supported formats: JPEG, PNG, WebP. " +
        "Provide a prompt describing what to analyze or extract from the image.",
      inputSchema: {
        prompt: z.string().describe("What to analyze or extract from the image"),
        image_source: z
          .string()
          .describe(
            "Image location: HTTP/HTTPS URL or local file path. " +
            "Strip any @ prefix before passing."
          ),
      },
    },
    async ({ prompt, image_source }) => {
      try {
        const base64Url = await toBase64DataUrl(image_source);
        const analysis = await minimax.analyzeImage(prompt, base64Url);
        return {
          content: [{ type: "text" as const, text: analysis }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Image analysis failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
