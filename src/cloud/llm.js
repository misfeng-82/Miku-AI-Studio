/**
 * 云端大模型调用（免密钥）
 *
 * 云服务文档规定：只能用官方 SDK，且只支持流式（stream: true），
 * 非流式会被 SDK 在发请求前就拒绝。所以这里按「流式收集」的方式拿全文：
 * 逐 chunk 累加 delta.content，直到 [DONE]。
 *
 * 为什么值得接：云端站点不再需要用户自己填 Key，访客点「生成」直接用平台额度。
 */
import { cloudClient, publicConfig } from './client.js';
import { logger } from '../logger.js';
import { upstreamError } from '../errors.js';

let modelCache = null;

/**
 * 取一个可用模型。
 * 优先级：配置里指定的 model > 列表里第一个可用的（跳过 auto）。
 *
 * 为什么跳过 auto：实测 auto 对短问答正常，但一到长输出（几百字以上）会整分钟不吐字，
 * 最后空内容超时。指定具体模型（glm-5.3-flash / deepseek-v4-flash 等）1.5–2 秒就回。
 */
export async function cloudModel() {
  if (modelCache) return modelCache;
  const cloud = cloudClient();
  if (!cloud) throw upstreamError('云服务未配置', { kind: 'config', retryable: false });
  const list = await cloud.llm.models.list();
  const usable = (list ?? []).filter((m) => m.disabled !== true);

  const preferred = publicConfig()?.model;
  const picked = (preferred && usable.find((m) => m.id === preferred))
    ?? usable.find((m) => m.id !== 'auto' && m.id !== 'default')
    ?? usable[0];

  if (!picked) {
    throw upstreamError('云服务里没有可用模型：请在云服务控制台确认模型已启用', { kind: 'config', retryable: false });
  }
  modelCache = picked;
  return picked;
}

/**
 * 一次问答。messages 必须自带 system 首条（与 OpenAI 口径一致，SDK 不会帮你塞）。
 * @returns {{ text: string, usage: object|null, model: string }}
 */
export async function cloudChat({ messages, signal, timeoutMs = 180000 } = {}) {
  const cloud = cloudClient();
  if (!cloud) throw upstreamError('云服务未配置', { kind: 'config', retryable: false });

  const model = await cloudModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const t0 = Date.now();
  let text = '';
  let usage = null;
  try {
    const stream = cloud.llm.chat.completions.create({
      model: model.id,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta;
      if (delta?.content) text += delta.content;
      if (chunk?.usage) usage = chunk.usage;
    }
  } catch (err) {
    const code = err?.error?.code ?? err?.code ?? 'unknown';
    logger.warn('cloud.llm.fail', { model: model.id, code, ms: Date.now() - t0 });
    // 分类转成项目统一的 upstreamError，让上层重试策略认得
    const kind = String(code).startsWith('quota_') ? 'rate_limit'
      : String(code).startsWith('auth_') ? 'config'
        : String(code).startsWith('request_') ? 'config'
          : 'upstream';
    throw upstreamError(`云端模型调用失败：${err?.error?.message ?? err.message}`, { kind, retryable: kind === 'rate_limit' || kind === 'upstream' });
  } finally {
    clearTimeout(timer);
  }

  if (!text.trim()) {
    throw upstreamError('云端模型返回了空内容', { kind: 'upstream', retryable: true });
  }
  logger.info('cloud.llm.ok', { model: model.id, ms: Date.now() - t0, chars: text.length });
  return { text, usage, model: model.id };
}
