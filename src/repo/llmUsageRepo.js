import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from '../config.js';

/*
 * 模型调用用量记录。
 *
 * 为什么要有这个：接上模型之后，用户最想知道的其实只有两件事——
 * 「这次生成到底花了我多少 token」和「刚才那次为什么这么慢 / 为什么会失败」。
 * 之前这两件事都是黑盒：扣了钱看不见、慢也不知道是模型慢还是卡住了。
 *
 * 记录原则：
 *   - **只记元数据**（时间 / 任务 / 模型 / 耗时 / token / 成败），绝不记 prompt 正文与返回内容
 *   - 落 data/llm-usage.json，纯本地，不出机器
 *   - recent 只留最近 100 条，累计值单独存，避免文件无限膨胀
 */

const FILE = resolve(config.dataDir, 'llm-usage.json');
const KEEP_RECENT = 100;

const EMPTY = Object.freeze({
  totals: { calls: 0, ok: 0, failed: 0, promptTokens: 0, completionTokens: 0, ms: 0 },
  byTask: {},
  byModel: {},
  recent: [],
});

let cache = null;

function read() {
  if (cache) return cache;
  if (!existsSync(FILE)) { cache = JSON.parse(JSON.stringify(EMPTY)); return cache; }
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'));
    cache = {
      totals: { ...EMPTY.totals, ...(raw?.totals ?? {}) },
      byTask: raw?.byTask ?? {},
      byModel: raw?.byModel ?? {},
      recent: Array.isArray(raw?.recent) ? raw.recent : [],
    };
  } catch {
    cache = JSON.parse(JSON.stringify(EMPTY));
  }
  return cache;
}

function persist(data) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = data;
}

const bump = (bucket, key, entry) => {
  const cur = bucket[key] ?? { calls: 0, ok: 0, failed: 0, tokens: 0, ms: 0 };
  cur.calls += 1;
  if (entry.ok) cur.ok += 1; else cur.failed += 1;
  cur.tokens += (entry.promptTokens ?? 0) + (entry.completionTokens ?? 0);
  cur.ms += entry.ms ?? 0;
  bucket[key] = cur;
};

/**
 * 记一次调用。
 *
 * attempt 用来算「命中率」：只有第 1 次尝试就成功，才算一次命中。
 * 之前的账本只记成功/失败，看不出「一次就过」和「重试 3 次才过」的区别，
 * 而这恰恰是额度浪费的主要来源。
 *
 * @param entry { task, model, ms, ok, attempt, promptTokens, completionTokens, error }
 */
export function record(entry) {
  const data = read();
  const attempt = Math.max(1, Math.round(entry.attempt ?? 1));
  const e = {
    task: entry.task || 'other',
    model: entry.model || '',
    ms: Math.round(entry.ms ?? 0),
    ok: Boolean(entry.ok),
    attempt,
    promptTokens: Math.max(0, Math.round(entry.promptTokens ?? 0)),
    completionTokens: Math.max(0, Math.round(entry.completionTokens ?? 0)),
  };
  if (!e.ok && entry.error) e.error = String(entry.error).slice(0, 160);
  // 历史文件没有这两个字段，读的时候补 0，避免老数据算出 NaN
  if (!Number.isFinite(data.totals.attempt1Calls)) data.totals.attempt1Calls = 0;
  if (!Number.isFinite(data.totals.attempt1Ok)) data.totals.attempt1Ok = 0;

  data.totals.calls += 1;
  if (e.ok) data.totals.ok += 1; else data.totals.failed += 1;
  if (attempt === 1) {
    data.totals.attempt1Calls += 1;
    if (e.ok) data.totals.attempt1Ok += 1;
  }
  data.totals.promptTokens += e.promptTokens;
  data.totals.completionTokens += e.completionTokens;
  data.totals.ms += e.ms;

  bump(data.byTask, e.task, e);
  bump(data.byModel, e.model || '(未指定)', e);

  data.recent.unshift({ ts: Date.now(), ...e });
  if (data.recent.length > KEEP_RECENT) data.recent.length = KEEP_RECENT;

  persist(data);
  return e;
}

/** 汇总给前端：累计 + 分组 + 最近记录（足够渲染一张用量卡） */
export function summary() {
  const data = read();
  const t = data.totals;
  const toRows = (bucket) => Object.entries(bucket)
    .map(([key, v]) => ({
      key,
      calls: v.calls,
      ok: v.ok,
      failed: v.failed,
      tokens: v.tokens,
      avgMs: v.calls ? Math.round(v.ms / v.calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);
  return {
    totals: {
      ...t,
      successRate: t.calls ? Math.round((t.ok / t.calls) * 100) : 100,
      // 命中率 = 第 1 次尝试就成功的比例。与 successRate 分开看：
      // 成功率 90% 但命中率 60%，说明一半的成功靠重试堆出来，额度在漏。
      hitRate: t.attempt1Calls ? Math.round(((t.attempt1Ok ?? 0) / t.attempt1Calls) * 100) : null,
      retried: t.calls - (t.attempt1Calls ?? 0),
      avgMs: t.calls ? Math.round(t.ms / t.calls) : 0,
      tokens: t.promptTokens + t.completionTokens,
    },
    byTask: toRows(data.byTask),
    byModel: toRows(data.byModel),
    recent: data.recent.slice(0, 20),
  };
}

export function reset() {
  persist(JSON.parse(JSON.stringify(EMPTY)));
}
