# Daythread · 外部配置与费用提案 v1

2026-10-15（Vancouver）；作者 Wheeljack。**待 Lead 审核及 Brian 批准，尚未创建外部账户/项目/key、充值或部署。** Brian 已批准本地首切片与iOS重复提醒；本提案把外部动作具体化，供一次审阅。

## 推荐组合

Supabase Free + Vercel Hobby + OpenRouter 专用受限key；先用平台默认HTTPS域名，不买域名，不加付费SMTP/监控/Push。固定平台费建议为 **USD0/月（在免费配额与适用范围内）**，模型按用量另计，Daythread应用上限USD10/Vancouver自然日。30天每天用满可到USD300模型余额消耗，另有购买credits手续费；这是上界示例，不是预期费用。

| 项目 | 推荐与备选、月费（USD） | 具体动作与操作人 | 撤销与限制 |
| --- | --- | --- | --- |
| Supabase | 推荐Free $0，单个专用Daythread项目；备选Pro起$25/月，超配额/更多项目/compute另计，不默认升级 | Brian在自己的账号选择组织与数据库区域、创建项目/保管数据库密码；获准后Wheeljack运行经审迁移、设置RLS和最小Auth；不索取聊天中的密码 | 先导出再暂停/删除专用项目；删除不可当作普通回滚。Free一周不活跃会暂停，非持续可用承诺；有既有免费项目时先核对2个活动项目名额 |
| HTTPS托管 | 推荐个人试用Vercel Hobby $0；备选Pro $20/月起+额外用量，需另批。也可本机临时运行$0但iPhone异地/休眠后不可用，不满足正式试用 | Brian提供/登录自己的Vercel账号；获准后Wheeljack创建一个专用项目并部署受登录保护的应用，使用默认HTTPS域名；CLI直接部署即可，无需先建GitHub远程仓库 | 可停部署/删专用项目/撤销部署凭证；数据仍在Supabase。托管上限/超时与Start适配需验证，不能以本地Vite build通过当作部署已验证 |
| OpenRouter | 无固定模型订阅费；模型按已选ID的输入/输出价格结算；Standard购买credits手续费当前5.5%。建议首笔最多购买$10模型credits，付款含费由Brian在结账页确认；不开自动充值 | Brian在自己的账号创建Daythread专用key，配置limit=10、limit_reset=daily；本地/托管秘密由Brian填入或通过获准的密钥入口配置。Wheeljack不创建/持有management key，不把任何key放聊天/源码 | disable/delete专用key即停新调用，已发请求可能仍计费；未花credits留在账号，不能承诺退款。平台daily按UTC重置，不等于应用Vancouver日限额 |
| 重复review提醒 | Brian已有iOS提醒事项/日历每日重复项，新增平台费$0；首轮不建Push/邮件服务 | Brian选提醒时间并设置重复项，附部署后的 `/review` 直达链接；Wheeljack提供使用说明、可达页面；不代用户批量写日历 | Brian可关闭/删除。Mac/iPhone通知和Focus依设备设置；应用只能观察打开review链接，不能证明系统提醒已显示 |

费用资料核对：2026-10-15，实际创建/结账前再确认。[Supabase pricing](https://supabase.com/pricing)、[Vercel pricing](https://vercel.com/pricing)、[OpenRouter pricing](https://openrouter.ai/pricing)。Supabase Free的配额/暂停与备份限制、Vercel Hobby的个人使用条件需符合本人的试用用途；若转商业或超配额，重新审阅，不静默升级。

## 资源与访问范围

- 专用项目、本人单用户登录；不公开注册，不开放匿名个人数据。首次试用可用管理员在后台建立的本人账号+密码登录，避免首轮依赖额外邮件投递服务；具体登录配置随Supabase Auth验证，不把默认测试邮件当生产通知。
- Supabase区域建议选可用的北美区域，最终由Brian在控制台确认；托管函数区域尽量邻近。OpenRouter实际模型供应商/路由另行可见，不假称全链数据驻留北美或已取得某种合规保证。
- 只将试用中本人带入的资料按已同意关联范围发给模型；专用key限制不等于供应商留存保证。调用前核对所选路由留存/训练政策并记录；不上传整个refs或Raft历史作为模型上下文。
- 源码本地git，不建远程repo。部署只需应用及必要配置，refs内私人材料不应作为公开静态资源或构建上传日志内容。公开URL可以访问登录页，个人数据仍由Auth/RLS保护。
- 浏览器仅公开Supabase URL/publishable key。OpenRouter key、迁移凭证只在服务端/授权本地流程使用，正常请求不依赖service_role。所有.env均被git忽略，示例仅占位。

## 日预算如何落地

应用共享账本按America/Vancouver自然日，以attempt预留保守费用上界，成功后用usage.cost结算；重试、失败但已计费、草稿/录入均计入。MacBook/iPhone共用10USD，不是每台10USD。费用不明保留预留并对账；无可靠上界时不发请求；不明结果不自动重试。OpenRouter专用key的UTC日10USD仅作第二层兜底，可能比本地预算更早拒绝调用，不能暗中放宽。参见[官方key限额](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key)。

用尽时只阻止新的模型调用，手写、任务操作、review_saved继续可用；保持原话、显示已用/预留/剩余和下次重置，次日用户主动重试。不得默开自动充值、换更贵模型或省略已关联正文。

## 审批动作清单

建议Brian一次批准上述 **一个Supabase Free项目、一个Vercel Hobby项目及一次HTTPS部署、一个OpenRouter专用受限key** 的范围；账号登录、区域、充值与付款由Brian操作。数据库迁移先审SQL与RLS再运行。任何付费plan、域名、额外服务或自动充值都不在该默认组合中。

批准后顺序：取得非秘密项目标识与域名 → 验证本人登录/RLS → 配置服务端秘密 → 测试严格预算和真实小样 → 私人设备浏览关键流 → 配置review提醒。每步报告真实结果，未连通的功能不显示为已可用。首笔真实模型调用仍先通过预算检查。
