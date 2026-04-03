#!/usr/bin/env node
// validate-config.mjs — OpenClaw Config-Validierung via Claude Agent SDK
// Usage: node scripts/validate-config.mjs --question "<frage>"
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";

const repoDir = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
let question = "";
for (let i = 0; i < args.length; i++) if (args[i] === "--question") question = args[++i];

if (!question) {
  process.stderr.write("Usage: node validate-config.mjs --question \"<frage>\"\n");
  process.exit(1);
}

// MINIMAX_API_KEY aus ~/.openclaw/.env
const envFile = join(homedir(), ".openclaw", ".env");
let minimaxKey = "";
if (existsSync(envFile)) {
  const m = readFileSync(envFile, "utf-8").match(/^MINIMAX_API_KEY=(.+)$/m);
  if (m) minimaxKey = m[1].trim();
}
if (!minimaxKey) {
  process.stderr.write("ERROR: MINIMAX_API_KEY nicht in ~/.openclaw/.env gefunden\n");
  process.exit(1);
}

const configPath = join(homedir(), ".openclaw", "openclaw.json");
if (!existsSync(configPath)) {
  process.stderr.write(`ERROR: ${configPath} nicht gefunden\n`);
  process.exit(1);
}

const systemPrompt = "Du bist ein Config-Validator fuer OpenClaw. Analysiere openclaw.json und beantworte Fragen zu Konsistenz, Pflichtfeldern und logischen Fehlern.";
const fullPrompt = `Lies die Datei ${configPath} und beantworte:\n\n${question}`;

const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
  ANTHROPIC_AUTH_TOKEN: minimaxKey,
  ANTHROPIC_MODEL: "MiniMax-M2.7",
  ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2.7",
  API_TIMEOUT_MS: "3000000",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
};

for await (const msg of query({
  prompt: fullPrompt,
  options: {
    systemPrompt,
    cwd: repoDir,
    env,
    allowedTools: ["Read", "Glob", "Grep"],
    maxTurns: 10,
    permissionMode: "bypassPermissions",
  },
})) {
  if (msg.type === "result" && msg.result) process.stdout.write(msg.result);
}
