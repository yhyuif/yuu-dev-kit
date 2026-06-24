#!/usr/bin/env bash
set -euo pipefail

echo "╔══════════════════════════════════════════╗"
echo "║  yuu-dev-kit — 一键安装                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""

KIT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. 配置 npm 全局路径（不需要 sudo）
if [ ! -d "$HOME/.npm-global" ]; then
  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global"
  echo "✅ npm 全局路径设为 ~/.npm-global"
fi

# 2. 确保 ~/.npm-global/bin 在 PATH 中
if ! echo "$PATH" | grep -q ".npm-global/bin"; then
  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
  echo "✅ 已添加到 ~/.bashrc"
fi
if [ -f "$HOME/.zshrc" ]; then
  if ! grep -q ".npm-global/bin" "$HOME/.zshrc" 2>/dev/null; then
    echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.zshrc"
    echo "✅ 已添加到 ~/.zshrc"
  fi
fi

export PATH="$HOME/.npm-global/bin:$PATH"

# 3. 链接 yyu CLI
cd "$KIT_DIR/cli"
echo ""
echo "📦 安装 yyu CLI..."
npm link 2>/dev/null || sudo npm link 2>/dev/null || {
  echo "⚠️  npm link 失败，请尝试: cd ~/yuu-dev-kit/cli && npm link"
}

# 4. 验证
echo ""
if command -v yyu &>/dev/null; then
  echo "✅ yyu CLI 安装成功"
  yyu
else
  echo "⚠️  yyu 未在 PATH 中，请重启终端或执行: source ~/.bashrc"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ yuu-dev-kit 安装完成                ║"
echo "║     下次直接: yyu create my-project     ║"
echo "╚══════════════════════════════════════════╝"
