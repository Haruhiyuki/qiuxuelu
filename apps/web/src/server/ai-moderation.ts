// 评论 AI 审核（DeepSeek，OpenAI 兼容接口）。秒审、宁放勿误伤——拦下的进管理员复核队列。
// 接入：POST https://api.deepseek.com/chat/completions，Bearer 鉴权，model=deepseek-v4-flash，
// response_format=json_object。无 DEEPSEEK_API_KEY 时审核关闭（fail-open，评论照常可见，便于本地开发）。
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
const TIMEOUT_MS = 8000;

/** off=未配置/跳过（视同放行）；allow=放行；block=拦截；error=审核异常（fail-open 放行） */
export type ModerationVerdict = 'off' | 'allow' | 'block' | 'error';

export interface ModerationResult {
  verdict: ModerationVerdict;
  category: string | null;
  reason: string | null;
  model: string | null;
}

const SYSTEM_PROMPT = `你是「求学路」学习经验社区的评论审核员。判断一条用户评论是否应当放行。
仅当评论明显触犯以下任一红线时才拦截，其余一律放行——包括尖锐但文明的批评、负面但就事论事的意见、口语化吐槽：
- spam：广告、推广引流、刷屏复读、与学习经验社区无关的垃圾信息
- harassment：人身攻击、辱骂、骚扰、威胁、恶意挂人
- hate：基于身份的仇恨或歧视言论
- illegal：违法信息、危害未成年人、教唆自残或危险行为
- sexual：色情、露骨性内容
- privacy：泄露他人隐私（真实姓名、电话、住址、身份证号等）
原则：宁可放行也不要误伤正常讨论；只看是否触犯红线，不评判观点对错。
只输出一个 JSON 对象，不要任何多余文字：
{"allow": true 或 false, "category": "none|spam|harassment|hate|illegal|sexual|privacy", "reason": "简短中文理由，放行时写 ok"}`;

function parseVerdict(
  content: string,
): { allow: boolean; category: string; reason: string } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    // 容错：从文本中抠出第一个 {...}
    const m = content.match(/\{[\s\S]*\}/);
    if (m === null) {
      return null;
    }
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (typeof obj !== 'object' || obj === null) {
    return null;
  }
  const o = obj as Record<string, unknown>;
  return {
    allow: o.allow === true,
    category: typeof o.category === 'string' ? o.category : 'none',
    reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : '',
  };
}

/**
 * 审核一条评论文本。任何配置缺失 / 网络 / 解析异常都走 fail-open（不拦截），
 * 把可用性放在前面——拦截只发生在模型明确判 block 时。
 */
export async function moderateComment(text: string): Promise<ModerationResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.length === 0) {
    return { verdict: 'off', category: null, reason: null, model: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 2000) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { verdict: 'error', category: null, reason: `HTTP ${res.status}`, model: MODEL };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return { verdict: 'error', category: null, reason: '空响应', model: MODEL };
    }
    const parsed = parseVerdict(content);
    if (parsed === null) {
      return { verdict: 'error', category: null, reason: '响应解析失败', model: MODEL };
    }
    return parsed.allow
      ? { verdict: 'allow', category: null, reason: null, model: MODEL }
      : { verdict: 'block', category: parsed.category, reason: parsed.reason, model: MODEL };
  } catch {
    return { verdict: 'error', category: null, reason: '审核请求异常', model: MODEL };
  } finally {
    clearTimeout(timer);
  }
}
