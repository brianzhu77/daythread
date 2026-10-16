# 02 · 数据与状态 · v0.3 首切片规格草案

状态：依据 Brian 7a55cbbf/78871f09 及 Lead 11ec76e1/ce71e129 修订。已授权本地首切片；外部资源待 setup-proposal 审批。Supabase 是历史偏好下的持久层默认，不是不可质疑约束。领域规则与 SQL 实现分开，当前没有已运行的数据层。

## v0.3 改动记录

- 来源：refs O-U06/O-U07/O-U10/O-U11，Brian 的设备/预算/日记样本和手工接续流程。合理的数据不变量沿用，来源不再误标为用户逐项要求。
- E1/R7：当天索引明确关联全文展开；E2额外资料候选与全文区分；预算/超容量不能静默摘录关联正文，具体契约见03。
- E3：workspace共享日费用预留/结算；E4 review_saved独立draft_ready，iOS重复提醒首轮。
- E5/E6：页面级引用先行，quote独立摘录，精确锚点后置；正文可编辑分区模板，取消A/B前置。
- 新样本：昨天全部未完成项可逐项Keep，3条上限仅更早接续；可Keep Notes/Good Stuffs，事项引用与文字复制不同。
- E7：删除当日整条安排行直接Not today与撤销；批量正文删除仅删呈现，历史/普通引用不改事项。
- 资料身份只由Good Stuffs链接或明确保存动作建立；Notes/任务链接不自动升级，推荐资格单独控制。

## 沿用的评审改动记录

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

## 可编辑分区模板与呈现

Daily Page默认分区为TODO - Top 3、TODO - Other、Events、Good Stuffs、Notes。分区有稳定section ID及kind，显示标题/排序/内容可编辑，不能靠改标题文字改变资料或安排语义。Top 3是可见分区与placement优先级，不是新增Task状态；不把模型建议自动记作明确安排。

默认计划行位于Top 3/Other，用户可以增删分区并在任意位置书写、移动事项，不靠位置锁死能力。普通文字、链接和引用可自由保留。Task仍是事实真源，DailyPlacement选择/顺序，Block只作呈现。删除明确标为当日完整placement行直接执行Not today，回执说明停止接续/截止保留并Undo，不逐次询问；改标题字符、删普通引用、历史呈现或事件行不得推断暂放Task。

批量正文删除仅软移除所选Blocks，不改Task/placement/paused；一个事务保存页面结构/引用变化。事实区显示“仍安排今天，未在正文 · N”及Put back/逐项Not today；汇总回执给出仍安排数量。Undo检查结构/块版本，不回滚后来实体更改。

Keep planned纠正单行删除时，先条件撤销暂放再只删呈现，同一事务全部成功或失败。事项多种事实合为一行加日期标签，不能为去重隐藏截止。

布局A与A/B原型不再是建设前提。编辑器可选逐块行或规范页面JSON+索引，只有一个正文真源；按手机真实保存实验确定，不预建平台。

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
| 删除当日完整安排行 | 等同Not today；原子维护实体/placement/呈现/Change | 不弹去向选项；回执与条件Undo；普通字符删除不适用 |
| 批量删除正文 | 只软删除Block与引用，实体/placement不变 | 事实区仍可见被移除的今日安排；有汇总回执 |
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
3. 更早日期的接续默认展示最多3条建议（昨天交接不受此限）；只展示不修改 planned_on/资格。其余在 Still open 展开，未曾安排标未安排。空白日、纯笔记日、跳 review、删每日页不移除任务库存。
4. 暂放任务不在 pool/carry；Upcoming 的 Not today 可查。attention 已到且暂停者在独立摘要“已暂放，准备已到 · M”中，M 不计 pool 数量、不驱动候选。
5. 日期事实：active Event 日期=D；open Task planned_on=D、attention_on≤D 或 deadline 当日/过去。deadline 不受暂停和候选上限影响；暂停关注可折叠，真实截止不能因此隐藏。
6. 同Task多种事实优先合一行，保留所有日期标签；已安排的项不在旁边再铺一次，但截止/关注标记仍可见。暂停截止项显示“已暂放今日安排，截止仍有效”。

rotation 默认关；按 00 D06 的试验触发值，同三条建议连续重复超过3天时开启轮换，并记录最近展示信息。开启时在合格候选内按最近展示日升序（从未展示排先）、再沿用原稳定次序取3条；同一日刷新复用已选集合，不靠刷新轮换。该阈值仍是待试验默认，轮换不改变库存资格。数量可能增长是实际产品取舍，不靠藏掉库存假装消除了积压。

## 早上交接与保留内容

早上交接是主路径，不仅是跳review的补救。读取昨天（若漏天则最近有效日记）的全部仍open、未暂放、未在今天明确安排、无明确未来处理日事项，逐项Keep / Not today，可跳过，不能强迫清零。这里不受3条候选上限；更早日期的合格接续仍最多3条，并按Task ID排除已在交接展示的事项。连续漏天时根为最近有效日记，回执注明日期，不要求补写每一天。

Keep任务更新同一Task planned_on=今天及placement，不复制Task。既有今天安排直接去重。未处理的交接项仍在库存，不能因“交接完成”被自动暂放。handoff_saved独立记录，不能仅看页面打开或有没有新页判断完成。

Notes/Good Stuffs行可用户明确Keep到今天：普通文字/quote复制成新Block并保留source_block_id/source_page_id及来源日期；引用继续指向原目标；任务引用仍同Task。幂等键为workspace+目标日+来源Block+操作身份，重试同一次Keep不重复建Block；用户明确再次复制是新操作。源内容修改不回写已复制文字，目标软删除有占位。Good Stuffs行Keep复用资料身份，不新建同一资料副本。

## 每日页与草稿

工作区+日期唯一，软删除也占唯一身份；再次进入提供恢复，不新建同日第二页。跨午夜不强制跳转正在编辑页面。

开页只读确定性事实、库存、现有正文，不自动调用模型。Review 或主动 Draft my day 可生成建议；Generation pending/running/ready/applied/failed/superseded，ready 不等于正文已保存。即使用户清空正文，也不能仅因此自动再生成。

新事实在页面事实区可见，正文合入由用户选择；已有人工内容不被旧版本建议覆盖。生成合入检查目标结构revision；不恢复被用户删掉的模板标题。

## Event 与资料

Event active/cancelled，过期active留历史，不自动完成或顺延；准备/跟进是独立 Task，明确关联后才能提议一起顺延，缺少关联先澄清。

文字块类型 paragraph/heading/list_item/quote；另有事项/事件/资料引用。quote 是独立摘录，可带自己的来源，不随原文改动。动态引用默认读当前目标，历史页说明当前状态；标题改名与位置变化不换身份。

Page/Block软删除后引用保留占位和目标ID，恢复后可用；删除资料页不取消其中独立任务。引用预览只展开一层，避免循环。来源原文、个人文字、AI摘要可区分，摘要不能覆盖原文。

首切片页面级引用只打开原页；quote保留独立摘录和来源。精确段落锚点/块级动态引用及反链UI后置，稳定Block ID继续保留。不得宣称旧段落定位验收已经通过。

## 资料身份、链接与推荐资格

Good Stuffs区新增链接、或任意位置明确“保存资料”（capture裸URL视为明确保存），建立Material身份：ID、workspace、URL、可选Page正文、来源Block、resurface_enabled及rev。只有URL时content_state=link_only，不声称读过正文；尚无自动抓取。Notes普通链接、Task工作链接不自动升级，来源仍可用于该事项上下文。

同一次保存/Keep按操作身份复用同Material；不做破坏性URL参数清洗或把所有同URL笔记自动合并。资料保存与推荐资格分开，“不再推荐”只改变resurface_enabled，资料和引用保留。购物用途不能靠模型/URL猜后删除。

推荐根为用户带入的过去Good Stuffs中允许推荐资料，10–20种子额外集可选，不扩展到全部历史库。全文/目录输入模式及真实内容可见性按03执行。

## Review与预算状态

review_saved代表用户review输入/步骤进度已保存并点击Finish或完成约定步骤；draft_ready只表示建议生成成功，两者分开。预算不足/LLM失败不妨碍保存手工review。handoff_saved和review_saved分别记录，成功日由04定义，不能把技术失败记成用户没做review。

预算账本按workspace+America/Vancouver自然日共享：settled/reserved与attempt身份，事务预留保守上界再外部调用，usage结算、未知费用保留预留、跨日不丢在途费用。10USD是模型日限额；供应商UTC daily key只兜底，详情以03为准。预算状态不能放浏览器各自计算，10USD不是每设备额度。

## 保存、版本与恢复

- Capture状态 saved/processing/needs_clarification/needs_confirmation/applied/discarded/failed/superseded。编辑/澄清递增revision，保留原始版本，旧提案不能应用。
- 尝试租约超时只表示可恢复，不等于供应商未计费；先查询应用结果并按03对账/预算准入，满足后才可新attempt。apply_key唯一绑定 Capture+revision+mode，保存不可变输入摘要用于拒绝同key不同输入。待确认提案可合法Edit并递增proposal_revision；应用前不因改提案而拒绝同一输入。第一次成功应用时冻结最终提案摘要，后续相同key只返回已提交结果，任何不同最终提案的重新应用均拒绝。确认绑定proposal_revision。主动Draft my day无Capture时用Generation request_id+目标Page/date+输入版本作独立幂等身份；同一request重试返回原结果，新主动生成必须新request，合入仍检查目标Page结构revision。
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
