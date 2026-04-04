#!/bin/bash
# download-bench-models.sh
# Downloads all 17 benchmark models to ~/models/bench/
# Usage: ./download-bench-models.sh

set -euo pipefail

DEST_DIR="$HOME/models/bench"
TOTAL=22

# Array: index, repo, remote_glob, local_name
declare -a MODELS=(
  "1|unsloth/Qwen3.5-9B-GGUF|*Q4_K_M.gguf|Qwen3.5-9B-Q4_K_M.gguf"
  "2|unsloth/Qwen3-8B-GGUF|*Q4_K_M.gguf|Qwen3-8B-Q4_K_M.gguf"
  "3|NousResearch/Hermes-2-Pro-Llama-3-8B-GGUF|*Q4_K_M.gguf|Hermes-2-Pro-Llama-3-8B-Q4_K_M.gguf"
  "4|bartowski/Ministral-8B-Instruct-2410-GGUF|*Q4_K_M.gguf|Ministral-8B-Instruct-2410-Q4_K_M.gguf"
  "5|bartowski/granite-3.1-8b-instruct-GGUF|*Q4_K_M.gguf|granite-3.1-8b-instruct-Q4_K_M.gguf"
  "6|bartowski/Meta-Llama-3.1-8B-Instruct-GGUF|*Q4_K_M.gguf|Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
  "7|bartowski/Qwen2.5-7B-Instruct-GGUF|*Q4_K_M.gguf|Qwen2.5-7B-Instruct-Q4_K_M.gguf"
  "8|bartowski/Mistral-7B-Instruct-v0.3-GGUF|*Q4_K_M.gguf|Mistral-7B-Instruct-v0.3-Q4_K_M.gguf"
  "9|unsloth/Phi-4-mini-instruct-GGUF|*Q4_K_M.gguf|Phi-4-mini-instruct-Q4_K_M.gguf"
  "10|bartowski/Dolphin3.0-Llama3.1-8B-GGUF|*Q4_K_M.gguf|Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf"
  "11|unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF|*Q4_K_M.gguf|DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf"
  "12|unsloth/Qwen3.5-4B-GGUF|*Q4_K_M.gguf|Qwen3.5-4B-Q4_K_M.gguf"
  "13|unsloth/Qwen3-4B-GGUF|*Q4_K_M.gguf|Qwen3-4B-Q4_K_M.gguf"
  "14|ggml-org/SmolLM3-3B-GGUF|*Q4_K_M.gguf|SmolLM3-3B-Q4_K_M.gguf"
  "15|bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF|*Q4_K_M.gguf|DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf"
  "16|unsloth/Qwen3.5-2B-GGUF|*Q4_K_M.gguf|Qwen3.5-2B-Q4_K_M.gguf"
  "17|bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF|*Q6_K.gguf|DeepSeek-R1-Distill-Qwen-1.5B-Q6_K.gguf"
  # --- Q5_K_M variants for small models (quality comparison) ---
  "18|unsloth/Qwen3.5-4B-GGUF|*Q5_K_M.gguf|Qwen3.5-4B-Q5_K_M.gguf"
  "19|unsloth/Qwen3-4B-GGUF|*Q5_K_M.gguf|Qwen3-4B-Q5_K_M.gguf"
  "20|ggml-org/SmolLM3-3B-GGUF|*Q5_K_M.gguf|SmolLM3-3B-Q5_K_M.gguf"
  "21|unsloth/Qwen3.5-2B-GGUF|*Q5_K_M.gguf|Qwen3.5-2B-Q5_K_M.gguf"
  "22|unsloth/Phi-4-mini-instruct-GGUF|*Q5_K_M.gguf|Phi-4-mini-instruct-Q5_K_M.gguf"
)

mkdir -p "$DEST_DIR"

failed=()

for entry in "${MODELS[@]}"; do
  IFS='|' read -r idx repo glob local_name <<< "$entry"

  printf "\n[%s/%s] Downloading %s\n" "$idx" "$TOTAL" "$local_name"

  local_path="$DEST_DIR/$local_name"

  if [[ -f "$local_path" ]]; then
    size=$(du -h "$local_path" | cut -f1)
    echo "  SKIP (already exists, ${size})"
    continue
  fi

  # Temp dir: download there, then rename to local_name
  tmp_dir=$(mktemp -d)

  if hf download "$repo" --include "$glob" --local-dir "$tmp_dir" 2>&1; then
    downloaded_file=$(ls "$tmp_dir"/*.gguf 2>/dev/null | head -1)
    if [[ -z "$downloaded_file" ]]; then
      echo "  ERROR: No file downloaded from $repo with pattern $glob"
      failed+=("$local_name (no file found)")
      continue
    fi

    # Verify size is non-zero
    if [[ ! -s "$downloaded_file" ]]; then
      echo "  ERROR: Downloaded file is empty"
      failed+=("$local_name (empty file)")
      continue
    fi

    mv "$downloaded_file" "$local_path"
    size=$(du -h "$local_path" | cut -f1)
    echo "  DONE → ${local_name} (${size})"
  else
    echo "  ERROR: hf download failed for $repo"
    failed+=("$local_name")
  fi

  rm -rf "$tmp_dir"
done

echo ""
echo "========================================"
echo "Download complete"
echo "========================================"

if [[ -d "$DEST_DIR" ]]; then
  echo ""
  ls -lhS "$DEST_DIR"/*.gguf 2>/dev/null | awk '{print "  " $5 "  " $9}' | while read -r size path; do
    echo "  ${size}  $(basename "$path")"
  done
  count=$(ls "$DEST_DIR"/*.gguf 2>/dev/null | wc -l)
  total_size=$(du -sh "$DEST_DIR" 2>/dev/null | cut -f1)
  echo ""
  echo "  Models: ${count}/${TOTAL}  |  Total: ${total_size}"
fi

if [[ ${#failed[@]} -gt 0 ]]; then
  echo ""
  echo "FAILED (${#failed[@]}):"
  for f in "${failed[@]}"; do
    echo "  - $f"
  done
  exit 1
fi

echo ""
echo "All ${TOTAL} models downloaded successfully."
