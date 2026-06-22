# AGENTS.md

> 本文件是跨 AI 编码工具的通用行为规则。
> Claude Code 通过 CLAUDE.md 的 `@AGENTS.md` 导入。

## never（铁律，绝对不能做）
- 引入新依赖（npm/pip 等）前先讨论确认
- 删除数据、修改认证/密钥逻辑前先确认
- 在生产环境直接运行破坏性操作

## always（每次自动执行，不等用户开口）
- Session 开始 → 读 Memory Bank（`docs/activeContext.md` + `docs/projectbrief.md` + `docs/productContext.md` + `docs/techContext.md` + `docs/systemPatterns.md` + `docs/project-status.md`）
- Session 结束 → 更新 `docs/activeContext.md`（记录完成了什么、卡在哪、下一步）
- 运行方式变化（命令、端口、定时任务频率等）→ 同步更新 `docs/techContext.md`
- 架构模式变化（分层调整、新增设计模式）→ 同步更新 `docs/systemPatterns.md`
- 产品需求/范围变化 → 同步更新 `docs/productContext.md`
- 改动 >1 个文件或 >50 行代码 → 先写设计计划，用户确认后再执行
- 写完代码 → 逐入口点验证（列出所有受影响入口，逐个测试）
- 验证通过 → 多维度代码审查
- Commit 时 → 规范的 commit message
- 代码改动影响模块职责/数据流/存储方式 → 在 `docs/adr/` 生成 ADR
- 新增模块 → 文件顶部写 JSDoc（`@module` `@brief` `@layer`）
- 主动调用合适的 skill/tool，不等用户开口
- 修复 tracking 文件中的条目后，同步更新文件状态

## ask（不确定时停下来问我）
- 删除 >50 行代码
- 改变模块之间的依赖关系
- 运行批量操作（大批量文件修改、数据库迁移）
- 改动核心引擎/算法的参数或阈值

## 通用设计原则
- 输入输出明确、逻辑固定 → 代码做，把结果注入 AI
- 需要跨维度综合判断 → AI 做，代码只提供事实数据
- 任何涉及数字的计算 → 用 `python3 -c` 或 `node -e` 验证，不心算
