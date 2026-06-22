# project-init

Vibe coding 项目脚手架 —— 初始化即带外部认知支架。

## 快速开始

```bash
# 创建新项目
mkdir my-project && cd my-project
bash ~/project-init/init.sh

# 同步模板升级（在已有项目中）
bash ~/project-init/update.sh
```

## 包含什么

| 组件 | 用途 |
|------|------|
| `AGENTS.md` | 跨工具 AI 行为规则（always/ask/never） |
| `CLAUDE.md` | Claude Code 入口 |
| `cognitive-scaffold/` | 认知支架核心（架构图 + 策展 + ADR 浏览） |
| `docs/activeContext.md` | 当前上下文（AI 自动维护） |
| `docs/adr/` | 架构决策记录 |

## 更新模板

```bash
cd ~/project-init
# 修改 base/ 下的模板文件
git commit -m "feat: 更新 xxx"
# 然后在各项目中运行 update.sh 同步
```
