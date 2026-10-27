import { logger } from '../logger.js';
import { upstreamError } from '../errors.js';

// LLM 客户端：OpenAI 兼容 + Anthropic 双协议。
// 设计参考墨笔 api.js 的「预设 + 多级文本降级」思路，但落在这里做服务端代理：
//   - key 只存服务端 data/settings.json，不落浏览器，换机器不用重填
//   - 无 CORS 问题，任意端点都能连
//   - 协议差异（anthropic 的 system 提取 / max_tokens）在 buildBody 一处收口

export const PRESETS = Object.freeze([
  {
    id: 'openai', name: 'OpenAI 兼容',
    hint: 'OpenAI / DeepSeek / Kimi / 智谱 / 通义 / 硅基流动等均兼容此协议',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
    path: '/chat/completions', style: 'openai',
  },
  {
    // 2026-10：DeepSeek 官方主推 deepseek-flash（模型版本 DeepSeek-V4.1-Flash）。
    // 老模型名 deepseek-chat / deepseek-v4-flash 已下线，请求会被路由到 V4.1 Flash。
    id: 'deepseek', name: 'DeepSeek V4.1 Flash',
    hint: '官方直连 · 1M 上下文 · 支持图像 · 默认 Low 思考（实测 High 拆一集会超时）',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash',
    // 实测：这个项目的主活是「剧本 → 固定 JSON」，High/Max 的思维链会把 16000 预算吃光，
    // 一集正文要跑 5 分钟还出不来。Low 才是能用档，要更强思考请自己调。
    path: '/chat/completions', style: 'openai', reasoning: 'low',
  },
  {
    id: 'deepseek-pro', name: 'DeepSeek V4 Pro',
    hint: '官方长思考档（deepseek-v4-pro），更贵更强，硬推理任务用',
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro',
    path: '/chat/completions', style: 'openai', reasoning: 'low',
  },
  {
    id: 'kimi', name: 'Moonshot Kimi',
    hint: '长上下文，长篇小说改编友好',
    baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k',
    path: '/chat/completions', style: 'openai',
  },
  {
    id: 'zhipu', name: '智谱 GLM',
    hint: 'GLM-4 系列',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-air',
    path: '/chat/completions', style: 'openai',
  },
  {
    id: 'anthropic', name: 'Anthropic Claude',
    hint: 'Claude 原生协议，字段格式与 OpenAI 不同',
    baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-20241022',
    path: '/messages', style: 'anthropic',
  },
  {
    id: 'custom', name: '自定义端点',
    hint: '其他任意 OpenAI 兼容接口，自行填写',
    baseUrl: '', model: '', path: '/chat/completions', style: 'openai',
  },
]);

/* 思考强度（对应各家 API 的 reasoning_effort）：
 *   auto —— 一个字段都不发，由服务端按默认走（DeepSeek 默认 high）
 *   low / high / max —— 发 reasoning_effort + thinking:enabled（DeepSeek 官方口径）
 *   off  —— 发 thinking:{type:'disabled'}，关掉思考（非思考模式，快且省）
 * 之所以做「auto」，是因为绝大多数 OpenAI 兼容网关不认识这两个字段；
 * 不选就不发，才不会因为多一个未知字段被 4xx 打回来。 */
export const REASONING_LEVELS = Object.freeze(['auto', 'off', 'low', 'high', 'max']);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  preset: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
  path: '/chat/completions',
  style: 'openai',
  reasoning: 'auto',
  temperature: 0.85,
  // 16000 而不是 8000：思考模型（DeepSeek V4.1 默认开思考）的思维链也算在这里，
  // 8000 常常只够思考、正文还没开始。预算不够时客户端还会自动翻倍一次兜底。
  maxTokens: 16000,
  timeoutMs: 180000,
});

/** 把预设套进一份配置（用户已改过的字段不覆盖） */
export function applyPreset(cfg, presetId) {
  const p = PRESETS.find((x) => x.id === presetId) ?? PRESETS[0];
  return {
    ...cfg, preset: p.id, baseUrl: p.baseUrl, model: p.model, path: p.path, style: p.style,
    // 预设带推理等级就一起带（DeepSeek 默认 high）；不带的沿用原值
    ...(p.reasoning ? { reasoning: p.reasoning } : {}),
  };
}

/** 归一化：缺字段补默认，超范围夹紧 */
export function normalizeSettings(input) {
  const cfg = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  cfg.enabled = Boolean(cfg.enabled && cfg.apiKey && cfg.baseUrl);
  cfg.temperature = Math.min(2, Math.max(0, Number(cfg.temperature) || 0.85));
  // 上限给到 64000：DeepSeek V4.1 系列输出可到 384K，而思考模式的思维链也算在里面，
  // 32000 对长剧本（尤其开着 high）容易不够用。
  cfg.maxTokens = Math.min(128000, Math.max(256, Number(cfg.maxTokens) || 4000));
  cfg.timeoutMs = Math.min(600000, Math.max(10000, Number(cfg.timeoutMs) || 120000));
  cfg.baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
  cfg.path = String(cfg.path || '/chat/completions');
  if (!cfg.path.startsWith('/')) cfg.path = `/${cfg.path}`;
  cfg.style = cfg.style === 'anthropic' ? 'anthropic' : 'openai';
  cfg.reasoning = REASONING_LEVELS.includes(cfg.reasoning) ? cfg.reasoning : 'auto';
  return cfg;
}

/** 返回给前端的掩码配置：key 只给前后各 4 位 */
export function maskSettings(cfg) {
  const key = cfg?.apiKey ?? '';
  return {
    ...cfg,
    apiKey: key ? `${key.slice(0, 4)}${'*'.repeat(Math.max(4, key.length - 8))}${key.slice(-4)}` : '',
    hasKey: Boolean(key),
  };
}

function buildHeaders(cfg) {
  const h = { 'content-type': 'application/json' };
  if (cfg.apiKey) {
    if (cfg.style === 'anthropic') {
      h['x-api-key'] = cfg.apiKey;
      h['anthropic-version'] = '2023-06-01';
    } else {
      h.authorization = `Bearer ${cfg.apiKey}`;
    }
  }
  return h;
}

function buildBody(cfg, messages) {
  if (cfg.style === 'anthropic') {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system');
    // anthropic 风格的思考开关是 thinking:{type,budget_tokens}，和 OpenAI 的
    // reasoning_effort 不是一套口径，混发会被 400。这里不透传，走 Claude 自己的默认。
    const body = { model: cfg.model, max_tokens: cfg.maxTokens, temperature: cfg.temperature, messages: rest };
    if (sys) body.system = sys;
    return body;
  }
  const body = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages,
    stream: false,
  };
  // 思考强度：auto 一个字都不发，避免不认这两个字段的网关 400。
  // 注意思考模式下 temperature 不生效（官方为兼容不报错，也不生效）——
  // 剧本这种创意活建议留 auto/high，摘要类任务可以压到 low 省钱。
  if (cfg.reasoning === 'off') {
    body.thinking = { type: 'disabled' };
  } else if (cfg.reasoning === 'low' || cfg.reasoning === 'high' || cfg.reasoning === 'max') {
    body.reasoning_effort = cfg.reasoning;
    body.thinking = { type: 'enabled' };
  }
  return body;
}

/** 多级降级取文本：不同网关包装不一样，逐级试 */
export function extractText(cfg, json) {
  if (cfg?.style === 'anthropic') {
    if (Array.isArray(json?.content)) return json.content.map((b) => b.text ?? '').join('');
  }
  return json?.choices?.[0]?.message?.content
    ?? json?.choices?.[0]?.text
    ?? json?.content
    ?? json?.output
    ?? json?.result
    ?? json?.reply
    ?? null;
}

/** 把 HTTP 失败翻译成用户能行动的错误 */
function classifyHttp(status, body) {
  const hint = body?.error?.message ?? body?.message ?? '';
  const map = {
    401: 'API Key 无效或已过期',
    403: '没有访问该模型的权限',
    404: '端点或模型名不存在，检查 baseUrl / path / model',
    413: '请求体过大，缩短素材或调低 maxTokens',
    422: '参数不被接受（模型名 / 参数组合）',
    429: '触发了速率限制或额度不足',
    500: '模型服务内部错误',
    502: '模型服务网关错误',
    503: '模型服务暂时不可用',
    504: '模型服务响应超时',
  };
  return `${map[status] ?? `模型服务返回 ${status}`}${hint ? `：${String(hint).slice(0, 200)}` : ''}`;
}

/** max_tokens 上限，和 normalizeSettings 的夹紧值保持一致 */
const MAX_TOKENS_CAP = 128000;

/**
 * 发一次请求，不做任何补救——把「被预算截断」这个事实如实返回，由外层决定要不要加钱重试。
 * @returns {Promise<{text: string, usage: object|null, model: string, exhausted: boolean, reason: string}>}
 */
async function requestOnce(cfg, messages, { signal } = {}) {
  const url = `${cfg.baseUrl}${cfg.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify(buildBody(cfg, messages)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* 非 JSON 错误体，用原文 */ }
      throw upstreamError(classifyHttp(res.status, parsed ?? (body ? { message: body.slice(0, 200) } : null)), {
        status: res.status,
        transient: res.status >= 500 || res.status === 429,
      });
    }

    const data = await res.json();
    const choice = data?.choices?.[0];
    const text = extractText(cfg, data);
    const hasText = Boolean(text && String(text).trim());
    // 思考模型的典型坑：思维链和正文共用 max_tokens。思考吃满了就只剩 reasoning_content，
    // content 是 null；或者正文刚好被截断（finish_reason=length，JSON 半个括号）。
    const cot = String(choice?.message?.reasoning_content ?? '');
    const truncated = choice?.finish_reason === 'length';
    const exhausted = truncated || (!hasText && cot.length > 0);
    return {
      text: hasText ? String(text) : '',
      usage: data?.usage ?? null,
      model: data?.model ?? cfg.model,
      exhausted,
      reason: !hasText && cot ? 'cot-only' : truncated ? 'truncated' : '',
    };
  } catch (err) {
    if (err.name === 'AbortError') throw upstreamError('模型调用超时，可调大超时或缩短输入', { transient: true });
    if (err.code === 'UPSTREAM') throw err;
    throw upstreamError(`模型调用失败：${err.message}`, { transient: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 一次对话补全。signal 用于上层取消；超时自主管理。
 *
 * 预算自愈：思考模型（deepseek-flash 默认开思考）会把思维链算进 max_tokens，
 * 8000 这种默认值经常被思考吃光，正文直接是 null。这里遇到「被截断 / 只有思维链」
 * 就自动把 max_tokens 翻倍再要一次——只为拿到正文，不改用户保存的设置，也最多翻一次。
 * @returns {Promise<{text: string, usage: object|null, model: string, escalated?: boolean}>}
 */
export async function chatComplete(cfg, messages, { signal } = {}) {
  const first = await requestOnce(cfg, messages, { signal });
  if (!first.exhausted && first.text) return first;

  const bigger = { ...cfg, maxTokens: Math.min(MAX_TOKENS_CAP, Math.round(cfg.maxTokens * 2)) };
  if (bigger.maxTokens > cfg.maxTokens) {
    logger.warn('llm.budget.escalate', { from: cfg.maxTokens, to: bigger.maxTokens, reason: first.reason });
    const second = await requestOnce(bigger, messages, { signal });
    if (second.text) return { ...second, escalated: true };
    if (second.exhausted) {
      throw upstreamError(
        `模型只输出了思维链、没有正文（思考把最大 Token ${bigger.maxTokens} 也占满了）：`
        + '把「最大 Token」再调大，或把推理等级降到 Low / 关闭思考', { transient: true });
    }
    throw upstreamError('模型返回内容为空', { transient: true });
  }

  if (first.text) return first; // 已封顶：有正文就照用，截断交给上层 JSON 修复
  throw upstreamError(first.exhausted
    ? `模型只输出了思维链、没有正文（思考占满了最大 Token ${cfg.maxTokens}）：把「最大 Token」调大，或把推理等级降到 Low / 关闭思考`
    : '模型返回内容为空', { transient: true });
}

/**
 * 拉取可用模型列表（GET /models）。
 * 手填模型名最容易出错——名字差一个字符就是 404，而 404 的报错又容易被误读成「Key 不对」。
 * 能拉到就直接给下拉选；拉不到（有些网关不实现这个端点）不报错，前端继续允许手填。
 */
export async function listModels(cfg) {
  const url = `${cfg.baseUrl}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { method: 'GET', headers: buildHeaders(cfg), signal: controller.signal });
    if (!res.ok) throw upstreamError(classifyHttp(res.status, null));
    const data = await res.json();
    const raw = Array.isArray(data?.data) ? data.data
      : Array.isArray(data?.models) ? data.models
        : Array.isArray(data) ? data : [];
    const items = raw
      .map((m) => (typeof m === 'string' ? m : m?.id ?? m?.name ?? ''))
      .filter(Boolean)
      .sort((a, b) => String(a).localeCompare(String(b)));
    logger.info('llm.models', { count: items.length });
    return items;
  } catch (err) {
    if (err.name === 'AbortError') throw upstreamError('拉取模型列表超时', { transient: true });
    if (err.code === 'UPSTREAM') throw err;
    throw upstreamError(`拉取模型列表失败：${err.message}`, { transient: true });
  } finally {
    clearTimeout(timer);
  }
}

/** 测试连接：发一个最小请求，只验证链路通不通 */
export async function testConnection(cfg) {
  const t0 = Date.now();
  const { text, model } = await chatComplete(cfg, [
    { role: 'user', content: '回复两个字：正常' },
  ], undefined);
  const ms = Date.now() - t0;
  logger.info('llm.test.ok', { model, ms });
  return { ok: true, ms, model, sample: text.slice(0, 40) };
}
