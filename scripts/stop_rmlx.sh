#!/usr/bin/env bash
# -------------------------------------------------
# 关闭 Rapid‑MLX (rmlx) 后端
# -------------------------------------------------

cd "$(dirname "$(realpath "$0")")/.."

# 如果之前保存了 PID，直接 kill
if [[ -f ".rmlx.pid" ]]; then
  PID=$(cat .rmlx.pid)
  echo "🛑 正在停止 Rapid‑MLX (PID=$PID)..."
  kill "$PID" && rm -f .rmlx.pid
  echo "✅ 已停止。"
else
  # 否则尝试使用 pkill
  echo "⚠️ 未找到 PID 文件，尝试使用 pkill..."
  pkill -f "^rmlx" && echo "✅ 已通过 pkill 停止。" || echo "⚠️ 未找到 rmlx 进程。"
fi
