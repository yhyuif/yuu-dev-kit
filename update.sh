#!/usr/bin/env bash
set -euo pipefail

PROJECT_INIT_DIR="${PROJECT_INIT_DIR:-$HOME/project-init}"
BASE_DIR="$PROJECT_INIT_DIR/base"

echo "============================================"
echo "  project-init — 同步模板升级"
echo "============================================"
echo ""

# --- 检查是否由 project-init 创建 ---
if [ ! -f .project-init.json ]; then
  echo "❌ 当前目录不是由 project-init 创建的项目（缺少 .project-init.json）"
  exit 1
fi

PROJECT_NAME=$(jq -r '.project_name // "unknown"' .project-init.json 2>/dev/null || echo "unknown")
OLD_COMMIT=$(jq -r '.template_commit // "unknown"' .project-init.json 2>/dev/null || echo "unknown")
NEW_COMMIT=$(cd "$PROJECT_INIT_DIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")

echo "项目: $PROJECT_NAME"
echo "模板版本: $OLD_COMMIT → $NEW_COMMIT"

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ] && [ "$OLD_COMMIT" != "unknown" ]; then
  echo "✅ 已是最新版本"
  exit 0
fi

echo ""

# --- 对比并同步 ---
SYNCED=()
SKIPPED=()
CONFLICTS=()

# cognitive-scaffold/scripts/ 下的文件 → 直接覆盖
if [ -d "$BASE_DIR/cognitive-scaffold/scripts" ]; then
  for src in "$BASE_DIR"/cognitive-scaffold/scripts/*; do
    if [ -f "$src" ]; then
      fname=$(basename "$src")
      dest="cognitive-scaffold/scripts/$fname"
      if [ -f "$dest" ]; then
        if ! diff -q "$src" "$dest" > /dev/null 2>&1; then
          cp "$src" "$dest"
          SYNCED+=("$dest")
        fi
      else
        cp "$src" "$dest"
        SYNCED+=("$dest (新增)")
      fi
    fi
  done
fi

# docs/adr/template.md → 直接覆盖
if [ -f "$BASE_DIR/docs/adr/template.md" ]; then
  dest="docs/adr/template.md"
  if [ -f "$dest" ]; then
    if ! diff -q "$BASE_DIR/docs/adr/template.md" "$dest" > /dev/null 2>&1; then
      cp "$BASE_DIR/docs/adr/template.md" "$dest"
      SYNCED+=("$dest")
    fi
  fi
fi

# AGENTS.md → 显示差异，询问
if [ -f "$BASE_DIR/AGENTS.md" ]; then
  dest="AGENTS.md"
  if [ -f "$dest" ]; then
    if ! diff -q "$BASE_DIR/AGENTS.md" "$dest" > /dev/null 2>&1; then
      echo "---"
      echo "⚠️  AGENTS.md 模板有更新:"
      echo ""
      diff -u "$dest" "$BASE_DIR/AGENTS.md" || true
      echo ""
      read -p "是否用新模板覆盖 AGENTS.md? [y/N]: " answer
      if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
        cp "$BASE_DIR/AGENTS.md" "$dest"
        SYNCED+=("$dest")
      else
        SKIPPED+=("$dest (保留本地版本)")
      fi
    fi
  fi
fi

# CLAUDE.md → 显示差异，询问
if [ -f "$BASE_DIR/CLAUDE.md" ]; then
  dest="CLAUDE.md"
  if [ -f "$dest" ]; then
    if ! diff -q "$BASE_DIR/CLAUDE.md" "$dest" > /dev/null 2>&1; then
      echo "---"
      echo "⚠️  CLAUDE.md 模板有更新:"
      echo ""
      diff -u "$dest" "$BASE_DIR/CLAUDE.md" || true
      echo ""
      read -p "是否用新模板更新 CLAUDE.md? [y/N]: " answer
      if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
        cp "$BASE_DIR/CLAUDE.md" "$dest"
        SYNCED+=("$dest")
      else
        SKIPPED+=("$dest (保留本地版本)")
      fi
    fi
  fi
fi

# --- 更新版本记录 ---
TEMP_JSON=$(mktemp)
jq --arg commit "$NEW_COMMIT" '.template_commit = $commit' .project-init.json > "$TEMP_JSON"
mv "$TEMP_JSON" .project-init.json

# --- 打印摘要 ---
echo ""
echo "============================================"
echo "  同步完成"
echo "============================================"

if [ ${#SYNCED[@]} -gt 0 ]; then
  echo "✅ 已同步:"
  for f in "${SYNCED[@]}"; do
    echo "   $f"
  done
fi

if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "⏭️  已跳过:"
  for f in "${SKIPPED[@]}"; do
    echo "   $f"
  done
fi

if [ ${#SYNCED[@]} -eq 0 ] && [ ${#SKIPPED[@]} -eq 0 ]; then
  echo "✅ 无需更新"
fi

echo ""
echo "模板版本已更新: $OLD_COMMIT → $NEW_COMMIT"
