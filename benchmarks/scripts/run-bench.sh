#!/usr/bin/env bash
# run-bench.sh — Mechanische LLM-Benchmark-Metriken
# Misst TTFT, t/s, Token-Counts, JSON-Validierung
#
# Usage:
#   ./run-bench.sh --dataset ha --endpoint http://10.83.1.110:8080
#   ./run-bench.sh --dataset ha --endpoint http://10.83.1.110:8080 --thinking-budgets "0,512,1024,2048"
#   ./run-bench.sh --dataset fallback --endpoint http://10.83.1.110:8080 --parallel-test
#
# Dependencies: bash, curl, jq, bc (or python3 as fallback)
# Optional: ssh + nvidia-smi (for GPU info)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
DATASETS_DIR="$BENCH_DIR/datasets"
RESULTS_DIR="$BENCH_DIR/results"

# Defaults
ENDPOINT="http://10.83.1.110:8080"
DATASET=""
THINKING_BUDGETS=""
PARALLEL_TEST=false
GPU_SSH="badmin@10.83.1.110"
OUTPUT_FILE=""

usage() {
  cat <<EOF
Usage: $0 --dataset <ha|memory|fallback> [options]

Options:
  --dataset <name>           Dataset to test: ha, memory, fallback
  --endpoint <url>           LLM endpoint (default: http://10.83.1.110:8080)
  --thinking-budgets <list>  Comma-separated budgets to test (e.g., "0,512,1024,2048")
  --parallel-test            Run parallel throughput test (2 concurrent requests)
  --gpu-ssh <user@host>      SSH target for GPU info (default: badmin@10.83.1.110)
  --output <file>            Output file (default: auto-generated in results/)
  -h, --help                 Show this help
EOF
  exit 0
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dataset) DATASET="$2"; shift 2 ;;
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --thinking-budgets) THINKING_BUDGETS="$2"; shift 2 ;;
    --parallel-test) PARALLEL_TEST=true; shift ;;
    --gpu-ssh) GPU_SSH="$2"; shift 2 ;;
    --output) OUTPUT_FILE="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$DATASET" ]] && { echo "Error: --dataset required" >&2; usage; }

# Resolve dataset file
case "$DATASET" in
  ha)       DATASET_FILE="$DATASETS_DIR/ha-conversations.json" ;;
  memory)   DATASET_FILE="$DATASETS_DIR/memory-synthetic.json" ;;
  fallback) DATASET_FILE="$DATASETS_DIR/fallback-chat.json" ;;
  *)        DATASET_FILE="$DATASETS_DIR/$DATASET.json" ;;
esac

[[ ! -f "$DATASET_FILE" ]] && { echo "Error: Dataset not found: $DATASET_FILE" >&2; exit 1; }

# Memory dataset needs its own script (different format: turns, expectedFacts/expectedRejects)
if [[ "$DATASET" == "memory" ]]; then
  echo "Memory-Benchmark benötigt eigenes Script (TODO)." >&2
  echo "Das Memory-Dataset verwendet ein anderes Format (turns statt messages, expectedFacts/expectedRejects)." >&2
  exit 0
fi

# ── Collect metadata ──

echo "Collecting metadata..." >&2

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DATE_SLUG=$(date +"%Y-%m-%d_%H-%M")

# Model name from endpoint
MODEL_NAME=$(curl -sf "$ENDPOINT/v1/models" 2>/dev/null | jq -r '.data[0].id // "unknown"' 2>/dev/null || echo "unknown")

# GPU info via SSH
GPU_NAME="unknown"
GPU_VRAM="unknown"
if ssh -o ConnectTimeout=3 -o BatchMode=yes "$GPU_SSH" true 2>/dev/null; then
  GPU_NAME=$(ssh "$GPU_SSH" "nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1" 2>/dev/null || echo "unknown")
  GPU_VRAM=$(ssh "$GPU_SSH" "nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -1" 2>/dev/null || echo "unknown")
fi

# Auto output file
if [[ -z "$OUTPUT_FILE" ]]; then
  MODEL_SLUG=$(echo "$MODEL_NAME" | sed 's/[^a-zA-Z0-9._-]/_/g' | cut -c1-50)
  GPU_SLUG=$(echo "$GPU_NAME" | sed 's/[^a-zA-Z0-9._-]/_/g' | cut -c1-30)
  OUTPUT_FILE="$RESULTS_DIR/${DATE_SLUG}_${MODEL_SLUG}_${GPU_SLUG}_${DATASET}.json"
fi

mkdir -p "$RESULTS_DIR"

echo "Model: $MODEL_NAME" >&2
echo "GPU: $GPU_NAME ($GPU_VRAM)" >&2
echo "Endpoint: $ENDPOINT" >&2
echo "Dataset: $DATASET ($DATASET_FILE)" >&2

# ── Helper functions ──

# bc with python3 fallback for math operations
# Usage: calc "scale=1; 100 * 1000 / 500"
calc() {
  local expr="$1"
  if command -v bc &>/dev/null; then
    echo "$expr" | bc 2>/dev/null && return
  fi
  # Fallback: strip bc-specific "scale=N;" prefix, evaluate with python3
  local py_expr="${expr#*;}"
  py_expr="${py_expr# }"
  # Extract scale for rounding
  local scale=0
  if [[ "$expr" =~ scale=([0-9]+) ]]; then
    scale="${BASH_REMATCH[1]}"
  fi
  python3 -c "print(round(${py_expr}, ${scale}))" 2>/dev/null || echo "0"
}

# Send a chat completion request, measure timing, return JSON with metrics
# Args: $1=messages_json, $2=thinking_budget (optional, "" for default), $3=tools_json (optional)
send_request() {
  local messages="$1"
  local budget="${2:-}"
  local tools="${3:-}"
  local tmpfile
  tmpfile=$(mktemp)

  # Build request body
  local body
  if [[ -n "$budget" ]]; then
    if [[ "$budget" == "0" ]]; then
      body=$(jq -n --argjson msgs "$messages" '{
        model: "default",
        messages: $msgs,
        max_tokens: 2048,
        temperature: 0.15,
        stream: false,
        chat_template_kwargs: { enable_thinking: false }
      }')
    else
      body=$(jq -n --argjson msgs "$messages" --argjson budget "$budget" '{
        model: "default",
        messages: $msgs,
        max_tokens: 2048,
        temperature: 0.6,
        stream: false,
        thinking: { type: "enabled", budget_tokens: $budget }
      }')
    fi
  else
    # Default: no thinking override
    body=$(jq -n --argjson msgs "$messages" '{
      model: "default",
      messages: $msgs,
      max_tokens: 2048,
      temperature: 0.15,
      stream: false,
      chat_template_kwargs: { enable_thinking: false }
    }')
  fi

  # Add tool definitions if provided
  if [[ -n "$tools" && "$tools" != "null" && "$tools" != "[]" ]]; then
    body=$(echo "$body" | jq --argjson tools "$tools" '. + { tools: $tools, tool_choice: "auto" }')
  fi

  # Measure TTFT and total time in a SINGLE request (content + timing)
  # curl -o writes body to $tmpfile, -w writes timing info to stdout
  local ttft_ms total_ms http_code
  local curl_timing
  curl_timing=$(curl -s -o "$tmpfile" \
    -w "%{time_starttransfer} %{time_total} %{http_code}" \
    -H "Content-Type: application/json" \
    --connect-timeout 10 \
    --max-time 120 \
    -d "$body" \
    "$ENDPOINT/v1/chat/completions" 2>/dev/null) || curl_timing="0 0 000"

  ttft_ms=$(echo "$curl_timing" | awk '{printf "%.0f", $1 * 1000}' 2>/dev/null || echo "0")
  total_ms=$(echo "$curl_timing" | awk '{printf "%.0f", $2 * 1000}' 2>/dev/null || echo "0")
  http_code=$(echo "$curl_timing" | awk '{print $3}' 2>/dev/null || echo "000")

  if [[ "$http_code" != "200" ]]; then
    echo "{\"error\": \"HTTP $http_code\", \"ttft_ms\": 0, \"total_ms\": 0}"
    rm -f "$tmpfile"
    return 1
  fi

  # Parse response
  local content thinking_content prompt_tokens completion_tokens
  content=$(jq -r '.choices[0].message.content // ""' "$tmpfile" 2>/dev/null)
  thinking_content=$(jq -r '.choices[0].message.reasoning_content // .choices[0].message.thinking // ""' "$tmpfile" 2>/dev/null)
  prompt_tokens=$(jq -r '.usage.prompt_tokens // 0' "$tmpfile" 2>/dev/null)
  completion_tokens=$(jq -r '.usage.completion_tokens // 0' "$tmpfile" 2>/dev/null)

  local thinking_tokens=0
  if [[ -n "$thinking_content" && "$thinking_content" != "null" ]]; then
    # Rough estimate: 4 chars per token
    thinking_tokens=$(( ${#thinking_content} / 4 ))
  fi

  # Calculate t/s
  local tokens_per_sec="0"
  if [[ "$total_ms" -gt 0 && "$completion_tokens" -gt 0 ]]; then
    tokens_per_sec=$(calc "scale=1; $completion_tokens * 1000 / $total_ms")
  fi

  # JSON validity check (for tool calls) + extract details
  local has_tool_calls=false
  local tool_calls_valid=true
  local tool_calls_detail="[]"
  if jq -e '.choices[0].message.tool_calls' "$tmpfile" >/dev/null 2>&1; then
    has_tool_calls=true
    local tc_count
    tc_count=$(jq '.choices[0].message.tool_calls | length' "$tmpfile" 2>/dev/null || echo "0")
    for ((i=0; i<tc_count; i++)); do
      local tc_name tc_args tc_args_parsed tc_valid
      tc_name=$(jq -r ".choices[0].message.tool_calls[$i].function.name" "$tmpfile" 2>/dev/null)
      tc_args=$(jq -r ".choices[0].message.tool_calls[$i].function.arguments" "$tmpfile" 2>/dev/null)
      tc_valid=true
      tc_args_parsed="null"
      if echo "$tc_args" | jq . >/dev/null 2>&1; then
        tc_args_parsed=$(echo "$tc_args" | jq .)
      else
        tc_valid=false
        tool_calls_valid=false
      fi
      tool_calls_detail=$(echo "$tool_calls_detail" | jq --arg name "$tc_name" \
        --argjson args "$tc_args_parsed" --argjson valid "$tc_valid" \
        '. + [{ name: $name, arguments: $args, valid_json: $valid }]')
    done
  fi

  # Build result JSON
  jq -n \
    --arg content "$content" \
    --arg thinking "$thinking_content" \
    --argjson ttft_ms "$ttft_ms" \
    --argjson total_ms "$total_ms" \
    --argjson prompt_tokens "$prompt_tokens" \
    --argjson completion_tokens "$completion_tokens" \
    --argjson thinking_tokens "$thinking_tokens" \
    --arg tokens_per_sec "$tokens_per_sec" \
    --argjson has_tool_calls "$has_tool_calls" \
    --argjson tool_calls_valid "$tool_calls_valid" \
    --argjson tool_calls_detail "$tool_calls_detail" \
    --arg budget "${budget:-default}" \
    '{
      content: $content,
      thinking: $thinking,
      ttft_ms: $ttft_ms,
      total_ms: $total_ms,
      prompt_tokens: $prompt_tokens,
      completion_tokens: $completion_tokens,
      thinking_tokens: $thinking_tokens,
      tokens_per_sec: ($tokens_per_sec | tonumber),
      has_tool_calls: $has_tool_calls,
      tool_calls_valid: $tool_calls_valid,
      tool_calls: $tool_calls_detail,
      thinking_budget: $budget
    }'

  rm -f "$tmpfile"
}

# ── Run parallel throughput test ──

run_parallel_test() {
  local messages="$1"
  echo "Running parallel throughput test (2 concurrent)..." >&2

  local tmp1 tmp2
  tmp1=$(mktemp)
  tmp2=$(mktemp)

  local par_start
  par_start=$(date +%s%N)

  # Run two requests in parallel
  (send_request "$messages" "" > "$tmp1" 2>/dev/null) &
  local pid1=$!
  (send_request "$messages" "" > "$tmp2" 2>/dev/null) &
  local pid2=$!

  wait "$pid1" "$pid2" 2>/dev/null || true

  local par_end
  par_end=$(date +%s%N)
  local par_total_ms=$(( (par_end - par_start) / 1000000 ))

  local tps1 tps2
  tps1=$(jq -r '.tokens_per_sec // 0' "$tmp1" 2>/dev/null || echo "0")
  tps2=$(jq -r '.tokens_per_sec // 0' "$tmp2" 2>/dev/null || echo "0")
  local tps_combined
  tps_combined=$(calc "scale=1; $tps1 + $tps2")

  jq -n \
    --arg tps1 "$tps1" \
    --arg tps2 "$tps2" \
    --arg tps_combined "$tps_combined" \
    --argjson total_ms "$par_total_ms" \
    '{
      slot_1_tps: ($tps1 | tonumber),
      slot_2_tps: ($tps2 | tonumber),
      combined_tps: ($tps_combined | tonumber),
      wall_time_ms: $total_ms
    }'

  rm -f "$tmp1" "$tmp2"
}

# ── Main benchmark loop ──

echo "Starting benchmark..." >&2

# Determine budgets to test
BUDGETS_ARRAY=()
if [[ -n "$THINKING_BUDGETS" ]]; then
  IFS=',' read -ra BUDGETS_ARRAY <<< "$THINKING_BUDGETS"
else
  BUDGETS_ARRAY=("")  # Single run with default
fi

# Read conversations from dataset
CONV_COUNT=$(jq '.conversations | length' "$DATASET_FILE")
echo "Conversations to test: $CONV_COUNT" >&2

ALL_RESULTS="[]"
PARALLEL_RESULT="{}"

# Detect system prompt mode (dataset-level, checked once)
# 1. system_prompt_template (with {time}, {daylight}, {entities} placeholders) — e.g. HA dataset
# 2. system_prompt (static string) — e.g. fallback-chat dataset
# 3. Neither — no system message prepended
HAS_TEMPLATE=$(jq -r 'if .system_prompt_template then "yes" else "no" end' "$DATASET_FILE")
HAS_SYSTEM=$(jq -r 'if .system_prompt then "yes" else "no" end' "$DATASET_FILE")

for ((c=0; c<CONV_COUNT; c++)); do
  CONV_NAME=$(jq -r ".conversations[$c].name" "$DATASET_FILE")
  CONV_CATEGORY=$(jq -r ".conversations[$c].category // \"unknown\"" "$DATASET_FILE")

  echo "  [$((c+1))/$CONV_COUNT] $CONV_NAME ($CONV_CATEGORY)" >&2

  if [[ "$HAS_TEMPLATE" == "yes" ]]; then
    MESSAGES=$(jq --arg time "$(date +%H:%M)" --arg daylight "Tag, neutrales Licht bevorzugt" \
      '(.system_prompt_template // "") as $tpl |
       (.mock_entities // "") as $ent |
       ($tpl | gsub("\\{time\\}"; $time) | gsub("\\{daylight\\}"; $daylight) | gsub("\\{entities\\}"; $ent)) as $sys |
       [{role: "system", content: $sys}] + .conversations['"$c"'].messages' \
      "$DATASET_FILE")
  elif [[ "$HAS_SYSTEM" == "yes" ]]; then
    MESSAGES=$(jq \
      '(.system_prompt // "") as $sys |
       [{role: "system", content: $sys}] + .conversations['"$c"'].messages' \
      "$DATASET_FILE")
  else
    MESSAGES=$(jq '.conversations['"$c"'].messages' "$DATASET_FILE")
  fi

  # Check if this conversation requires tool definitions
  CONV_MODE=$(jq -r ".conversations[$c].mode // \"default\"" "$DATASET_FILE")
  TOOLS_JSON=""
  if [[ "$CONV_MODE" == "with_tools" ]]; then
    TOOLS_JSON=$(jq -r '.tool_definitions // []' "$DATASET_FILE")
    echo "    (with tool definitions)" >&2
  fi

  CONV_RESULTS="[]"

  for budget in "${BUDGETS_ARRAY[@]}"; do
    BUDGET_LABEL="${budget:-default}"
    echo "    Budget: $BUDGET_LABEL" >&2

    RESULT=$(send_request "$MESSAGES" "$budget" "$TOOLS_JSON" 2>/dev/null || echo '{"error":"request_failed"}')
    RESULT=$(echo "$RESULT" | jq --arg name "$CONV_NAME" --arg cat "$CONV_CATEGORY" --arg mode "$CONV_MODE" \
      '. + {conversation: $name, category: $cat, mode: $mode}')

    CONV_RESULTS=$(echo "$CONV_RESULTS" | jq --argjson r "$RESULT" '. + [$r]')
  done

  ALL_RESULTS=$(echo "$ALL_RESULTS" | jq --argjson r "$CONV_RESULTS" '. + $r')
done

# Parallel test (use first conversation's messages)
if [[ "$PARALLEL_TEST" == "true" ]]; then
  echo "Running parallel throughput test..." >&2
  if [[ "$HAS_TEMPLATE" == "yes" ]]; then
    FIRST_MSGS=$(jq --arg time "$(date +%H:%M)" --arg daylight "Tag, neutrales Licht bevorzugt" \
      '(.system_prompt_template // "") as $tpl |
       (.mock_entities // "") as $ent |
       ($tpl | gsub("\\{time\\}"; $time) | gsub("\\{daylight\\}"; $daylight) | gsub("\\{entities\\}"; $ent)) as $sys |
       [{role: "system", content: $sys}] + .conversations[0].messages' \
      "$DATASET_FILE")
  elif [[ "$HAS_SYSTEM" == "yes" ]]; then
    FIRST_MSGS=$(jq '(.system_prompt // "") as $sys |
       [{role: "system", content: $sys}] + .conversations[0].messages' "$DATASET_FILE")
  else
    FIRST_MSGS=$(jq '.conversations[0].messages' "$DATASET_FILE")
  fi
  PARALLEL_RESULT=$(run_parallel_test "$FIRST_MSGS")
fi

# ── Aggregate metrics ──

echo "Aggregating results..." >&2

# Calculate averages
AVG_TTFT=$(echo "$ALL_RESULTS" | jq '[.[].ttft_ms | select(. > 0)] | if length > 0 then (add / length | floor) else 0 end')
P50_TTFT=$(echo "$ALL_RESULTS" | jq '[.[].ttft_ms | select(. > 0)] | sort | if length > 0 then .[length/2 | floor] else 0 end')
P95_TTFT=$(echo "$ALL_RESULTS" | jq '[.[].ttft_ms | select(. > 0)] | sort | if length > 0 then .[length * 0.95 | floor] else 0 end')
AVG_TPS=$(echo "$ALL_RESULTS" | jq '[.[].tokens_per_sec | select(. > 0)] | if length > 0 then (add / length * 10 | floor) / 10 else 0 end')
TOTAL_TESTS=$(echo "$ALL_RESULTS" | jq 'length')
TOOL_CALL_TESTS=$(echo "$ALL_RESULTS" | jq '[.[] | select(.has_tool_calls == true)] | length')
TOOL_CALL_VALID=$(echo "$ALL_RESULTS" | jq '[.[] | select(.has_tool_calls == true and .tool_calls_valid == true)] | length')
ERRORS=$(echo "$ALL_RESULTS" | jq '[.[] | select(.error)] | length')

# ── Build final output ──

FINAL=$(jq -n \
  --arg timestamp "$TIMESTAMP" \
  --arg model "$MODEL_NAME" \
  --arg gpu "$GPU_NAME" \
  --arg gpu_vram "$GPU_VRAM" \
  --arg dataset "$DATASET" \
  --arg endpoint "$ENDPOINT" \
  --argjson avg_ttft "$AVG_TTFT" \
  --argjson p50_ttft "$P50_TTFT" \
  --argjson p95_ttft "$P95_TTFT" \
  --argjson avg_tps "$AVG_TPS" \
  --argjson total_tests "$TOTAL_TESTS" \
  --argjson tool_call_tests "$TOOL_CALL_TESTS" \
  --argjson tool_call_valid "$TOOL_CALL_VALID" \
  --argjson errors "$ERRORS" \
  --argjson parallel "$PARALLEL_RESULT" \
  --argjson results "$ALL_RESULTS" \
  '{
    meta: {
      timestamp: $timestamp,
      model: $model,
      gpu: $gpu,
      gpu_vram: $gpu_vram,
      dataset: $dataset,
      endpoint: $endpoint
    },
    performance: {
      ttft_ms: { avg: $avg_ttft, p50: $p50_ttft, p95: $p95_ttft },
      tokens_per_sec_avg: $avg_tps,
      parallel: $parallel
    },
    summary: {
      total_tests: $total_tests,
      tool_call_tests: $tool_call_tests,
      tool_calls_valid: $tool_call_valid,
      errors: $errors
    },
    results: $results
  }')

# Save
echo "$FINAL" | jq . > "$OUTPUT_FILE"
echo "" >&2
echo "Results saved to: $OUTPUT_FILE" >&2
echo "" >&2

# Print summary
echo "═══ BENCHMARK SUMMARY ═══" >&2
echo "Model:     $MODEL_NAME" >&2
echo "GPU:       $GPU_NAME ($GPU_VRAM)" >&2
echo "Dataset:   $DATASET ($CONV_COUNT conversations)" >&2
echo "TTFT:      avg=${AVG_TTFT}ms  p50=${P50_TTFT}ms  p95=${P95_TTFT}ms" >&2
echo "t/s:       avg=${AVG_TPS}" >&2
if [[ "$PARALLEL_TEST" == "true" ]]; then
  PAR_TPS=$(echo "$PARALLEL_RESULT" | jq '.combined_tps // 0')
  echo "t/s (2x):  combined=${PAR_TPS}" >&2
fi
echo "Tests:     $TOTAL_TESTS total, $ERRORS errors" >&2
if [[ "$TOOL_CALL_TESTS" -gt 0 ]]; then
  echo "Tool-Calls: $TOOL_CALL_VALID/$TOOL_CALL_TESTS valid JSON" >&2
fi
echo "═════════════════════════" >&2

# Also output JSON to stdout for piping
echo "$FINAL"
