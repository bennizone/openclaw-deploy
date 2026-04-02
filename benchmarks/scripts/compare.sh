#!/usr/bin/env bash
# compare.sh — Vergleicht LLM-Benchmark-Ergebnisse
#
# Usage:
#   ./compare.sh results/run1.json results/run2.json
#   ./compare.sh results/*.json
#
# Dependencies: bash, jq, bc

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <result1.json> <result2.json> [result3.json ...]"
  echo ""
  echo "Compares benchmark results side-by-side."
  exit 1
fi

# Verify all files exist
for f in "$@"; do
  [[ -f "$f" ]] || { echo "Error: File not found: $f" >&2; exit 1; }
done

# ── Header ──

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  LLM BENCHMARK COMPARISON"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# ── Collect data ──

declare -a MODELS GPUS TIMESTAMPS TTFT_AVGS TTFT_P50S TTFT_P95S TPS_AVGS
declare -a PAR_TPS TOTAL_TESTS ERRORS TC_VALID TC_TOTAL DATASETS

i=0
for f in "$@"; do
  MODELS[$i]=$(jq -r '.meta.model // "?"' "$f")
  GPUS[$i]=$(jq -r '.meta.gpu // "?"' "$f")
  TIMESTAMPS[$i]=$(jq -r '.meta.timestamp // "?"' "$f" | cut -c1-16)
  DATASETS[$i]=$(jq -r '.meta.dataset // "?"' "$f")
  TTFT_AVGS[$i]=$(jq -r '.performance.ttft_ms.avg // 0' "$f")
  TTFT_P50S[$i]=$(jq -r '.performance.ttft_ms.p50 // 0' "$f")
  TTFT_P95S[$i]=$(jq -r '.performance.ttft_ms.p95 // 0' "$f")
  TPS_AVGS[$i]=$(jq -r '.performance.tokens_per_sec_avg // 0' "$f")
  PAR_TPS[$i]=$(jq -r '.performance.parallel.combined_tps // "-"' "$f")
  TOTAL_TESTS[$i]=$(jq -r '.summary.total_tests // 0' "$f")
  ERRORS[$i]=$(jq -r '.summary.errors // 0' "$f")
  TC_VALID[$i]=$(jq -r '.summary.tool_calls_valid // 0' "$f")
  TC_TOTAL[$i]=$(jq -r '.summary.tool_call_tests // 0' "$f")
  ((i++))
done

NUM_RUNS=$i

# ── Format table ──

# Calculate column widths
COL_W=30
SEP=""
for ((j=0; j<NUM_RUNS; j++)); do
  SEP="${SEP}$(printf '%-*s' $COL_W '------------------------------')"
done

# Print row helper
print_row() {
  local label="$1"
  shift
  printf "  %-22s" "$label"
  for val in "$@"; do
    printf "%-${COL_W}s" "$val"
  done
  echo ""
}

# Header with run labels
printf "  %-22s" ""
for ((j=0; j<NUM_RUNS; j++)); do
  printf "%-${COL_W}s" "Run $((j+1))"
done
echo ""

printf "  %-22s" ""
for ((j=0; j<NUM_RUNS; j++)); do
  printf "%-${COL_W}s" "$(printf '%.0s─' {1..26})"
done
echo ""

# Metadata
print_row "Timestamp" "${TIMESTAMPS[@]}"
print_row "Model" "${MODELS[@]}"
print_row "GPU" "${GPUS[@]}"
print_row "Dataset" "${DATASETS[@]}"

echo ""
printf "  %-22s" ""
for ((j=0; j<NUM_RUNS; j++)); do
  printf "%-${COL_W}s" "$(printf '%.0s─' {1..26})"
done
echo ""

# Performance
print_row "TTFT avg (ms)" "${TTFT_AVGS[@]}"
print_row "TTFT p50 (ms)" "${TTFT_P50S[@]}"
print_row "TTFT p95 (ms)" "${TTFT_P95S[@]}"
print_row "t/s (single)" "${TPS_AVGS[@]}"
print_row "t/s (2x parallel)" "${PAR_TPS[@]}"

echo ""

# Quality
TC_PCTS=()
for ((j=0; j<NUM_RUNS; j++)); do
  if [[ "${TC_TOTAL[$j]}" -gt 0 ]]; then
    PCT=$(echo "scale=0; ${TC_VALID[$j]} * 100 / ${TC_TOTAL[$j]}" | bc 2>/dev/null || echo "0")
    TC_PCTS[$j]="${TC_VALID[$j]}/${TC_TOTAL[$j]} (${PCT}%)"
  else
    TC_PCTS[$j]="-"
  fi
done

print_row "Tests total" "${TOTAL_TESTS[@]}"
print_row "Errors" "${ERRORS[@]}"
print_row "Tool-Calls valid" "${TC_PCTS[@]}"

# ── Delta (if exactly 2 runs) ──

if [[ $NUM_RUNS -eq 2 ]]; then
  echo ""
  printf "  %-22s" ""
  for ((j=0; j<NUM_RUNS; j++)); do
    printf "%-${COL_W}s" "$(printf '%.0s─' {1..26})"
  done
  echo ""
  echo "  DELTA (Run 2 vs Run 1):"
  echo ""

  calc_delta() {
    local v1="$1" v2="$2" unit="${3:-}"
    if [[ "$v1" == "-" || "$v2" == "-" || "$v1" == "0" ]]; then
      echo "-"
      return
    fi
    local diff pct sign
    diff=$(echo "scale=1; $v2 - $v1" | bc 2>/dev/null || echo "0")
    if [[ $(echo "$v1 > 0" | bc 2>/dev/null) -eq 1 ]]; then
      pct=$(echo "scale=1; ($v2 - $v1) * 100 / $v1" | bc 2>/dev/null || echo "0")
    else
      pct="0"
    fi
    # Add + prefix for positive
    if [[ $(echo "$diff >= 0" | bc 2>/dev/null) -eq 1 ]]; then
      sign="+"
    else
      sign=""
    fi
    echo "${sign}${diff}${unit} (${sign}${pct}%)"
  }

  TTFT_DELTA=$(calc_delta "${TTFT_AVGS[0]}" "${TTFT_AVGS[1]}" "ms")
  TPS_DELTA=$(calc_delta "${TPS_AVGS[0]}" "${TPS_AVGS[1]}" "")

  printf "  %-22s%s\n" "TTFT avg" "$TTFT_DELTA"
  printf "  %-22s%s\n" "t/s (single)" "$TPS_DELTA"

  if [[ "${PAR_TPS[0]}" != "-" && "${PAR_TPS[1]}" != "-" ]]; then
    PAR_DELTA=$(calc_delta "${PAR_TPS[0]}" "${PAR_TPS[1]}" "")
    printf "  %-22s%s\n" "t/s (parallel)" "$PAR_DELTA"
  fi
fi

echo ""

# ── Thinking budget comparison (if present) ──

HAS_BUDGET_DATA=false
for f in "$@"; do
  if jq -e '.results[0].thinking_budget' "$f" >/dev/null 2>&1; then
    HAS_BUDGET_DATA=true
    break
  fi
done

if [[ "$HAS_BUDGET_DATA" == "true" ]]; then
  echo "─── Thinking Budget Breakdown ───"
  echo ""

  for f in "$@"; do
    MODEL=$(jq -r '.meta.model // "?"' "$f")
    echo "  $MODEL:"

    # Group by budget
    BUDGET_LIST=$(jq -r '[.results[].thinking_budget] | unique | .[]' "$f" 2>/dev/null)
    printf "  %-12s %-12s %-12s %-12s\n" "Budget" "TTFT avg" "t/s avg" "Think tok"

    for budget in $BUDGET_LIST; do
      B_TTFT=$(jq "[.results[] | select(.thinking_budget == \"$budget\") | .ttft_ms] | if length > 0 then (add / length | floor) else 0 end" "$f")
      B_TPS=$(jq "[.results[] | select(.thinking_budget == \"$budget\") | .tokens_per_sec] | if length > 0 then (add / length * 10 | floor) / 10 else 0 end" "$f")
      B_THINK=$(jq "[.results[] | select(.thinking_budget == \"$budget\") | .thinking_tokens] | if length > 0 then (add / length | floor) else 0 end" "$f")
      printf "  %-12s %-12s %-12s %-12s\n" "$budget" "${B_TTFT}ms" "$B_TPS" "$B_THINK"
    done
    echo ""
  done
fi

echo "═══════════════════════════════════════════════════════════════════════════════"
