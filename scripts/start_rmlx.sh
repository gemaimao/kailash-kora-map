#!/usr/bin/env bash
# -------------------------------------------------
# 启动 Rapid‑MLX (rmlx) 后端并打开 Chatbox 前端
# -------------------------------------------------

# 1️⃣ 进入项目根目录
cd "$(dirname "$(realpath "$0")")/.."

# 2️⃣（可选）激活虚拟环境
if [[ -f "venv/bin/activate" ]]; then
    source venv/bin/activate
fi

# 3️⃣ 启动 rmlx（假设 rmlx 提供 `rmlx serve` 命令）
#    若实际启动方式不同，请自行替换下面的命令。
echo "🚀 正在启动 Rapid‑MLX 后端..."
nohup rmlx serve --host 127.0.0.1 --port 8000 > rmlx.log 2>&1 &
RMLX_PID=$!
echo "✅ Rapid‑MLX 已在后台运行，PID=$RMLX_PID"

# 4️⃣ 打开 Chatbox 前端（假设是一个本地网页，可通过默认浏览器打开）
CHATBOX_URL="http://127.0.0.1:8000/chatbox"
echo "🖥️ 正在打开 Chatbox 前端：$CHATBOX_URL"
open "$CHATBOX_URL"

# 5️⃣ 将 PID 写入文件，供 stop 脚本使用
echo "$RMLX_PID" > .rmlx.pid
echo "🎉 完成！现在可以在 Chatbox 中与本地模型对话。"
