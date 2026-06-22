# project-init —— AI 规则

project-init 是一个项目脚手架。修改它的方式：

## 改动规则
- 修改 `base/` 下的模板文件 → 正常改，commit 时说明影响范围
- 修改 `init.sh` / `update.sh` → 先确认逻辑，这两个脚本直接影响所有下游项目
- 修改 `cognitive-scaffold/scripts/cognitive-map.js` → 确保不破坏 API 兼容性，下游项目通过 update.sh 同步

## 设计原则
- `base/` 是复制给新项目的——里面的文件要通用，不包含任何 project-init 自身的信息
- `curation.json` 初始必须为 `{}`，这是用户数据，模板不能预填
- AGENTS.md 里的规则要精选——只放经过验证的、跨项目通用的规则
