#!/usr/bin/env node
// identify-components.mjs — Welche Komponenten sind betroffen?
// Usage: node scripts/identify-components.mjs --question "<anfrage>"

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";

const argv = process.argv.slice(2);
const questionArg = argv.indexOf("--question");
const question = questionArg !== -1 ? argv[questionArg + 1] : "";
if (!question) {
  process.stderr.write("Usage: node identify-components.mjs --question \"<anfrage>\"\n");
  process.exit(1);
}

const repoDir = resolve(import.meta.dirname, "..");
const compDir = join(repoDir, "components");

// --- MINIMAX_API_KEY ---
const envFile = join(homedir(), ".openclaw", ".env");
const envContent = existsSync(envFile) ? readFileSync(envFile, "utf-8") : "";
const minimaxKey = (envContent.match(/^MINIMAX_API_KEY=(.+)$/m) || [])[1]?.trim() || "";
if (!minimaxKey) {
  process.stderr.write("ERROR: MINIMAX_API_KEY nicht in ~/.openclaw/.env gefunden\n");
  process.exit(1);
}

// --- Alle description.md sammeln ---
const dirs = readdirSync(compDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const descriptions = dirs
  .map(name => {
    const path = join(compDir, name, "description.md");
    return existsSync(path) ? `## ${name}\n\n${readFileSync(path, "utf-8")}` : null;
  })
  .filter(Boolean)
  .join("\n\n---\n\n");

const systemPrompt =
  `Analysiere die Anfrage und bestimme welche OpenClaw-Komponenten betroffen sind.\n\n${descriptions}\n\n` +
  `Antworte NUR mit komma-separierten Komponenten-Namen, z.B.: component-a,component-b\n` +
  `Wenn keine betroffen: none`;

const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
  ANTHROPIC_AUTH_TOKEN: minimaxKey,
  ANTHROPIC_MODEL: "MiniMax-M2.7",
  ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2.7",
  API_TIMEOUT_MS: "3000000",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
};

let result = "";
for await (const msg of query({
  prompt: question,
  options: { systemPrompt, cwd: repoDir, env, allowedTools: [], maxTurns: 1, permissionMode: "bypassPermissions" },
})) {
  if (msg.type === "result" && msg.result) result = msg.result;
}

process.stdout.write(result || "none");
