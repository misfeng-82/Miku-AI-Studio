import { config } from '../config.js';
import { logger } from '../logger.js';
import { upstreamError } from '../errors.js';
import { loadJsonLike } from './jsonRepair.js';
import { mockComplete } from './mockData.js';
import { chatComplete, normalizeSettings, applyPreset, PRESETS } from './llmClient.js';
import * as settingsRepo from '../repo/settingsRepo.js';
import * as llmUsageRepo from '../repo/llmUsageRepo.js';

// 手写 Agent 循环的核心调用点：不引入任何编排框架，一次「问-答-解析-校验」就是一个循环体。
// 配置优先级：网页里填的运行时设置 > .env 环境变量 > 本地 mock。
// 任一层缺 key 就往下退，永远可用；API 失败由上层决定是否降级到 mock。

/** 当前生效的 LLM 配置（含来源标记） */
export function effectiveConfig() {
  const runtime = settingsRepo.getSettings();
  if (runtime?.enabled && runtime.apiKey && runtime.baseUrl) {
    return { cfg: normalizeSettings(runtime), source: 'runtime' };
  }
  if (config.llm.useMock || !config.llm.apiKey || !config.llm.baseUrl) {
    return { cfg: null, source: 'mock' };
  }
  return {
    cfg: normalizeSettings({
      enabled: true,
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      timeoutMs: config.llm.timeoutMs,
    }),
    source: 'env',
  };
}

export function isMock() {
  return effectiveConfig().source === 'mock';
}

/** 给前端的接入状态摘要 */
export function status() {
  const { cfg, source } = effectiveConfig();
  return {
    mode: source,
    model: cfg?.model ?? null,
    baseUrl: cfg?.baseUrl ?? null,
    preset: cfg?.preset ?? null,
    reasoning: cfg?.reasoning ?? 'auto',
    presets: PRESETS.map((p) => ({ id: p.id, name: p.name, hint: p.hint })),
  };
}

export async function complete({ system = '', user = '', signal } = {}) {
  const { cfg, source } = effectiveConfig();
  if (source === 'mock' || !cfg) {
    logger.debug('llm.mock', { chars: user.length });
    return mockComplete({ system, user });
  }
  // 任务标识取自 prompt 里的 __TASK__ 标记（outline / epscript / eval…），
  // 用来把用量按场景分开统计——用户要能看出「钱主要花在哪一步」
  const task = /__TASK__:\s*([a-zA-Z_-]+)/.exec(user)?.[1] ?? 'other';
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: user },
  ];

  const t0 = Date.now();
  try {
    const { text, usage, model } = await chatComplete(cfg, messages, { signal });
    // 只记元数据，不记 prompt 与返回正文
    llmUsageRepo.record({
      task,
      model: model ?? cfg.model,
      ms: Date.now() - t0,
      ok: true,
      // OpenAI 用 prompt/completion_tokens，Anthropic 用 input/output_tokens
      promptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
    });
    return text;
  } catch (err) {
    // 失败的调用也要记：用户要能看到「刚才那次为什么失败、等了多久才失败」
    llmUsageRepo.record({ task, model: cfg.model, ms: Date.now() - t0, ok: false, error: err.message });
    throw err;
  }
}

/**
 * 带重试与 JSON 兜底的一次「问-答」。
 * 重试只针对传输层/解析失败；业务性失败交给上层判定，不在这里盲目重试。
 */
export async function completeJson({ system = '', user = '', attempts } = {}) {
  const max = attempts ?? config.llm.maxRetries;
  let lastErr;
  for (let i = 1; i <= max; i += 1) {
    try {
      const raw = await complete({ system, user });
      return loadJsonLike(raw);
    } catch (err) {
      lastErr = err;
      logger.warn('llm.json.parse.retry', { attempt: i, reason: err.message });
    }
  }
  throw upstreamError(`模型输出无法解析为 JSON（已重试 ${max} 次）：${lastErr?.message}`);
}

export { normalizeSettings, applyPreset, PRESETS, chatComplete, testConnection } from './llmClient.js';
