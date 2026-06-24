#!/usr/bin/env bash
set -euo pipefail

KIT_DIR="${YUU_DEV_KIT:-$HOME/yuu-dev-kit}"
BASE_DIR="$KIT_DIR/base"
MODULES_DIR="$KIT_DIR/modules"
CONVENTIONS_DIR="$KIT_DIR/conventions"
TARGET_DIR="${1:-$(pwd)}"

# ═══════════════════════════════════════════════
#  问答
# ═══════════════════════════════════════════════

echo "============================================"
echo "  yuu-dev-kit — 创建新项目"
echo "============================================"
echo ""

PROJECT_NAME=$(basename "$TARGET_DIR")
read -p "项目名 [$PROJECT_NAME]: " INPUT_NAME
PROJECT_NAME="${INPUT_NAME:-$PROJECT_NAME}"

echo ""
echo "项目语言:"
echo "  1) Node.js"
echo "  2) Python"
echo "  3) 其他（最小初始化）"
read -p "选择 [1]: " PROJECT_LANG
PROJECT_LANG="${PROJECT_LANG:-1}"

# ═══════════════════════════════════════════════
#  第二层：基础设施
# ═══════════════════════════════════════════════

INSTALL_LOGGER="n"
INSTALL_ERRORS="n"
INSTALL_HEALTH="n"

if [ "$PROJECT_LANG" = "1" ] || [ "$PROJECT_LANG" = "2" ]; then
  echo ""
  echo "━━━ 第二层：基础设施（按需选装）━━━"

  read -p "结构化日志 (logger)? [Y/n]: " ans
  INSTALL_LOGGER="${ans:-y}"

  read -p "统一错误处理 (RFC 9457)? [y/N]: " ans
  INSTALL_ERRORS="${ans:-n}"

  read -p "健康检查端点 (/livez + /readyz)? [y/N]: " ans
  INSTALL_HEALTH="${ans:-n}"
fi

# ═══════════════════════════════════════════════
#  第三层：约定包
# ═══════════════════════════════════════════════

INSTALL_GIT="n"
INSTALL_TESTING="n"
INSTALL_SECURITY="n"

echo ""
echo "━━━ 第三层：约定包（选装）━━━"

read -p "Git 约定 (.gitmessage + PR 模板)? [y/N]: " ans
INSTALL_GIT="${ans:-n}"

read -p "测试策略文档 (TESTING.md)? [y/N]: " ans
INSTALL_TESTING="${ans:-n}"

read -p "安全策略 (SECURITY.md)? [y/N]: " ans
INSTALL_SECURITY="${ans:-n}"

# ═══════════════════════════════════════════════
#  确认
# ═══════════════════════════════════════════════

echo ""
echo "============================================"
echo "  第一层（必装）: 认知支架 + Memory Bank + ADR + Principles"
echo "  第二层（选装）: logger=$INSTALL_LOGGER errors=$INSTALL_ERRORS health=$INSTALL_HEALTH"
echo "  第三层（选装）: git=$INSTALL_GIT testing=$INSTALL_TESTING security=$INSTALL_SECURITY"
echo "  目标目录: $TARGET_DIR"
echo "============================================"
read -p "确认创建? [Y/n]: " CONFIRM
if [ "$CONFIRM" = "n" ] || [ "$CONFIRM" = "N" ]; then
  echo "已取消"
  exit 0
fi

# ═══════════════════════════════════════════════
#  第一层：复制核心模板
# ═══════════════════════════════════════════════

mkdir -p "$TARGET_DIR"

if [ -n "$(ls -A "$TARGET_DIR" 2>/dev/null)" ]; then
  echo ""
  echo "⚠️  目标目录 $TARGET_DIR 非空"
  ls -la "$TARGET_DIR" | tail -5
  echo ""
  read -p "继续将覆盖同名文件，确认? [y/N]: " OVERWRITE
  if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
    echo "已取消"; exit 0
  fi
fi

cd "$TARGET_DIR"

echo ""
echo "📁 第一层：核心模板..."
cp -r "$BASE_DIR"/* ./
if [ -f "$BASE_DIR/.gitignore" ]; then cp "$BASE_DIR/.gitignore" ./; fi
echo "✅ 认知支架 + Memory Bank + ADR + Principles 已就位"

# ═══════════════════════════════════════════════
#  第二层：复制基础设施模块
# ═══════════════════════════════════════════════

LANG_DIR=""
case "$PROJECT_LANG" in
  1) LANG_DIR="node" ;;
  2) LANG_DIR="python" ;;
esac

if [ -n "$LANG_DIR" ]; then
  echo ""
  echo "📁 第二层：基础设施模块..."

  mkdir -p lib

  for mod in logger errors health; do
    varname="INSTALL_$(echo $mod | tr '[:lower:]' '[:upper:]')"
    if [ "${!varname}" = "y" ] || [ "${!varname}" = "Y" ]; then
      ext="js"
      [ "$LANG_DIR" = "python" ] && ext="py"
      src="$MODULES_DIR/$LANG_DIR/lib/$mod.$ext"
      if [ -f "$src" ]; then
        cp "$src" "lib/$mod.$ext"
        echo "  ✅ lib/$mod.$ext"
      else
        echo "  ⚠️  $mod.$ext 模板缺失，跳过"
      fi
    fi
  done
fi

# ═══════════════════════════════════════════════
#  第三层：复制约定包
# ═══════════════════════════════════════════════

echo ""
echo "📁 第三层：约定包..."

if [ "$INSTALL_GIT" = "y" ] || [ "$INSTALL_GIT" = "Y" ]; then
  mkdir -p .github
  cp "$CONVENTIONS_DIR/git/.gitmessage" ./ 2>/dev/null && echo "  ✅ .gitmessage" || true
  cp "$CONVENTIONS_DIR/git/PULL_REQUEST_TEMPLATE.md" .github/ 2>/dev/null && echo "  ✅ .github/PULL_REQUEST_TEMPLATE.md" || true
  git config --local commit.template .gitmessage 2>/dev/null || true
fi

if [ "$INSTALL_TESTING" = "y" ] || [ "$INSTALL_TESTING" = "Y" ]; then
  cp "$CONVENTIONS_DIR/testing/TESTING.md" docs/ 2>/dev/null && echo "  ✅ docs/TESTING.md" || true
fi

if [ "$INSTALL_SECURITY" = "y" ] || [ "$INSTALL_SECURITY" = "Y" ]; then
  cp "$CONVENTIONS_DIR/security/SECURITY.md" ./ 2>/dev/null && echo "  ✅ SECURITY.md" || true
fi

# ═══════════════════════════════════════════════
#  写入 .project-init.json
# ═══════════════════════════════════════════════

TEMPLATE_COMMIT=$(cd "$KIT_DIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")
cat > .project-init.json << EOF
{
  "version": "2",
  "kit": "yuu-dev-kit",
  "project_name": "$PROJECT_NAME",
  "language": "$PROJECT_LANG",
  "modules": {
    "logger": "$INSTALL_LOGGER",
    "errors": "$INSTALL_ERRORS",
    "health": "$INSTALL_HEALTH"
  },
  "conventions": {
    "git": "$INSTALL_GIT",
    "testing": "$INSTALL_TESTING",
    "security": "$INSTALL_SECURITY"
  },
  "template_commit": "$TEMPLATE_COMMIT",
  "initialized_at": "$(date +%Y-%m-%d)"
}
EOF

# ═══════════════════════════════════════════════
#  安装依赖
# ═══════════════════════════════════════════════

echo ""
echo "📦 安装依赖..."

case "$PROJECT_LANG" in
  1)
    if [ ! -f package.json ]; then
      npm init -y --silent 2>/dev/null || true
    fi
    npm install -D dependency-cruiser 2>&1 | tail -1
    echo "  ✅ dependency-cruiser"

    if [ "$INSTALL_LOGGER" = "y" ] || [ "$INSTALL_LOGGER" = "Y" ]; then
      npm install pino pino-pretty 2>&1 | tail -1
      echo "  ✅ pino + pino-pretty"
    fi
    ;;
  2)
    echo "⚠️  Python 依赖请手动安装: pip install dependency-cruiser structlog"
    ;;
esac

# ═══════════════════════════════════════════════
#  首次扫描
# ═══════════════════════════════════════════════

echo ""
echo "🔍 运行认知架构首次扫描..."
if [ -f cognitive-scaffold/scripts/cognitive-map.js ]; then
  node cognitive-scaffold/scripts/cognitive-map.js --scan-only 2>/dev/null || echo "⚠️  首次扫描跳过（可能缺少源文件）"
fi

# ═══════════════════════════════════════════════
#  Git 初始化
# ═══════════════════════════════════════════════

echo ""
echo "🔧 初始化 Git..."
if [ ! -d .git ]; then git init; fi
git add -A
git commit -m "init: yuu-dev-kit scaffold

Co-Authored-By: Claude <noreply@anthropic.com>" 2>/dev/null || git commit -m "init: yuu-dev-kit scaffold" 2>/dev/null || echo "⚠️  Git commit 跳过（可能需要配置 git 用户）"

# ═══════════════════════════════════════════════
#  完成
# ═══════════════════════════════════════════════

echo ""
echo "============================================"
echo "  ✅ yuu-dev-kit — $PROJECT_NAME 初始化完成"
echo "============================================"
echo ""

echo "📦 第一层（核心）:"
echo "  AGENTS.md / CLAUDE.md       AI 行为规则"
echo "  docs/                       Memory Bank (6 文件) + ADR + Principles"
echo "  cognitive-scaffold/         架构图 + 策展 + 检索"

if [ "$INSTALL_LOGGER" = "y" ] || [ "$INSTALL_LOGGER" = "Y" ]; then
  echo "📦 第二层（基础设施）:"
  echo "  lib/logger.js               结构化日志 (pino)"
fi
if [ "$INSTALL_ERRORS" = "y" ] || [ "$INSTALL_ERRORS" = "Y" ]; then
  [ "$INSTALL_LOGGER" != "y" ] && echo "📦 第二层（基础设施）:"
  echo "  lib/errors.js               统一错误处理 (RFC 9457)"
fi
if [ "$INSTALL_HEALTH" = "y" ] || [ "$INSTALL_HEALTH" = "Y" ]; then
  [ "$INSTALL_LOGGER" != "y" ] && [ "$INSTALL_ERRORS" != "y" ] && echo "📦 第二层（基础设施）:"
  echo "  lib/health.js               健康检查 (/livez + /readyz)"
fi

if [ "$INSTALL_GIT" = "y" ] || [ "$INSTALL_TESTING" = "y" ] || [ "$INSTALL_SECURITY" = "y" ]; then
  echo "📦 第三层（约定包）:"
  [ "$INSTALL_GIT" = "y" ] && echo "  .gitmessage + PR 模板"
  [ "$INSTALL_TESTING" = "y" ] && echo "  docs/TESTING.md"
  [ "$INSTALL_SECURITY" = "y" ] && echo "  SECURITY.md"
fi

echo ""
echo "下一步:"
echo "  1. cd $PROJECT_NAME"
echo "  2. 启动认知架构图: screen -dmS cognitive-map node cognitive-scaffold/scripts/cognitive-map.js --port 3458"
echo "  3. 浏览器打开 http://localhost:3458"
echo ""
