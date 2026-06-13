# ADR-0009：AI 评论审核取代预审/限速

状态：已接受
日期：2026-06-13
关联：ADR-0005（双线权限：裁决+义务）、架构 §4.2 / §5.4

## 背景

原评论门槛走「拒绝变引导」的义务梯度：TL0 评论首帖入 `first_post` 巡查队列预审 + 限速，TL1 限速，TL2+ 放开（`can()` 为 `comment.create` 附 `pre_moderation` / `rate_limit` 义务）。这套机制对冷启动有摩擦：新用户发评论被限速、首帖体验割裂，且预审依赖人工巡查。

## 决策

引入 **AI 秒审**（DeepSeek `deepseek-v4-flash`，OpenAI 兼容接口）在评论落库前同步审核，取代预审与限速：

1. **信任线去义务**：`can('comment.create')` 自 TL0 起一律 `allow('trust')`、**无义务**；`comment.inline.create` 仍需 TL1 但去掉限速。预审/限速义务类型保留在 `Obligation` 联合中但不再由评论发出。
2. **动作层 AI 审核**（`server/ai-moderation.ts` + `actions/comment.ts`）：
   - 受信任审核者（`comment.moderate`，板块版主+）跳过；其余评论送 DeepSeek。
   - 仅模型明确判 `block` 才拦截：评论落库为 `status='ai_held'`（对公众隐藏、不发通知、不记信任），进管理员复核队列。
   - 放行 / 关闭（无 API key）/ 异常一律 **fail-open**（`visible`）——可用性优先，宁放勿误伤；裁定与类别/理由记入 `comments.ai_*` 列备查。
3. **管理员复核**（`/admin/comments`，需 `comment.moderate`）：放行误判（`ai_held→visible`，补发通知/记信任）或删除（`ai_held→deleted`）；两者写 `audit_log`。
4. **数据**：`comments.status` 增 `ai_held`；新增 `ai_verdict` / `ai_category` / `ai_reason` / `ai_model` 列（迁移 0019）。
5. **配置**：`DEEPSEEK_API_KEY`（必需才启用）、`DEEPSEEK_MODEL`（默认 `deepseek-v4-flash`）、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）走环境变量；无 key 即审核关闭（本地开发 fail-open，评论照常可见）。

## 取舍与后果

- **可用性 > 严格拦截**：任何配置/网络/解析异常都放行，AI 只做「明显违规」的前置过滤，人工复核兜底误判。代价是 AI 不可用期间评论无前置过滤（对小型学习社区可接受）。
- **同步秒审**增加一次外部请求延迟（flash 通常亚秒~1~2s，设 8s 超时）；超时即 fail-open。
- **成本**：每条非受信任评论一次 flash 调用，量级小、单价低。
- `first_post` 巡查队列不再由评论写入（保留表与既有数据）；限速逻辑与 `RATE_LIMIT_SECONDS` 从评论动作移除。
- 后续可平滑升级：把同步审核改为「先入队、异步秒审」，或接入更细的分级（warn/hold/block），均不改对外语义。
