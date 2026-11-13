/* openai SDK 传输层（可选）
 *
 * 为什么保留自研 fetch 而不是全量替换：
 *   现有链路里有一整套「思考模型被 max_tokens 截断 → 自动翻倍重试」的补救逻辑，
 *   以及 Anthropic 原生协议的字段适配，都是围绕自研 fetch 写的。贸然全换会动到主链路。
 * 所以这里只提供一条平行通道：设置里 transport='sdk' 才走 SDK，默认仍走原生 fetch。
 *
 * SDK 的收益：连接复用、超时/重试语义统一、流式与工具调用的现成实现。
 * 代价：多一个依赖。所以按需动态 import，未启用时完全不加载。
 */
import { logger } from '../logger.js';
import { upstreamError } from '../errors.js';

let clientCache = null;
let clientKey = '';

function buildClient(cfg) {
  const cacheKey = `${cfg.baseUrl}|${cfg.apiKey}|${cfg.timeoutMs}`;
  if (clientCache && clientKey === cacheKey) return clientCache;
  const OpenAI = openaiCtor;
  clientCache = new OpenAI({
    apiKey: cfg.apiKey || 'no-key',
    baseURL: String(cfg.baseUrl || '').replace(/\/+$/, '') || undefined,
    timeout: Number(cfg.timeoutMs) || 120000,
    maxRetries: 0, // 重试策略交给上层的 retryPolicy，避免双层重试放大调用
  });
  clientKey = cacheKey;
  return clientCache;
}

let openaiCtor = null;

/** 懒加载 SDK 构造器。 */
export async function loadSdk() {
  if (openaiCtor) return openaiCtor;
  try {
    const mod = await import('openai');
    openaiCtor = mod.default ?? mod.OpenAI;
    if (typeof openaiCtor !== 'function') throw new Error('openai 模块没有导出构造器');
    logger.info('llm.transport.sdk.loaded', {});
    return openaiCtor;
  } catch (e) {
    throw upstreamError(`openai SDK 不可用：${e.message}`, { transient: false });
  }
}

/**
 * 与 requestOnce 返回同样的结构，方便 chatComplete 无差别使用。
 * @returns {Promise<{text:string, usage:object|null, model:string, exhausted:boolean, reason:string}>}
 */
export async function requestViaSdk(cfg, messages, { signal } = {}) {
  const OpenAI = await loadSdk();
  const client = buildClient(cfg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 120000);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const body = {
      model: cfg.model,
      messages: (messages ?? []).map((m) => ({
        role: m.role === 'system' ? 'system' : m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? ''),
      })),
    };
    if (cfg.maxTokens) body.max_tokens = cfg.maxTokens;
    if (cfg.temperature !== undefined && cfg.temperature !== null) body.temperature = cfg.temperature;

    const resp = await client.chat.completions.create(body, { signal: controller.signal });
    const choice = resp?.choices?.[0];
    const text = choice?.message?.content ?? '';
    const cot = String(choice?.message?.reasoning_content ?? '');
    const truncated = choice?.finish_reason === 'length';
    const hasText = Boolean(String(text).trim());
    return {
      text: hasText ? String(text) : '',
      usage: resp?.usage ?? null,
      model: resp?.model ?? cfg.model,
      exhausted: truncated || (!hasText && cot.length > 0),
      reason: !hasText && cot ? 'cot-only' : truncated ? 'truncated' : '',
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw upstreamError('模型调用超时，可调大超时或缩短输入', { transient: true });
    const status = err?.status ?? err?.response?.status;
    if (status) throw upstreamError(`模型服务返回 ${status}：${String(err.message ?? '').slice(0, 200)}`, {
      status, transient: status >= 500 || status === 429,
    });
    throw upstreamError(`模型调用失败（SDK）：${err?.message ?? err}`, { transient: true });
  } finally {
    clearTimeout(timer);
  }
}

/** 供接口自检用：真实发一次最小请求，证明 SDK 通道可用。 */
export async function probeSdk(cfg) {
  const OpenAI = await loadSdk();
  const client = buildClient(cfg);
  const resp = await client.chat.completions.create({
    model: cfg.model,
    messages: [{ role: 'user', content: '回答一个字：好' }],
    max_tokens: 8,
  });
  return { model: resp?.model ?? cfg.model, text: resp?.choices?.[0]?.message?.content ?? '' };
}
