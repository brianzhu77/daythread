# Daythread — MVP specs

产品名：Daythread，用户于 2026-10-14 确认。

**当前代码（2026-10-25，shot 1）**：存储模型已收敛为 Page（含编辑器文档）与 Task 两种记录，其余全部从页面文档推导；见 [docs/architecture/model-v2.md](docs/architecture/model-v2.md)。下文规格是历史记录。
版本：v0.1 · 2026-10-13
状态：产品规格初稿，尚未实现。用户明确的约束与为使规格可执行而提出的默认规则分别标注。

一个以每日可编辑页面为入口的个人 Web app：记录事情、安排未来、回顾今天，并保存和引用手动收集的资料。

## 阅读顺序

| 文档 | 回答的问题 |
| --- | --- |
| [00 · 范围与决策](docs/specs/00-scope.md) | 做什么、暂缓什么、哪些是试验默认值 |
| [01 · 流程与交互](docs/specs/01-flows-and-ux.md) | 用户每天怎样使用，编辑、引用、暂放怎样运转 |
| [02 · 数据与状态](docs/specs/02-domain-and-state.md) | 什么持续存在，日期、状态、跨日与引用怎样保持一致 |
| [03 · AI 契约](docs/specs/03-ai-contract.md) | AI 接收什么、可以提出什么、失败与误判怎样处理 |
| [04 · 验收与试用](docs/specs/04-acceptance.md) | 怎样判断实现正确、真实使用有没有价值 |
| [05 · 目录与交付](docs/specs/05-delivery.md) | 项目怎样组织、按什么顺序实现、实施前还有什么条件 |

本目录内的规格是后续实现的统一依据。此前的讨论文档是探索记录；出现差异时，以本目录及之后记录的明确修订为准。具体试验默认值可在使用后调整，不应误写为用户已经逐项确认。

## 两条必须跑通的循环

```text
行动：自然语言输入 → 保存事项 → 今日页 → 完成/调整 → review → 次日接续
资料：手动收集 → 独立页面 → 查找与引用 → 在每日行动中使用 → 留下结论
```

## 当前实际目录

```text
daythread/
├── README.md
└── docs/
    └── specs/
        ├── 00-scope.md
        ├── 01-flows-and-ux.md
        ├── 02-domain-and-state.md
        ├── 03-ai-contract.md
        ├── 04-acceptance.md
        └── 05-delivery.md
```

后续开发目录与技术方案已在交付文档中规划，当前不创建空应用或安装依赖。用户已确定 TanStack Start + TypeScript、Supabase，以及通过 OpenRouter 调用 OpenAI GPT 系列；具体模型 ID 可配置。BlockNote 仍为编辑器建议，尚未安装或验证。
