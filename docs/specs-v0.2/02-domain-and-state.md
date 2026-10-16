# 02 · 数据与状态 · v0.2 评审修订草案

状态：团队推荐，待审阅；布局 A/B 待原型会话决定，未授权正式开发。Supabase 是历史偏好下的持久层默认，不是不可质疑约束。领域规则与 SQL 实现分开，当前没有已运行的数据层。

## 改动记录

- R1：Task 事实 / DailyPlacement 选择 / Block 呈现分离，普通删除不改变承诺。
- R2：库存跨空白日保持；候选是库存子集，3 条只限展示；暂停关注摘要独立计数。
- R3：打开日期页不调用模型；生成状态与页面空白分开。
- R4/R5：显式操作与 AI 提案分开，资料没有事项执行能力。
- R6：revision、attempt、apply_key、确认与撤销前置检查。
- R7/R8：上下文来源、发送范围与建议不是任务状态。
- R9/R10：保留数据不变量，后置复杂合并、全局撤销与反链 UI；导出不冒充恢复。
- R11/T1：采纳纸面回放新发现——排除今日 included、保留旧计划日、撤销恢复接续资格、改期使旧未来 placement 失效。证据见 [T1](../reviews/round-1/state-replay.md) 与 Wheeljack 报告独立推演；只验证纸面可判定性。

## 身份与唯一事实

| 对象 | 最小语义与约束 |
| --- | --- |
| Workspace | owner_user_id、时区、语言；单用户试用，所有权由 Auth 身份确定 |
| Page | daily/document，标题、归属日期、结构 revision、软删除；工作区+日期唯一，包括已移除 daily 页 |
| Block | 稳定 ID、Page、类型、顺序、内容/目标、revision、软删除；移动/改字不重建 ID |
| Task | 稳定 ID、标题、open/done/cancelled、planned_on、attention_on、deadline、auto_carry_paused、revision、来源 |
| Event | 稳定 ID、单日发生日期、可选明确时刻/时区、模糊时间说明、active/cancelled、revision、来源 |
| DailyPlacement | workspace/date/task 唯一关系，选择状态 suggested/included/excluded/moved，排序及选择来源；不是事项状态副本 |
| Capture | 原始输入身份、当前 revision、原话/澄清修订、captured_at/时区、来源位置、处理状态 |
| Review | 日期、原话、Capture、独立总结及目标日；不能把总结覆盖原话 |
| Generation | 目标日/Page、输入/目标版本、请求身份、ready/applied 等状态、输出/失败原因 |
| Attempt | 一次模型尝试、对应 Capture revision/Generation、started_at/lease_until、状态、模型/用量 |
| AppliedOperation / Change | 唯一 apply_key、最终提案摘要、实际结果；关键变更前后值与撤销前置条件 |

Reference 可表达在 Block 的目标字段，不强制独立表；反向引用来自实际关系而非纯文字匹配。普通逐字输入无需永久逐键历史；事项、AI 应用前值与原文修订保留恢复依据，不要求全事件溯源。

Task 是状态/日期唯一事实；DailyPlacement 记录某日选择和顺序；Block 只是呈现。同事项多个位置都读同一实体，不各存完成状态。日期安排、同日计数、模型引用按 Task ID 去重；普通 Notes 多次引用可存在。

## 布局 A/B（待原型会话决定）

A：Today 结构区从 Task/Event 事实与有效 placement 生成，Notes 自由编辑。安排行不是编辑器正文块。删除普通引用只删 Block，显式 Not today 才改安排。

B：正文包含可识别的 placement 块和 ordinary-reference 块。placement 块绑定当日关系，普通引用只绑定事项。普通引用 Backspace 只移除指定呈现。placement 行的 Backspace/Delete 依 01 §3.2 B：先选中行，出现内联 Not today / Remove from page only 提示，单次退格不写状态；用户选 Not today（提示出现后的 Enter）才提交暂放。选 Remove from page only 只移除呈现，事项仍安排该日并转到事实区显示，允许恢复呈现。不得用一次退格静默改变事项。

两方案都不以正文文字/排序推断承诺状态；同一事项的截止、关注与计划事实合为一行加标签，去行不能去掉期限信息。旧页可显示 moved 状态及当前实体状态，明确这不是当时状态快照。

正文存储建议先试逐块行；若编辑器实验表明页面规范 JSON+引用索引更简单，可替换物理方案，稳定 Block ID 和单一正文真源不变。普通文字不触发 AI。

## 日期、时间与解析基准

- page.date 是归属日，日级字段用 YYYY-MM-DD，不先当 UTC 午夜转换；时区改变不重新分配日记日期。
- planned_on 是处理日，attention_on 是用户指定的准备/关注起点，deadline 是截止，可含时刻与时区；三者独立。改处理日不改截止。
- captured_at 是实际录入时刻，另保留解析时区/本地基准。相对日期依 Capture，不依响应时间/服务器时钟/所看历史页。
- 历史 review 的目标日明确展示；“明天”默认实际录入日+1，用户明确说“这一天的明天”才采用日记归属日。
- 周一为周起点作为试验默认；“下周五”是下一个周的周五。影响安排的合理歧义要澄清，回执显示具体日期，不编准备日。
- 只有过去的 planned_on 不代表逾期；逾期由真实 deadline 判定。未来页写“当日截止”，不能用查看日假装现在逾期。
- 明确时刻保存实际时刻与 IANA 时区；夏令时不存在/重复时刻先澄清，不静默修正。单日事件外的多日/旅行自动调度后置。

## Task、安排与显式操作转换

生命周期：open → done/cancelled；done/cancelled 经明确恢复 → open。暂放、等待、逾期都不是完成状态。等待说明可保存在 open 任务并暂停接续，不新增自动依赖链。

| 操作 | Task / placement | 呈现与资格 |
| --- | --- | --- |
| 今天做/明确改期到 D | planned_on=D，paused=false；目标D included；旧有效安排标 moved | 一处当日安排；旧未来关系不能继续 included 或驱动事实；旧排除不阻挡新明确安排 |
| Not today/暂放日期D | D excluded，paused=true；仅 planned_on=D 时清空处理日；其他未来/过去处理日保留 | 从该日正文安排/候选退出，普通引用仍 open；deadline/attention 不清 |
| 删除普通引用，任意页 | 只软移除该 Block | Task/日期/placement/暂停不变 |
| 完成/取消 | 状态及revision更新 | 停止未来行动候选；历史/引用保留当前状态 |
| 明确恢复实体 | 同ID变open，保留原日期与暂停状态 | 不等于安排今天；恢复自动接续是单独明确动作 |
| 修改标题/日期 | 只改明确字段，revision递增 | 不按标题文字重新推断日期 |
| 编辑普通日记 | 只保存正文 | 不完成/取消/改期任何事项 |

暂放保留过去处理日时，它只是旧计划记录；paused 阻止回流，不能由“仍是过去日期”绕过暂停。暂放未来安排时取消该日选择，如计划日相等则清空，不改截止。

安排操作用一个受控事务更新 Task、受影响 placement、关联呈现及 Change。旧 placement 可保留历史身份，但 moved 不再有效。用户手动排序改变当日 order，不改变日期或最后明确安排资格。

撤销恢复操作前的字段及有效安排资格；被撤销的安排不能使原来从未安排的任务获得接续资格。不能从 Change 中“曾有过 planned”推导有效安排。关键资格可由有效关系/显式恢复前值维护，物理存储由实现实验决定。

## 库存、候选、日期事实

以下均为查询语义，不建立三套独立库存。以目标日 D 计算：

1. open pool = open、未暂停、没有 planned_on>D 的 Task，包含无日期和今天已安排事项。count 表示未完成库存，不是今天必须做决定的数量。
2. carry candidates = pool 中具有有效的历史明确安排资格、尚未在 D included 的任务；按最后明确安排时间升序、创建时间升序、稳定 ID 排序。事实/已有当日安排按 Task ID 去重，不让同事项再占一条建议。
3. 默认展示最多3条建议；只展示不修改 planned_on/资格。其余在 Still open 展开，未曾安排标未安排。空白日、纯笔记日、跳 review、删每日页不移除任务库存。
4. 暂放任务不在 pool/carry；Upcoming 的 Not today 可查。attention 已到且暂停者在独立摘要“已暂放，准备已到 · M”中，M 不计 pool 数量、不驱动候选。
5. 日期事实：active Event 日期=D；open Task planned_on=D、attention_on≤D 或 deadline 当日/过去。deadline 不受暂停和候选上限影响；暂停关注可折叠，真实截止不能因此隐藏。
6. 同Task多种事实优先合一行，保留所有日期标签；已安排的项不在旁边再铺一次，但截止/关注标记仍可见。暂停截止项显示“已暂放今日安排，截止仍有效”。

rotation 默认关；按 00 D06 的试验触发值，同三条建议连续重复超过3天时开启轮换，并记录最近展示信息。开启时在合格候选内按最近展示日升序（从未展示排先）、再沿用原稳定次序取3条；同一日刷新复用已选集合，不靠刷新轮换。该阈值仍是待试验默认，轮换不改变库存资格。数量可能增长是实际产品取舍，不靠藏掉库存假装消除了积压。

## 每日页与草稿

工作区+日期唯一，软删除也占唯一身份；再次进入提供恢复，不新建同日第二页。跨午夜不强制跳转正在编辑页面。

开页只读确定性事实、库存、现有正文，不自动调用模型。Review 或主动 Draft my day 可生成建议；Generation pending/running/ready/applied/failed/superseded，ready 不等于正文已保存。即使用户清空正文，也不能仅因此自动再生成。

A：建议与当前安排分离；新增日期事实直接更新 Today，不需要合入 Notes。B：新事实在状态区可见，正文合入由用户选择；已有人工文字不能被旧版本生成覆盖。两者对自由文字的合入都检查目标结构revision。

## Event 与资料

Event active/cancelled，过期active留历史，不自动完成或顺延；准备/跟进是独立 Task，明确关联后才能提议一起顺延，缺少关联先澄清。

文字块类型 paragraph/heading/list_item/quote；另有事项/事件/资料引用。quote 是独立摘录，可带自己的来源，不随原文改动。动态引用默认读当前目标，历史页说明当前状态；标题改名与位置变化不换身份。

Page/Block软删除后引用保留占位和目标ID，恢复后可用；删除资料页不取消其中独立任务。引用预览只展开一层，避免循环。来源原文、个人文字、AI摘要可区分，摘要不能覆盖原文。

块级引用仍在建议范围；反链 UI 后置但实际引用关系保留。页面级窄切片不能标旧段落定位验收已完成；范围调整需明确记录。

## 保存、版本与恢复

- Capture状态 saved/processing/needs_clarification/needs_confirmation/applied/discarded/failed/superseded。编辑/澄清递增revision，保留原始版本，旧提案不能应用。
- 尝试租约超时后可重试；先查询应用结果。apply_key唯一绑定 Capture+revision+mode，保存不可变输入摘要用于拒绝同key不同输入。待确认提案可合法Edit并递增proposal_revision；应用前不因改提案而拒绝同一输入。第一次成功应用时冻结最终提案摘要，后续相同key只返回已提交结果，任何不同最终提案的重新应用均拒绝。确认绑定proposal_revision。主动Draft my day无Capture时用Generation request_id+目标Page/date+输入版本作独立幂等身份；同一request重试返回原结果，新主动生成必须新request，合入仍检查目标Page结构revision。
- RPC事务内验证当前revision/实体版本/同工作区归属/幂等键，关联写入与Change/实际结果一次提交。模型在事务外。
- 同Capture混合新建与既有事项修改时，整组needs_confirmation，不提前写新对象；Apply后同一事务与apply_key提交，Discard整组不应用且原话保留。纯新建组才可按明确回执直应用。needs_confirmation 的卡片持久保留；Today事实区显示“N条录入待确认”，跨日仍可打开并应用（重查版本）。文案明确“包含新建项，一起等确认”。Discard后Capture标discarded、原话保留、移出待确认计数；重新整理须显式发起新revision。
- review原话、事项应用、草稿生成分开持久状态。草稿失败不重放事项应用。
- 页面结构采用revision/CAS；冲突保留双方内容并警示，不静默最后写入覆盖，不预承诺复杂自动合并。
- 多对象撤销先检查整组版本、关系与下游引用；任何前置条件失败不做破坏性部分回滚，保留当前状态和前值，提供可审查恢复。编辑器本地撤销不能越权回滚其他页面的实体状态。
- 保存失败只承诺当前会话保留输入；未实现本地持久队列时不声称刷新可恢复未保存文字。会话过期提示重登录，已提交操作不重做。

已进入 needs_confirmation 的组，即使 Edit 移除了全部既有事项修改，只剩新建项，也仍需 Apply 才提交；编辑提案只递增 proposal_revision，不触发自动保存。该规则不改变初次仅含明确新建项的直应用默认。

## 访问与导出

所有工作区数据有workspace_id，所有权来自Auth；同工作区关联用复合唯一/外键或等效数据库约束保证。RLS覆盖页面、事项、引用、Capture、模型上下文、搜索和导出；普通读写用调用者身份。RPC不能信任客户端/模型给的user_id，默认调用者权限。若必须definer，固定search_path、收窄execute并显式校验auth.uid，另行审查。

模式/约束/RLS/函数由版本SQL维护。两个用户混入合法外部ID、跨工作区引用、批量RPC、导出及上下文读取都需真实隔离测试；本轮只有规则，不是安全通过声明。

结构化JSON导出保留稳定ID、Page/Block/Task/Event、日期/时区、来源/引用、Capture/Review与必要Change和软删除标记；校验对象数与引用闭合。没有导入恢复实验不能称完整备份，Markdown后置。凭证和第三方运行日志不进导出。
