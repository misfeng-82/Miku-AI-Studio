import { config } from '../config.js';
import { store } from '../repo/jsonStore.js';
import { HOT_DRAMAS, HOT_BOARD_META } from '../assets/hotDramas.js';
import { deriveHookTypes } from './analyzeService.js';
import { upstreamError, validationError } from '../errors.js';
import { logger } from '../logger.js';

// 抓取层：只有一条路——fetchHot（剧目库）：真实剧目榜，确定性返回，**永远不调 LLM**。
//   以前这里是按种子随机拼剧名的「样本库」——没有链接、没有海报，对标分析
//   等于拿假剧当基准。现在换成 assets/hotDramas.js 里集中维护的真实剧目，
//   更新榜单只改那个文件。榜单是事实数据，绝不让模型编。
// 配了 CRAWL_ENDPOINT 且 CRAWL_USE_MOCK=0 时，fetchRemote 发真实请求且必须白名单校验。

const HOT_KEY = 'hot-dramas';

/**
 * 把剧目库条目补齐成分析/界面要的字段（纯函数，测试直接喂数据）。
 * 钩子类型不人工标注——用全项目同一套词表在剧名/梗概/标签上扫，
 * 和自家剧本、对标分析同一口径。
 */
export function dramaToItem(d) {
  const text = `${d.title}${d.synopsis ?? ''}${d.pitch ?? ''}${(d.tags ?? []).join('')}`;
  return {
    rank: d.rank,
    title: d.title,
    genre: d.genre,
    platform: d.platform,
    heat: d.heat,
    heatText: d.heatText ?? '',
    episodes: d.episodes ?? null,
    synopsis: d.synopsis || d.pitch || '',
    pitch: d.pitch ?? '',
    tags: [...(d.tags ?? [])],
    hookTypes: deriveHookTypes(text),
    url: d.url ?? '',
    urlNote: d.urlNote ?? '',
    playUrl: d.playUrl ?? '',
    cover: d.cover ?? '',
    coverNote: d.coverNote ?? '',
  };
}

/** 按题材/关键词筛，再截条数。排名保持榜单原排名，不因筛选重排 */
export function pickDramas({ limit = 10, genre = '' } = {}) {
  const kw = String(genre ?? '').trim();
  const matched = kw
    ? HOT_DRAMAS.filter((d) => d.genre === kw || (d.tags ?? []).includes(kw) || d.title.includes(kw))
    : HOT_DRAMAS;
  return matched.slice(0, Math.max(1, limit)).map(dramaToItem);
}

export async function fetchHot({ limit = 10, genre = '', refresh = false } = {}) {
  if (limit < 1 || limit > 100) throw validationError('limit 必须在 1 到 100 之间');

  const kw = String(genre ?? '').trim();
  if (!refresh) {
    const cached = store.read(HOT_KEY, null);
    // 条数够用、题材也一致才走缓存；否则重新取，避免「换题材拿到旧榜」
    // 命中缓存也要按当前 limit 截断：缓存里存的是全集，不能整包丢给前端
    if ((cached?.items?.length ?? 0) >= limit && (cached?.genre ?? '') === kw) {
      return { ...cached, items: cached.items.slice(0, limit) };
    }
  }

  let payload;
  if (config.crawl.useMock || !config.crawl.endpoint) {
    // 真实剧目库：assets/hotDramas.js 里人工维护、带来源与更新日期。
    // 同一 limit/genre 永远同一份，对标分析可复现；也不花一分钱。
    payload = { items: pickDramas({ limit, genre }), source: 'curated', meta: HOT_BOARD_META };
  } else {
    payload = await fetchRemote({ limit, genre });
  }

  const result = {
    items: Array.isArray(payload?.items) ? payload.items : [],
    source: payload?.source ?? 'remote',
    meta: payload?.meta ?? null,
    genre: kw,
    fetchedAt: new Date().toISOString(),
  };
  store.write(HOT_KEY, result);
  logger.info('crawl.fetched', { count: result.items.length, source: result.source });
  return result;
}

async function fetchRemote({ limit, genre }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.crawl.timeoutMs);
  try {
    const url = new URL(config.crawl.endpoint);
    url.searchParams.set('limit', String(limit));
    if (genre) url.searchParams.set('genre', genre);
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw upstreamError(`榜单接口返回 ${res.status}`);
    const data = await res.json();
    return { items: Array.isArray(data) ? data : (data.items ?? []), source: url.hostname };
  } catch (err) {
    if (err.name === 'AbortError') throw upstreamError('榜单接口超时');
    if (err.code === 'UPSTREAM') throw err;
    throw upstreamError(`榜单抓取失败：${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

export function getCached() {
  return store.read(HOT_KEY, { items: [], source: 'empty', fetchedAt: null });
}

// 把榜单条目里的「钩子类型」汇总成写作参考，供剧本生成阶段直接消费
export function summarizeHooks(hot) {
  const counter = new Map();
  for (const it of hot?.items ?? []) {
    for (const h of it.hookTypes ?? []) counter.set(h, (counter.get(h) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
