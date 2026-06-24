# yuu-dev-kit

个人开发者 AI 辅助项目脚手架 — 三层模板体系，一条命令创建项目。

## 安装

```bash
git clone git@github.com:yhyuif/yuu-dev-kit.git ~/yuu-dev-kit
cd ~/yuu-dev-kit/cli && npm link
```

## 使用

```bash
yyu create my-project    # 创建新项目，交互问答
yyu update               # 同步模板升级（在已有项目中）
```

## 三层模板

| 层 | 内容 | 安装方式 |
|------|------|------|
| 第一层 | 认知支架 + Memory Bank + ADR + Principles | 必装 |
| 第二层 | logger / errors / health（按语言） | 问答勾选 |
| 第三层 | git 约定 / 测试策略 / 安全文档 | 问答勾选 |

## 更新模板

```bash
cd ~/yuu-dev-kit
git pull
# 然后在各项目中: yyu update
```
