/* 红果短剧官网榜单 · 真实抓取器（不是内置样本）
 *
 * 目标页：https://hongguoduanju.com/rank/hot-real-drama
 * 该页是服务端渲染（SSR）：HTML 里内联了一段站点状态 JSON，其中
 *   content.rankList  → 20 条榜单条目（排名/剧名/热度/评分/收藏/点赞/题材/主演/简介/集数/封面/链接）
 *   updatedText       → 榜单日期文案，如「11月12日已更新·基于红果内观看/互动等综合热度排序」
 *
 * 只取公开榜单字段：不登录、不带 cookie、不读用户数据、不写任何远端。
 * 抓不到就抛错，由调用方回落到内置剧目库——绝不返回空榜而不报。
 */
const BOARD_URL = 'https://hongguoduanju.com/rank/hot-real-drama';
const SITE = 'https://hongguoduanju.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 从 HTML 里截出 "rankList":[...] 的数组文本：做括号配对，跳过字符串内部的方括号。 */
function extractRankListText(html) {
  const key = '"rankList":';
  const at = html.indexOf(key);
  if (at < 0) throw new Error('榜单页结构变了：没找到 rankList');
  let i = at + key.length;
  while (i < html.length && /\s/.test(html[i])) i += 1;
  if (html[i] !== '[') throw new Error('榜单页结构变了：rankList 之后不是数组');

  const start = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i += 1) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error('榜单页结构变了：rankList 数组没有闭合');
}

/** "6669万热度" → 6669（万）；"1.2亿热度" → 12000（万）；拿不到数字就 return null */
function heatToWan(text) {
  const s = String(text ?? '');
  const yi = s.match(/([\d.]+)\s*亿/);
  if (yi) return Math.round(Number(yi[1]) * 10000);
  const wan = s.match(/([\d.]+)\s*万/);
  if (wan) return Math.round(Number(wan[1]));
  return null;
}

/** 取简介第一句当推荐语（遇到 。！？ 就断），用于 pitch；太长截断。 */
function firstSentence(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const cut = s.split(/(?<=[。！？])/)[0] ?? s;
  return cut.length > 60 ? `${cut.slice(0, 60)}…` : cut;
}

/** "11月12日已更新·基于…" → "2026-11-12"（年份取当前年；跨年落到 12 月时按当前年推） */
function parseBoardDate(updatedText, now = new Date()) {
  const m = String(updatedText ?? '').match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return now.toISOString().slice(0, 10);
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = now.getMonth() + 1 <= 1 && month >= 12 ? now.getFullYear() - 1 : now.getFullYear();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 本地可读时间（界面要直接显示，别露 ISO 原文）：2026-11-13 00:05 */
function fmtLocal(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 把榜单原始条目转成剧目库同一套字段（crawlService.dramaToItem 直接吃这套）。 */
function toDrama(r) {
  const tags = Array.isArray(r.tags) ? r.tags.filter(Boolean).map(String) : [];
  const href = String(r.href ?? '');
  const playHref = String(r.playHref ?? '');
  const detailAbs = href.startsWith('http') ? href : `${SITE}${href}`;
  const playAbs = playHref.startsWith('http') ? playHref : `${SITE}${playHref}`;
  return {
    rank: Number(r.rank) || 0,
    title: String(r.title ?? '').trim(),
    genre: tags[0] ?? '',
    tags,
    platform: '红果短剧',
    heat: heatToWan(r.heatText ?? r.primaryMetricText),
    heatText: String(r.heatText ?? r.primaryMetricText ?? ''),
    episodes: r.episodeCount == null ? null : Number(r.episodeCount),
    synopsis: String(r.description ?? ''),
    pitch: firstSentence(r.description),
    pitchSource: 'source',
    url: detailAbs,
    urlNote: `红果官方详情页（series_id ${r.seriesId ?? r.id}）`,
    playUrl: playAbs,
    cover: String(r.cover ?? ''),
    coverNote: '',
    // 官网独有的量化字段，留给界面/分析用，缺了也不影响
    scoreText: String(r.scoreText ?? ''),
    favoriteText: String(r.favoriteText ?? ''),
    likeText: String(r.likeText ?? ''),
    seriesId: String(r.seriesId ?? r.id ?? ''),
  };
}

/**
 * 抓当前榜单。
 * @param {object} opt
 * @param {number} opt.limit   要多少条（1–20）
 * @param {string} opt.genre   题材/关键词过滤（命中题材、标签或剧名）
 * @param {number} opt.timeoutMs
 * @returns {Promise<{items: object[], meta: object, source: 'remote'}>}
 */
export async function fetchBoard({ limit = 10, genre = '', timeoutMs = 15000 } = {}) {
  const res = await fetch(BOARD_URL, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`榜单页返回 HTTP ${res.status}`);
  const html = await res.text();

  const raw = JSON.parse(extractRankListText(html));
  if (!Array.isArray(raw) || !raw.length) throw new Error('榜单页 rankList 是空的');

  const updatedText = (() => {
    const m = html.match(/"updatedText":"((?:[^"\\]|\\.)*)"/);
    if (!m) return '';
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return '';
    }
  })();

  const all = raw.map(toDrama).filter((d) => d.title);

  const kw = String(genre ?? '').trim();
  const matched = kw
    ? all.filter((d) => d.genre === kw || d.tags.includes(kw) || d.title.includes(kw))
    : all;

  const items = matched.slice(0, Math.max(1, Math.min(20, limit)));

  return {
    items,
    source: 'remote',
    meta: {
      board: '红果短剧 · 真人剧热播榜（官网实时）',
      dataDate: parseBoardDate(updatedText),
      updatedAt: fmtLocal(),
      platform: '红果短剧',
      updatedText,
      total: all.length,
      sources: [{ name: '红果短剧官网 · 真人剧热播榜', url: BOARD_URL }],
      verifyNote: '排名/热度/评分/收藏/点赞/题材/主演/简介/集数全部直取官网榜单页当天快照，未经人工改写。',
      todos: [],
    },
  };
}

export const BOARD = { url: BOARD_URL };
