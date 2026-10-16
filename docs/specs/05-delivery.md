# 05 · 目录与交付

## 位置与命名

产品名已于 2026-10-14 确认为 **Daythread**。正式规格位于 `/Users/dogrod/Developer/daythread/`，作为后续开发的项目根目录；目录名已与产品名统一。

规格最初写于对话工作区 `outputs/daily-pages/`，已按用户要求于 2026-10-14 整体移入现有代码目录 `~/Developer/`（单数）。迁移时均校验全部 7 个文件的内容哈希一致；文档中的当前目录名和路径已同步更新。当前尚未创建应用代码或初始化仓库。

此前的 `personal-app-discovery.md`、`product-stress-test.md`、`mvp-validation-plan.md`、`mvp-v0.1.md` 仍在 `/Users/dogrod/Documents/Codex/2026-10-13/wo-j/outputs/`，保留为讨论历史。本目录规格是最新的实施依据。

## 实际文档结构

```text
daythread/
├── README.md                       # 索引与两条循环
└── docs/
    └── specs/
        ├── 00-scope.md              # 已确认需求、范围、默认值
        ├── 01-flows-and-ux.md       # 使用流程与交互结果
        ├── 02-domain-and-state.md   # 持续身份、日期、状态、引用
        ├── 03-ai-contract.md        # 模型输入输出与应用边界
        ├── 04-acceptance.md         # 功能验收和真实试用
        └── 05-delivery.md           # 本文件
```

不再拆更多专题文档，避免首轮规格维护成本高于产品本身。

## 后续开发目录规划

下面是实施时的职责划分，不是已创建的应用，也不要求某个框架遵守完全相同的路径。

```text
daythread/
├── README.md
├── docs/specs/
├── src/                            # 实施时新增
│   ├── routes/                     # TanStack Router 路由与布局
│   ├── server/                     # Start 服务端函数、会话验证与操作入口
│   ├── features/
│   │   ├── daily/                  # 日期页、草稿、review
│   │   ├── capture/                # 自然语言录入与回执
│   │   ├── pages/                  # 基础编辑器、资料列表、引用选择
│   │   └── agenda/                 # 事项操作、未来列表与暂放找回
│   ├── domain/                     # 日期、状态转换、每日事实、引用规则
│   ├── storage/                    # Supabase 客户端、RPC、查询与导出
│   └── ai/                         # 简单上下文、模型适配、schema 校验
├── supabase/
│   └── migrations/                 # 表、约束、RLS、原子写入函数
└── tests/                          # 领域规则与关键浏览器流程
    └── fixtures/                   # 日期与状态固定的测试资料
```

首版保持单应用，不建立 monorepo、插件系统、多服务或通用编辑器平台。共享 UI 只有出现实际复用时再提取，不预建庞大组件库。

## 交付顺序

| 阶段 | 交付物 | 完成条件 |
| --- | --- | --- |
| M0 · 实现条件 | Supabase 项目与最小登录、应用运行方式、模型与配置 | 已确定 TanStack Start + TS、Supabase、OpenRouter；连接和实际调用仍需验证。 |
| M1 · 内容基础 | Pages、基础 Blocks、保存、搜索、页面/段落引用、反向引用 | P01–P13 中相关内容规则通过；资料循环可手动跑通。 |
| M2 · 事项与日期 | Tasks/Events、日期页、改期/完成/暂放、未来列表 | A01、A09–A18 与日期核心规则通过；跨日不复制。 |
| M3 · 简单 AI | 原话保存、结构化录入、校验、回执、歧义处理 | A02–A08，X01–X11 关键失败路径通过，真实调用能落库。 |
| M4 · 每日闭环 | 草稿、review、次日接续、人工编辑合并 | R01–R07 通过，行动与资料能在同一 daily note 使用。 |
| M5 · 可用性验证 | JSON 导出、关键浏览器检查、5–7 天真实试用 | 关键数据风险修复，记录纠正与使用摩擦，再决定下一项范围。 |

阶段是建设顺序，不代表要分别发布或等待每阶段单独批准；用户授权实施后可连续完成。真实试用前两个循环都必须可用。

## 技术实现起点

TanStack Start + TypeScript、Supabase、OpenRouter API 与 OpenAI GPT 系列由用户确定。其余技术项是实施建议；具体依赖版本在开始实现时核对并锁定，不是已安装环境。

| 部分 | 建议 | 目的 |
| --- | --- | --- |
| Web 应用 | TanStack Start（React）+ TypeScript，TanStack Router | 用户已确认；界面和服务端函数放在同一项目。 |
| 请求状态 | TanStack Query | 建议统一查询缓存、保存反馈和失效刷新，不引入第二份持久数据。 |
| 编辑器 | BlockNote，限定基础类型；为 task/event/reference 定义自有块 | 复用基础编辑能力，保留稳定 ID 和可引用内容。 |
| 持久化 | Supabase Postgres、版本化 SQL 迁移、原子写入 RPC | 用户已确定 Supabase；页面、任务、引用保存在同一数据源。 |
| 身份 | 最小 Supabase Auth 登录与工作区所有权 | 实施建议：只服务本人试用，不建立协作或邀请系统。 |
| 模型 | 服务端调用 OpenRouter，OpenAI GPT 系列 | 用户已选择；模型 ID 配置化。 |
| 校验 | 一套应用 schema 同时用于验证模型提案与转换请求 schema | 避免前端、服务端和模型协议各自漂移。 |
| 验证 | 领域规则单测、关键浏览器流程、真实模型试用 | 重点覆盖日期、引用、幂等、冲突与两个循环。 |

先保持单用户试用。应用可以本机启动并连接所选 Supabase 项目，是否远程部署及常用设备在实施时确定；不把数据默认保存在本机应用目录。编辑器与缓存库仍属建议，不代表已做兼容性验证。

### 编辑器和数据的映射

- Page 与 Block 表是持久数据，编辑器文档由对应 Blocks 组装；首版限制为单层，不引入另一份独立维护的完整正文 JSON。
- 保留 Block ID，编辑保存时提交有版本依据的差异；页面结构变更和关联引用在同一事务中处理。
- task/event 块保存实体 ID，状态从 Task/Event 读取；不在各份编辑器快照中独立保存完成状态。
- reference 块保存目标类型与 ID，显示预览并可定位；反向引用通过实际关系查出。
- 普通编辑不触发模型；录入、主动整理、草稿与 review 才调用模型。
- schema、关联约束、所有权、RLS、变更函数随 SQL 迁移保存。应用只在受控操作中修改关联数据；一次多对象变更经 RPC 在数据库事务内提交。

### 最小服务端操作

| 操作组 | 职责 |
| --- | --- |
| pages / blocks | 新建、读取、差异保存、软移除、恢复、版本检查。 |
| references / search | 标题与正文关键词查找、目标预览、反向引用、定位。 |
| tasks / events | 完成、取消、改期、暂放、恢复与条件撤销。 |
| daily | 日期唯一页、事实集合、接续候选、草稿准备与合入。 |
| captures / reviews | 先保存原文，调用模型，校验并应用提案或保留澄清。 |
| export | 导出含稳定 ID、时区与引用的 JSON。 |

不预建公共 API 或通用插件协议；浏览器通过 TanStack Start 服务端函数发起操作。服务端先验证 Supabase 会话和工作区权限，状态变更共用领域函数与数据库 RPC，模型调用不会绕过它们。正常数据操作使用当前用户身份，不使用管理员密钥代替访问验证。

### 录入的一次完整执行

```text
浏览器提交原话和操作 ID
  → Start 服务端函数验证当前用户
  → Supabase 保存 Capture
  → 读取有权限访问的工作区信息和版本
  → OpenRouter 调用指定 GPT 模型
  → 校验结构、日期、对象和版本
  → Supabase RPC 原子写入产物与 Change
  → 返回实际写入回执
  → 页面更新对应内容
```

首轮可使用一次服务端函数请求完成模型处理，Capture 先落库；请求中断后可按操作 ID 查询并重试。以数据库唯一键与版本校验保证只应用一次，不引入队列或后台 worker。数据库事务只包裹数据应用，不等待外部模型请求。

### 运行配置

实施时创建配置示例，用户在本地环境填写，不在此文档填真实值：

```text
OPENROUTER_API_KEY=<本地配置>
OPENROUTER_MODEL=<OpenRouter 上可用的完整 OpenAI 模型 ID>
VITE_SUPABASE_URL=<所选 Supabase 项目的 URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<项目的 publishable key>
DAYTHREAD_TIMEZONE=America/Vancouver
```

Supabase URL 和 publishable key 是客户端可用的项目配置，数据权限由登录身份与 RLS 决定。OpenRouter key 仅供 Start 服务端读取，不添加 `VITE_` 前缀。正常运行不要求在浏览器或应用配置中填写 Supabase 管理员凭证；迁移使用单独的授权开发流程。

模型 ID 不采用未经核对的“最新”别名。开始真实试用前，确认所选模型可用且支持 JSON Schema，再用真实录入做一次完整验证。当前不需要把 API key 发到聊天中。

### 最先交付的可见切片

先落实最小登录和 Supabase 表/访问规则，再完成“新建资料页 → 编辑并保存到 Supabase → 今日页插入页面/段落引用 → 点击定位原文”。同时确定 task/event/reference 三种自有块的编辑器接口；后续逐项接入状态、日期和 AI，避免到最后才发现编辑器无法表达核心交互。

实现选择不能以技术便利删去 Pages/Blocks、真实模型调用、引用或跨日一致性。视觉风格和响应式细节仍待草图确定。

### 已核对的官方资料

- [TanStack Start 环境变量与服务端示例](https://tanstack.com/start/latest/docs/framework/react/guide/environment-variables)：服务端调用及客户端配置的边界。
- [BlockNote 自定义块](https://www.blocknotejs.org/docs/features/custom-schemas/custom-blocks)：定义自有内容块的接口。
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[数据库函数](https://supabase.com/docs/guides/database/functions)、[SSR 客户端](https://supabase.com/docs/guides/auth/server-side/creating-a-client)：数据访问、关联写入与会话接入的依据。
- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart) 与 [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)：接入与结构化返回约定。

核对日期：2026-10-14。实际版本兼容性、编辑器保存映射和真实模型调用尚需在实现阶段验证。

## 规格修改规则

1. 区分用户明确的新要求与开发采用的默认值。
2. 修改默认行为时先更新范围文档相应 Dxx，并同步流程、数据和验收。
3. 日期/任务/引用语义以数据规则为准；视觉稿不能暗中改变这些语义。
4. 真实试用发现的问题记录为具体场景与结果，避免仅写“AI 不够聪明”。

## 本轮文档完成定义

- 目录与文件实际存在，索引链接可打开。
- 两条循环、范围、默认值、状态和失败行为一致。
- Pages/Blocks 保存与引用属于首版必需，自动抓取明确暂缓。
- 不把未确认默认值、未实现功能或未执行测试写成已经完成。
- 本轮只交付规格，不创建应用骨架、不安装依赖、不部署。
