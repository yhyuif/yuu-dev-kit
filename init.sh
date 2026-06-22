#!/usr/bin/env bash
set -euo pipefail

PROJECT_INIT_DIR="${PROJECT_INIT_DIR:-$HOME/project-init}"
BASE_DIR="$PROJECT_INIT_DIR/base"
TARGET_DIR="${1:-$(pwd)}"

echo "============================================"
echo "  project-init — 创建新项目"
echo "============================================"
echo ""

# --- 问答 ---
if [ "$TARGET_DIR" = "$(pwd)" ]; then
  PROJECT_NAME=$(basename "$TARGET_DIR")
else
  PROJECT_NAME=$(basename "$TARGET_DIR")
fi

read -p "项目名 [$PROJECT_NAME]: " INPUT_NAME
PROJECT_NAME="${INPUT_NAME:-$PROJECT_NAME}"

echo ""
echo "项目类型:"
echo "  1) Node.js / JavaScript"
echo "  2) Node.js / TypeScript"
echo "  3) Python"
echo "  4) 其他（最小初始化）"
read -p "选择 [1]: " PROJECT_TYPE
PROJECT_TYPE="${PROJECT_TYPE:-1}"

echo ""
echo "============================================"
echo "  初始化项目: $PROJECT_NAME"
echo "  类型: $PROJECT_TYPE"
echo "  目标目录: $TARGET_DIR"
echo "============================================"
read -p "确认创建? [Y/n]: " CONFIRM
if [ "$CONFIRM" = "n" ] || [ "$CONFIRM" = "N" ]; then
  echo "已取消"
  exit 0
fi

# --- 创建目标目录 ---
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

# --- 复制模板 ---
echo ""
echo "📁 复制模板文件..."

# 复制所有非隐藏文件
cp -r "$BASE_DIR"/* ./

# 复制隐藏文件（.gitignore）
if [ -f "$BASE_DIR/.gitignore" ]; then
  cp "$BASE_DIR/.gitignore" ./
fi

# --- 写入 .project-init.json ---
TEMPLATE_COMMIT=$(cd "$PROJECT_INIT_DIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")
cat > .project-init.json << EOF
{
  "version": "1",
  "project_name": "$PROJECT_NAME",
  "template_commit": "$TEMPLATE_COMMIT",
  "initialized_at": "$(date +%Y-%m-%d)"
}
EOF

echo "✅ 模板文件已复制"

# --- 安装依赖 ---
echo ""
echo "📦 安装依赖..."

case "$PROJECT_TYPE" in
  1|2)
    # Node.js 项目
    if [ ! -f package.json ]; then
      npm init -y --silent 2>/dev/null || true
    fi
    npm install -D dependency-cruiser 2>&1 | tail -1
    echo "✅ dependency-cruiser 已安装"
    ;;
  3)
    # Python 项目
    echo "⚠️  Python 项目暂不支持自动安装依赖"
    echo "   请手动安装: pip install dependency-cruiser 等效工具"
    ;;
  4)
    echo "⚠️  跳过依赖安装（最小模式）"
    ;;
esac

# --- Git 初始化 ---
echo ""
echo "🔧 初始化 Git..."

if [ ! -d .git ]; then
  git init
fi

git add -A
git commit -m "init: project-init scaffold

Co-Authored-By: Claude <noreply@anthropic.com>" 2>/dev/null || git commit -m "init: project-init scaffold" 2>/dev/null || echo "⚠️  Git commit 跳过（可能需要配置 git 用户）"

# --- 完成 ---
echo ""
echo "============================================"
echo "  ✅ 项目 $PROJECT_NAME 初始化完成"
echo "============================================"
echo ""
echo "已创建:"
echo "  cognitive-scaffold/  认知支架（架构图 + 策展）"
echo "  AGENTS.md            AI 行为规则"
echo "  CLAUDE.md            Claude Code 入口"
echo "  docs/activeContext.md 当前上下文（AI 自动维护）"
echo "  docs/adr/            架构决策记录"
echo "  docs/project-status.md 项目状态追踪"
echo ""
echo "下一步:"
echo "  1. cd $PROJECT_NAME"
echo "  2. 启动认知架构图: screen -dmS cognitive-map node cognitive-scaffold/scripts/cognitive-map.js"
echo "  3. 浏览器打开 http://localhost:3458"
echo "  4. 在 Claude Code 中说: 帮我给现有模块补上 JSDoc"
echo ""
