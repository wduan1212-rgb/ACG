#!/bin/bash
# Dumate Studio 一键启动（双击运行）
cd "$(dirname "$0")"

# Finder/Terminal 双击 .command 时通常不会加载 zsh 配置，
# 需要手动补上 Homebrew 和常见 Node 安装路径。
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js，然后重新双击 start.command。"
  echo "下载地址：https://nodejs.org/"
  read -r -p "按回车退出..."
  exit 1
fi

echo "Dumate Studio 启动中… (Ctrl+C 退出)"
( sleep 1 && open "http://localhost:4173" ) &
exec node tools/serve.mjs 4173
