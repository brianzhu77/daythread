# v0.3 · Ratchet 写作与交叉审查记录

2026-10-16，task #17。作者03，Wheeljack独立审03；Ratchet审00/04。只写03与本审查材料，不改队友文件、应用或冻结v0.2。文档契约/纸面推导不等于应用或供应商验收。

## 当前交付与问题

- 03初稿 ca2fd0a85110 已交Wheeljack（1292ef45），待独立审查。覆盖E1/E2/E3、模式和混合组/版本幂等，并与最新模板、review状态对齐。官方限额UTC重置及usage成本字段独立查阅，未配置key或真实计费。
- 00 c7179820 与04 b6d880c9 已完整读，来源和样本语义基本对齐；待作者修两处（67c9fd07）：R03草稿先建议、接受才安排；X02租约到期不自动解除未知计费，补预算超时/跨日/未知价格/重放结果场景。
- 00原“unchecked”普通行已改成用户选择的行，04 A39覆盖一次复制+来源；Task Keep仍同一ID。

## v0.3差异纸面再推导（V1补充）

独立分支夹具：D1已安排A/B、A有D3截止，A还有普通引用r；D2尚未安排。Notes文字n、Good Stuffs链接g均普通行，无完成状态；g已有资料身份M；D0旧计划任务Z可接续。

| 动作（每行另从夹具分支开始） | 实体/安排 | 呈现/交接 | 预期依据 |
| --- | --- | --- | --- |
| D1删除A整条明确计划行 | A保持open，D1 excluded、暂停接续，planned若等于D1则清；deadline保留 | 计划行移除，r仍指A；Not today可查，截止区保留期限；回执与Undo | A19取代旧T1“先提示”映射，状态仍为旧步骤7 |
| D1只删普通引用r | A/placement/paused均不变 | 只移除r | 旧T1步骤3仍有效 |
| D1编辑A标题字符 | 改标题revision，不改计划/状态/暂停 | 同A的引用读新标题 | 普通字段编辑 |
| D1批量删包含A/B计划行与n的正文 | A/B仍open且D1 included、不暂停 | 对应Block移除，外部事实区显示仍安排2项，n删除；整组Undo前置检查 | A34 |
| D1删A后点Keep planned | 先恢复操作前暂停/安排，再仅移除该呈现 | A仍D1 included，事实区Planned-not-in-note；r不变 | A35；两个动作事务化避免中间状态误回流 |
| D2打开，A/B仍open且无更晚计划 | 不自动修改A/B planned/paused | 交接显示A/B全部；Z属于更早Continue候选，不能与交接同项重复 | A32；Cap3不适用昨日集合 |
| D2只Keep A后Done | A同ID改D2 included；B保持D1 open、不暂放 | handoff_done，B仍在pool，卡片无需清零 | A33；可部分完成 |
| D2完全Skip | A/B/Z/n/g均不变 | handoff_skipped，不算done；仍有库存/可找回入口 | 跳过不代表取消或自动安排 |
| D2带入n/g并重复点击或刷新 | 不新建Task，M仍同资料ID | 目标页新文字副本带D1来源；每个本次带入操作只一份，保留源行 | A39；复制文字不复制承诺/资料身份 |
| D2保存review后模型额度不足 | 人工动作/原话已存，review_saved成功 | draft_ready失败，可手动重试；不能重新做已提交动作，不算漏review | R13/E3 |

上述仅手工按文档规则推导，尚待对实现做可执行验证。这里没有证明数据库原子性、移动端编辑器或模型意图正确。

## 后续运行验证仍必需

- E1展开manifest对实际发送内容、跨工作区拒绝、cycle与悬空引用。
- 共享预算并发、保守上界/实际费用、超时保留预留、跨日归属和查询重放。
- 真实iPhone录入/review/恢复、iOS提醒实际到达（App不可声称能观察fired）。
- 真实模型语料、旧revision/对象版本冲突、混合组确认与丢回执。

## 00/04最终回验

00 SHA-256 `e2e31e4feb8c286ff3c88a9fab05e86091c0ab4cf8b483cc138a1522922db26c`、04 `cc0d9abe1ce0110521115838af8040bc10f448481ad84cf29cf359571450ed18` 已独立读取/比对，R03/A29与X02/X26修正关闭，无剩余阻断。交接f9e1dc7f，仅文档契约复核。

03新增裸URLcapture作为明确保存的解释，与00/01已接受边界一致；新SHA-256 `a56f4f1bb99ef2369667bf2767e5fe29b98ff7ca9c3ea88eb20fda0e1a418b9d`，47796b1e交Wheeljack取代ca2fd0a8，待独立审查。

## 03独立审查与02/05最终接口审查

Wheeljack d4085d8a / docs/reviews/v0.3/wheeljack.md 已独立审03 a56f4f1bb99e，无文档阻断；其记录明确没有模型/预算/SQL实测。

Ratchet完整读取02 27812227c86e、05 d2e0b08f103a，行为与03及refs裁定大体一致；9c4b57ef交作者三处修正：handoff_saved须与handoff_done命名/完成语义对齐；删除引用已不存在的“00 D06连续3天自动轮换”默认；Material同URL复用与不合并不同原文/来源需区分，对齐04 P14。待作者修后回验。

未独立运行应用；骨架构建/类型/HTTP证据来自Wheeljack，不能算Ratchet自己的运行验证。此处交付为规格审查，不扩充为已完成应用QA。

## 最终规格交叉复核 · 2026-10-16

02/05修正已独立读取，handoff_done、手动开启轮换、完全相同URL复用Material且来源/备注独立均关闭；00/04对应最终修正回验通过。01已完整读取，无阻断；仅§7“steps1–3不需模型”建议限定“人工保存不依赖模型，步骤2capture整理仍调用”以免歧义（82601829，非阻断）。03由Wheeljack独立审查，无阻断。交接b148686d，task #17 in_review。

此结论只覆盖当前规格内部契约与来源语义，不能用于宣称持久化、模型、预算、设备或提醒已运行通过。骨架运行证据由其作者单独报告。外部资源仍遵守当前setup授权。

回验版本（此前哈希由下列取代）：
- 00-scope.md: `25c216d9a9dcd35b8eb7c93d88bf11e4497d6664b721188b32dcd7833b4286ff`
- 01-flows-and-ux.md: `81d5d3f8fd76ce54286e3e0771ec6102fa1520326e09e61647bc58b82764c763`
- 02-domain-and-state.md: `32da82a332d6d93a1b1696b98e51cad02dd4c27a1b198bf080b17f801c88a4b4`
- 03-ai-contract.md: `a56f4f1bb99ef2369667bf2767e5fe29b98ff7ca9c3ea88eb20fda0e1a418b9d`
- 04-acceptance.md: `68e9703babb1582a6c040f1fd4918432bbf2db711af74fcc6a65bcc12dbe1f92`
- 05-delivery.md: `303f1012d81b3c164b738f87e395456795ab64cfd5e1693cb0ca23f61643c0fb`
- README.md: `1d9acd024c6f9947ddb2c03478e1632ded1a6bcd7ed5edd2935f979b7edec101`

01最后措辞收尾已独立回验，sha256 `81d5d3f8fd76ce54286e3e0771ec6102fa1520326e09e61647bc58b82764c763`；§7与§8均区分人工保存不依赖模型、capture整理需模型。82601829关闭，无剩余文档事项。此哈希取代前列01版本。
