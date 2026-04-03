#!/usr/bin/env node
// consult-sdk.mjs — MiniMax-Konsultation via Claude Code SDK
//
// Drop-in-Ersatz fuer consult-agent.sh. Nutzt die Claude Agent SDK
// mit MiniMax M2.7 als Backend statt den OpenClaw Gateway.
//
// Usage:
//   node scripts/consult-sdk.mjs \
//     --component <name> \
//     --question "<prompt>" \
//     [--with-decisions]
//     [--brief]
//     [--input-file <path>]
//     [--usage-log <path>]
//     [--max-turns <n>]
//     [--tools Read,Glob,Grep,Edit,Write,Bash]

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";

// --- Args parsen ---
const args = process.argv.slice(2);
let component = "";
let question = "";
let withDecisions = false;
let brief = false;
let inputFile = "";
let usageLog = "";
let sessionLogDir = null; // null = nicht aktiviert, string = Pfad (Default oder explizit)
let maxTurns = 15;
let tools = "";

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--component":
      component = args[++i];
      break;
    case "--question":
      question = args[++i];
      break;
    case "--with-decisions":
      withDecisions = true;
      break;
    case "--brief":
      brief = true;
      break;
    case "--input-file":
      inputFile = args[++i];
      break;
    case "--usage-log":
      usageLog = args[++i];
      break;
    case "--session-log":
      // Naechstes Argument ist der Pfad — wenn es eine Flag ist, Default verwenden
      {
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          sessionLogDir = args[++i];
        } else {
          sessionLogDir = join(homedir(), ".openclaw", "sdk-sessions");
        }
      }
      break;
    case "--max-turns":
      maxTurns = parseInt(args[++i], 10);
      break;
    case "--tools":
      tools = args[++i];
      break;
  }
}

if (!question) {
  process.stderr.write(
    "Usage: node consult-sdk.mjs --question \"<prompt>\" [optionen]\n\n" +
    "Optionen:\n" +
    "  --component <name>   Komponente (laedt description.md als System-Prompt)\n" +
    "  --with-decisions     decisions.md an System-Prompt anhaengen\n" +
    "  --brief              Kompakte Antwort (max 5-8 Saetze)\n" +
    "  --input-file <path>  Agent liest diese Datei als Teil der Aufgabe\n" +
    "  --usage-log <path>   Token-Usage loggen (append)\n" +
    "  --session-log [dir]  Session-Streams als JSONL loggen\n" +
    "                       (Default: ~/.openclaw/sdk-sessions/ wenn das Verzeichnis existiert)\n" +
    "  --max-turns <n>      Max agentic turns (Default: 15)\n" +
    "  --tools <list>       Komma-separierte Tool-Liste (Default: Read,Glob,Grep)\n"
  );
  process.exit(1);
}

// --- Repo-Root und Komponenten-Pfade ---
const repoDir = resolve(import.meta.dirname, "..");

// --- MINIMAX_API_KEY aus ~/.openclaw/.env lesen ---
const envFile = join(homedir(), ".openclaw", ".env");
let minimaxKey = "";

if (existsSync(envFile)) {
  const envContent = readFileSync(envFile, "utf-8");
  const match = envContent.match(/^MINIMAX_API_KEY=(.+)$/m);
  if (match) {
    minimaxKey = match[1].trim();
  }
}

if (!minimaxKey) {
  process.stderr.write("ERROR: MINIMAX_API_KEY nicht in ~/.openclaw/.env gefunden\n");
  process.exit(1);
}

// --- System-Prompt bauen ---
let systemPrompt = "";

if (component) {
  const compDir = join(repoDir, "components", component);
  const descFile = join(compDir, "description.md");
  if (!existsSync(descFile)) {
    process.stderr.write(`ERROR: ${descFile} nicht gefunden\n`);
    process.exit(1);
  }
  systemPrompt = readFileSync(descFile, "utf-8");

  if (withDecisions) {
    const decisionsFile = join(compDir, "decisions.md");
    if (existsSync(decisionsFile)) {
      systemPrompt += "\n\n---\n\n# Decisions\n\n" + readFileSync(decisionsFile, "utf-8");
    }
  }
} else {
  // Generischer Code-Assistent: coder.md als System-Prompt
  const coderFile = join(repoDir, ".claude", "commands", "coder.md");
  if (existsSync(coderFile)) {
    systemPrompt = readFileSync(coderFile, "utf-8");
  } else {
    systemPrompt = "Du bist ein Code-Assistent fuer das OpenClaw-Projekt. Lies relevante Dateien bevor du Code aenderst.";
  }
}

if (brief) {
  systemPrompt +=
    "\n\nWICHTIG: Antworte kompakt — maximal 5-8 Saetze. Nur wesentliche Inhalte.";
}

// --- Prompt bauen ---
let fullPrompt = question;

if (inputFile) {
  if (!existsSync(inputFile)) {
    process.stderr.write(`ERROR: Input-Datei '${inputFile}' nicht gefunden\n`);
    process.exit(1);
  }
  fullPrompt +=
    `\n\nLies die Datei ${inputFile} mit dem Read-Tool und analysiere ihren Inhalt als Teil deiner Aufgabe.`;
}

// --- Session-Log ---
const resolvedSessionLogDir = sessionLogDir;

let sessionLogEnabled = false;
let sessionLogFile = null;

if (resolvedSessionLogDir) {
  try {
    if (!existsSync(resolvedSessionLogDir)) {
      mkdirSync(resolvedSessionLogDir, { recursive: true });
    }
    sessionLogEnabled = true;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeName = (component || "generic").replace(/[^a-zA-Z0-9_-]/g, "_");
    sessionLogFile = join(resolvedSessionLogDir, `${ts}_${safeName}.jsonl`);
  } catch (err) {
    process.stderr.write(`WARN: Session-Log deaktiviert (Konnte Datei nicht anlegen: ${err.message})\n`);
    sessionLogEnabled = false;
  }
}

function sessionLog(message) {
  if (!sessionLogEnabled || !sessionLogFile) return;
  try {
    appendFileSync(sessionLogFile, JSON.stringify(message) + "\n");
  } catch (_) {
    // Logging darf den normalen Ablauf nicht stören
  }
}

// --- SDK query() mit Retry ---
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

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
let totalInputTokens = 0;
let totalOutputTokens = 0;
let success = false;

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    result = "";
    totalInputTokens = 0;
    totalOutputTokens = 0;

    const allowedTools = tools
      ? tools.split(",").map((t) => t.trim())
      : ["Read", "Glob", "Grep"];

    for await (const message of query({
      prompt: fullPrompt,
      options: {
        systemPrompt: systemPrompt,
        cwd: repoDir,
        env: env,
        allowedTools: allowedTools,
        maxTurns: maxTurns,
        permissionMode: "bypassPermissions",
      },
    })) {
      sessionLog(message);
      if (message.type === "result") {
        if (message.subtype === "success") {
          result = message.result || "";
          success = true;
        } else if (message.subtype === "max_turns") {
          // maxTurns erreicht — Teilergebnis ausgeben falls vorhanden
          result = message.result || "";
          success = true;
          process.stderr.write(
            `WARN: maxTurns (${maxTurns}) erreicht — Ergebnis ist moeglicherweise unvollstaendig\n`
          );
        } else if (message.subtype === "error") {
          throw new Error(`SDK query error: ${message.error || "unknown"}`);
        } else {
          // Unbekannter subtype — Ergebnis akzeptieren falls vorhanden
          if (message.result) {
            result = message.result;
            success = true;
            process.stderr.write(`WARN: Unerwarteter Result-Subtype: ${message.subtype}\n`);
          } else {
            throw new Error(`SDK query failed: ${message.subtype}`);
          }
        }
      }

      if (message.type === "assistant" && message.message?.usage) {
        totalInputTokens += message.message.usage.input_tokens || 0;
        totalOutputTokens += message.message.usage.output_tokens || 0;
      }
    }

    if (success) break;

    throw new Error("Query ended without result");
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      process.stderr.write(
        `WARN: Versuch ${attempt + 1}/${MAX_RETRIES + 1} fehlgeschlagen: ${err.message} — Retry in ${RETRY_DELAY_MS / 1000}s...\n`
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    } else {
      process.stderr.write(
        `ERROR: Fehlgeschlagen nach ${MAX_RETRIES + 1} Versuchen: ${err.message}\n`
      );
      process.exit(1);
    }
  }
}

// --- Ergebnis ausgeben ---
if (result) {
  process.stdout.write(result);
}

// --- Usage-Log ---
if (usageLog) {
  const ts = new Date().toISOString();
  const logLine = `${ts} ${component || "generic"} sdk prompt=${totalInputTokens} completion=${totalOutputTokens}\n`;
  appendFileSync(usageLog, logLine);
}

// --- Session-Log Summary ---
if (sessionLogEnabled && sessionLogFile) {
  try {
    const summary = {
      type: "summary",
      component: component || "generic",
      question: question,
      totalInputTokens,
      totalOutputTokens,
      success,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(sessionLogFile, JSON.stringify(summary) + "\n");
  } catch (_) {
    // Logging darf den normalen Ablauf nicht stören
  }
}
