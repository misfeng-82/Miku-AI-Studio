import { config } from '../config.js';
import { logger } from '../logger.js';
import { upstreamError, conflict } from '../errors.js';
import { loadJsonLike } from './jsonRepair.js';
import { mockComplete } from './mockData.js';
import { classifyError, backoffMs, ERROR_KIND, JSON_REPAIR_HINT } from './retryPolicy.js';
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
    // 只有显式打开 USE_MOCK 才走样本引擎（自测 / 离线开发用）
    if (config.llm.useMock) {
      return { cfg: null, source: 'mock' };
    }
    if (!config.llm.apiKey || !config.llm.baseUrl) {
      // 产品默认真实模式：没配置就是「未接入」。
      // 绝不静默降级成样本稿——那会让用户以为模型写出来了，实际是内置模板。
      return { cfg: null, source: 'unconfigured' };
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

export async function complete({ system = '', user = '', signal, attempt = 1 } = {}) {
    const { cfg, source } = effectiveConfig();
    if (source === 'unconfigured') {
      // 用 CONFLICT(409) 而不是 UPSTREAM(502)：这是「本方还没配置」，
      // 不是服务商故障。502 会被重试策略当成 5xx 反复重试，还误导用户。
      throw conflict(
        '还没有接入模型：点右上角「接 API」填 Key 与 Base URL 才能生成。'
        + '真实生成必须接模型，本项目不返回兜底样本稿',
      );
    }
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
      attempt,
      // OpenAI 用 prompt/completion_tokens，Anthropic 用 input/output_tokens
      promptTokens: usage?.prompt_tokens ?? usage?.input_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? usage?.output_tokens ?? 0,
    });
    return text;
  } catch (err) {
    // 失败的调用也要记：用户要能看到「刚才那次为什么失败、等了多久才失败」
    llmUsageRepo.record({ task, model: cfg.model, ms: Date.now() - t0, ok: false, attempt, error: err.message });
    throw err;
  }
}

/**
 * 带「分类重试」与 JSON 兜底的一次「问-答」。
 *
 * 与旧版的关键差别：旧版把所有错误一律重试 N 次，导致两类纯浪费——
 *   · 余额不足 / Key 无效 / 模型名不存在：重试一万次也不会变好
 *   · 超时：拿同一份超大输入重试，大概率再超时，只是又等 120 秒
 * 现在按 retryPolicy 分类：配置类错误立刻失败并给出可执行建议；
 * 只有限流/5xx/网络抖动/JSON 没解析出来才退避重试；超时最多再试 1 次。
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function completeJson({ system = '', user = '', attempts } = {}) {
  const hardCap = attempts ?? config.llm.maxRetries;
  let lastErr;
  let repairSuffix = '';

  for (let i = 1; i <= hardCap; i += 1) {
    try {
      const raw = await complete({ system, user: user + repairSuffix, attempt: i });
      return loadJsonLike(raw);
    } catch (err) {
      lastErr = err;
      const p = classifyError(err);

      if (!p.retryable) {
        // 配置类错误：立刻抛，别拿额度去试。
        // 如果下层已经给出了明确的业务错误码（如 409 未接入 / 400 参数），
        // 原样上抛——再包一层会把文案和状态码都搞脏。
        logger.warn('llm.giveup', { attempt: i, kind: p.kind, reason: String(err.message).slice(0, 120) });
        if (err?.code && err.code !== 'UPSTREAM') throw err;
        throw upstreamError(`${p.hint}（原始错误：${err.message}）`, { kind: p.kind, retryable: false });
      }
      if (i >= p.maxAttempts) {
        logger.warn('llm.giveup', { attempt: i, kind: p.kind, reason: String(err.message).slice(0, 120) });
        throw upstreamError(`${p.hint}（已尝试 ${i} 次，最后一次：${err.message}）`, { kind: p.kind, retryable: true });
      }

      // 解析失败时下一轮追加"只输出 JSON"的提示——这一条能显著提高二次命中
      if (p.kind === ERROR_KIND.PARSE) repairSuffix = JSON_REPAIR_HINT;

      const wait = backoffMs(i, p.kind);
      logger.warn('llm.retry', { attempt: i, kind: p.kind, waitMs: wait, reason: String(err.message).slice(0, 80) });
      await sleep(wait);
    }
  }
  throw upstreamError(`模型输出无法解析为 JSON（已重试 ${hardCap} 次）：${lastErr?.message}`);
}

export { normalizeSettings, applyPreset, PRESETS, chatComplete, testConnection } from './llmClient.js';
