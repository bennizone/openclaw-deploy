#!/usr/bin/env bash
# run-all-models.sh — Automatisierter Benchmark aller Modelle
# Läuft komplett auf dem GPU-Server, braucht kein Claude.
# Startet für jedes Modell den llama-server, benchmarkt, speichert Ergebnis.
#
# Usage (von LXC aus):
#   ssh badmin@10.83.1.110 "bash ~/run-all-models.sh"
#
# Oder direkt auf dem GPU-Server:
#   bash ~/run-all-models.sh

set -euo pipefail

MODELS_DIR="$HOME/models/bench"
LLAMA_SERVER="$HOME/llama.cpp/build/bin/llama-server"
RESULTS_DIR="$HOME/bench-results"
PORT=8080
ENDPOINT="http://localhost:$PORT"

# Benchmark-Script wird von LXC aus aufgerufen - wir machen es lokal
BENCH_SCRIPT="$HOME/benchmarks/scripts/run-bench.sh"

mkdir -p "$RESULTS_DIR"

# Thinking-Modelle (bekommen thinking-budgets)
THINKING_MODELS="DeepSeek-R1|Qwen3.5-4B|Qwen3.5-2B|Qwen3-4B|SmolLM3"

# Alle GGUF-Dateien
MODELS=($(ls "$MODELS_DIR"/*.gguf 2>/dev/null | sort))
TOTAL=${#MODELS[@]}

if [[ $TOTAL -eq 0 ]]; then
  echo "ERROR: No models found in $MODELS_DIR"
  exit 1
fi

echo "========================================"
echo "Benchmark Marathon: $TOTAL models"
echo "Results: $RESULTS_DIR"
echo "========================================"

# Stop embedding server to free VRAM (bge-m3 uses ~500MB)
echo "Stopping embedding server to free VRAM..."
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user stop llama-embed 2>/dev/null || true
sleep 2

FAILED=()
COMPLETED=0

stop_server() {
  # Stop systemd service if running
  XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user stop llama-chat 2>/dev/null || true
  # Kill any manual instances on our port
  local pids=$(lsof -ti :$PORT 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    kill -9 $pids 2>/dev/null || true
    sleep 2
  fi
}

start_server() {
  local model_path="$1"
  local model_name=$(basename "$model_path" .gguf)
  local extra_flags="${2:---flash-attn auto --jinja}"

  $LLAMA_SERVER \
    --model "$model_path" \
    --port $PORT --host 127.0.0.1 \
    --ctx-size 32768 --n-predict 8192 --n-gpu-layers 999 \
    --parallel 1 \
    --cache-type-k q4_0 --cache-type-v q4_0 \
    $extra_flags \
    --threads 2 --threads-batch 4 \
    --no-mmap -b 4096 -ub 512 \
    > "/tmp/llama-bench-$model_name.log" 2>&1 &

  SERVER_PID=$!

  for i in $(seq 1 30); do
    if curl -s "$ENDPOINT/health" 2>/dev/null | grep -q '"ok"'; then
      return 0
    fi
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      # Crash — retry without flash-attn and jinja if we had them
      if [[ "$extra_flags" == *"flash-attn"* ]]; then
        echo "  Crashed with flash-attn, retrying without..." >&2
        start_server "$model_path" ""
        return $?
      fi
      echo "  SERVER CRASHED. Log:"
      tail -5 "/tmp/llama-bench-$model_name.log"
      return 1
    fi
    sleep 1
  done
  echo "  SERVER TIMEOUT"
  return 1
}

run_benchmark() {
  local model_path="$1"
  local model_name=$(basename "$model_path" .gguf)
  local timestamp=$(date +%Y-%m-%d_%H-%M)
  local result_file="$RESULTS_DIR/${timestamp}_${model_name}.json"

  # Determine if thinking model
  local thinking_args=""
  if echo "$model_name" | grep -qE "$THINKING_MODELS"; then
    thinking_args='--thinking-budgets "0,512,1024,2048"'
  fi

  # Build the benchmark request inline (no external script dependency)
  # We test with the HA dataset conversations
  local dataset_file="$HOME/bench-dataset-ha.json"

  if [[ ! -f "$dataset_file" ]]; then
    echo "  ERROR: Dataset not found at $dataset_file"
    return 1
  fi

  # Run each conversation from the dataset
  local tests=$(python3 -c "
import json
with open('$dataset_file') as f:
    data = json.load(f)
print(len(data.get('conversations', data.get('tests', []))))
" 2>/dev/null || echo "0")

  if [[ "$tests" == "0" ]]; then
    echo "  ERROR: No tests in dataset"
    return 1
  fi

  # All models get auto thinking budgets (measures speed, calculates 0.5s/1.0s/1.5s budgets)
  local budgets="auto"

  # Call run-bench.sh (must be available on this machine)
  if [[ -f "$BENCH_SCRIPT" ]]; then
    bash "$BENCH_SCRIPT" \
      --dataset ha \
      --endpoint "$ENDPOINT" \
      --thinking-budgets "$budgets" \
      --no-speed-test \
      --output "$result_file" 2>&1 || {
      echo "  BENCH FAILED for $model_name"
      return 1
    }
  else
    echo "  ERROR: Bench script not found at $BENCH_SCRIPT"
    return 1
  fi

  echo "  SAVED: $result_file"
  return 0
}

# Main loop
for i in "${!MODELS[@]}"; do
  idx=$((i + 1))
  model_path="${MODELS[$i]}"
  model_name=$(basename "$model_path" .gguf)

  echo ""
  echo "[$idx/$TOTAL] ===== $model_name ====="

  # Stop any running server
  stop_server

  # Start server with this model
  echo "  Starting server..."
  if ! start_server "$model_path"; then
    echo "  SKIP: Server failed to start"
    FAILED+=("$model_name (server crash)")
    continue
  fi
  echo "  Server ready. Warming up..."
  # Warmup request — let the model settle after loading
  curl -s "$ENDPOINT/v1/chat/completions" -H "Content-Type: application/json" \
    -d '{"model":"default","messages":[{"role":"user","content":"Hi"}],"max_tokens":10,"stream":false}' \
    -o /dev/null 2>/dev/null
  sleep 2

  # Run benchmark
  echo "  Running benchmark..."
  if run_benchmark "$model_path"; then
    COMPLETED=$((COMPLETED + 1))
  else
    FAILED+=("$model_name (bench failed)")
  fi

  # Stop server
  stop_server
done

# Restore production server + embedding
echo ""
echo "========================================"
echo "Restoring production server..."
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user start llama-embed 2>/dev/null || true
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user start llama-chat 2>/dev/null || true

echo ""
echo "========================================"
echo "BENCHMARK MARATHON COMPLETE"
echo "========================================"
echo "Completed: $COMPLETED / $TOTAL"
echo "Results: $RESULTS_DIR/"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo ""
  echo "FAILED (${#FAILED[@]}):"
  for f in "${FAILED[@]}"; do
    echo "  - $f"
  done
fi

echo ""
echo "To compare results:"
echo "  ls -lhS $RESULTS_DIR/*.json"
