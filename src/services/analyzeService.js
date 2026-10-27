import { estimateSeconds } from './scriptService.js';

// 爆款结构拆解：把「热门短剧」与「自家剧本」都拆成可对比的结构指标。
// 三个参考仓库都没有这个功能（manga-studio 的「钩子」只是自家宣传片时间轴），
// 这里按影视结构分析的通行口径实现：钩子、爽点密度、节奏曲线、对白密度。

const HOOK_WORDS = [
  '身份', '真相', '失踪', '背叛', '重生', '复仇', '怀孕', '退婚', '打脸', '离婚',
  '继承', '隐藏', '秘密', '救命', '危机', '赌注', '最后', '竟然', '居然', '原来',
];
const PAYOFF_WORDS = ['揭穿', '曝光', '跪下', '道歉', '反转', '认出', '亮出', '碾压', '拿下', '赢了'];
const EMOTION_WORDS = ['哭', '笑', '怒', '慌', '惊', '怕', '恨', '爱', '痛', '急'];

const count = (text, words) => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);

/**
 * 按同一套钩子词表命中标出的钩子类型。
 * 真实剧目榜没有人工标注的「钩子类型」字段，与其拍脑袋造一个，不如用
 * 全项目同一套词表在「剧名 + 梗概 + 标签」上扫——口径与自家剧本、对标分析
 * 完全一致，横向可比，也避免了编数据。
 */
export function deriveHookTypes(text) {
  const t = String(text ?? '');
  return HOOK_WORDS.filter((w) => t.includes(w));
}

/** 单条作品的钩子画像 */
export function profileItem(it) {
  const text = `${it.title ?? ''}${it.synopsis ?? ''}${it.pitch ?? ''}${(it.hookTypes ?? []).join('')}${(it.tags ?? []).join('')}`;
  const hookTypes = it.hookTypes ?? [];
  return {
    rank: it.rank,
    title: it.title,
    genre: it.genre,
    platform: it.platform,
    heat: it.heat,
    episodes: it.episodes,
    hookTypes,
    // 文本里真正命中的钩子词，比「人工标注的 hookTypes」更适合真实数据
    hooks: deriveHookTypes(text),
    hookHits: count(text, HOOK_WORDS),
    payoffHits: count(text, PAYOFF_WORDS),
    emotionHits: count(text, EMOTION_WORDS),
    // 爽点密度＝每 10 集摊到几个钩子，密度越高节奏越紧
    hookDensity: it.episodes ? Math.round((hookTypes.length / it.episodes) * 100) / 10 : 0,
  };
}

/** 榜单整体画像：回答「现在的爆款长什么样」 */
export function analyzeHot(hot) {
  const items = (hot?.items ?? []).map(profileItem);
  const byGenre = new Map();
  const byPlatform = new Map();
  const hookCounter = new Map();

  for (const p of items) {
    byGenre.set(p.genre, (byGenre.get(p.genre) ?? 0) + 1);
    byPlatform.set(p.platform, (byPlatform.get(p.platform) ?? 0) + 1);
    // 用「词表实际命中」统计：真实剧目没有 hookTypes 标注，扫文本才有东西
    for (const h of p.hooks) hookCounter.set(h, (hookCounter.get(h) ?? 0) + 1);
  }

  const top = (m, n = 6) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([name, value]) => ({ name, value }));

  // 只平均「有数」的条目：真实榜单里集数常缺（null），
  // 拿 0 参与平均会把基准压成 0——宁可不平均，也不造假数字
  const avg = (fn) => {
    const vals = items.map(fn).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : 0;
  };

  return {
    count: items.length,
    genres: top(byGenre),
    platforms: top(byPlatform),
    hooks: top(hookCounter, 10),
    averages: {
      episodes: avg((p) => p.episodes),
      hookDensity: avg((p) => p.hookDensity),
      hookHits: avg((p) => p.hookHits),
    },
    // 给剧本生成的建议：直接把结论翻译成写作约束
    advice: buildAdvice(top(hookCounter, 3), avg((p) => p.episodes)),
    items,
  };
}

function buildAdvice(topHooks, avgEpisodes) {
  const names = topHooks.map((h) => h.name);
  const lines = [];
  if (names.length) lines.push(`当前高频钩子是「${names.join('、')}」，建议前 3 集至少用上其中一个。`);
  if (avgEpisodes) lines.push(`榜单平均 ${avgEpisodes} 集，爽点间隔建议控制在 3 集以内，开头不留真空区。`);
  lines.push('每集三栏齐全：梗概、开场钩子、结尾悬念；梗概保持叙述体。');
  return lines;
}

/**
 * 自家剧本的结构体检：与爆款口径对齐，才能横向比
 */
export function analyzeScript(script, outline) {
  const episodes = script?.episodes ?? [];
  const beats = outline?.beats ?? [];
  const perEp = episodes.map((ep) => {
    let lines = 0;
    let actions = 0;
    let lineChars = 0;
    for (const sc of ep.scenes ?? []) {
      for (const b of sc.flow ?? []) {
        if (b.action) actions += 1;
        else {
          lines += 1;
          lineChars += (b.line ?? '').replace(/\s/g, '').length;
        }
      }
    }
    const est = estimateSeconds(ep);
    const target = ep.targetSeconds ?? 0;
    return {
      ep: ep.ep,
      seconds: est,
      target,
      deviation: target ? Math.round(((est - target) / target) * 100) : 0,
      actions,
      lines,
      avgLineChars: lines ? Math.round(lineChars / lines) : 0,
      // 对白密度：台词秒数占全集的比例，太高说明缺少动作
      dialogueRatio: est > 0 ? Math.round(((lineChars / 4.5) / est) * 100) : 0,
      hooks: (beats ?? []).filter((b) => b.episode === ep.ep).map((b) => b.type),
    };
  });

  const flat = [];
  for (const e of perEp) {
    for (let i = 0; i < Math.max(1, Math.round(e.seconds / 10)); i += 1) flat.push(e.ep);
  }

  return {
    episodes: perEp,
    totals: {
      episodes: perEp.length,
      seconds: perEp.reduce((s, e) => s + e.seconds, 0),
      actions: perEp.reduce((s, e) => s + e.actions, 0),
      lines: perEp.reduce((s, e) => s + e.lines, 0),
      avgLineChars: perEp.length ? Math.round(perEp.reduce((s, e) => s + e.avgLineChars, 0) / perEp.length) : 0,
      avgDialogueRatio: perEp.length ? Math.round(perEp.reduce((s, e) => s + e.dialogueRatio, 0) / perEp.length) : 0,
    },
    // 节奏曲线：按时长展开的集序，用来看有没有长时间不换气的平段
    rhythm: flat,
    warnings: buildWarnings(perEp),
  };
}

function buildWarnings(perEp) {
  const w = [];
  for (const e of perEp) {
    if (Math.abs(e.deviation) > 15) w.push(`第 ${e.ep} 集时长偏离目标 ${e.deviation}%`);
    if (e.dialogueRatio > 75) w.push(`第 ${e.ep} 集对白占比 ${e.dialogueRatio}%，动作太少，容易变成广播剧`);
    if (e.avgLineChars > 30) w.push(`第 ${e.ep} 集平均句长 ${e.avgLineChars} 字，偏长`);
    if (!e.hooks.length) w.push(`第 ${e.ep} 集没有认领任何爽点`);
  }
  return w;
}

/** 中文口播时长估算：4.2 字/秒，标点每个 +0.14s（上限 2.5s），单句下限 0.8s */export function speechSeconds(text, speed = 1) {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const latin = (text.replace(/[\u4e00-\u9fa5]/g, ' ').match(/[A-Za-z]+/g) ?? []).length;
  const punct = (text.match(/[，。！？；：,.!?;:]/g) ?? []).length;
  const spoken = cjk / 4.2 + latin / 2.5;
  const pause = Math.min(2.5, punct * 0.14);
  return Math.round(Math.max(0.8, (spoken + pause) / speed) * 10) / 10;
}

/**
 * 爆款文本拆解：把任意一段剧本/简介按行扫成节拍表。
 * 与 analyzeHot/analyzeScript 同一套词表，保证三个入口口径一致、可横向比。
 */
export function analyzeText(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const beats = [];
  let hooks = 0;
  let payoffs = 0;
  let emotions = 0;

  for (const line of lines) {
    const hitHook = HOOK_WORDS.filter((w) => line.includes(w));
    const hitPayoff = PAYOFF_WORDS.filter((w) => line.includes(w));
    const hitEmotion = EMOTION_WORDS.filter((w) => line.includes(w));
    if (hitHook.length) hooks += 1;
    if (hitPayoff.length) payoffs += 1;
    if (hitEmotion.length) emotions += 1;
    const kind = hitPayoff.length ? 'climax' : hitHook.length ? 'hook' : hitEmotion.length ? 'emotion' : null;
    if (kind) {
      beats.push({
        kind,
        text: line.length > 60 ? `${line.slice(0, 60)}…` : line,
        words: [...new Set([...hitHook, ...hitPayoff, ...hitEmotion])],
      });
    }
  }

  // 密度＝每 10 行摊到几个节拍，行即粗粒度的「拍」
  const density = lines.length ? Math.round((beats.length / lines.length) * 100) / 10 : 0;

  const takeaways = [];
  if (hooks === 0) takeaways.push('全文没有扫到钩子词——爆款通常前 3 行就要有身份/真相/退婚级的信息。');
  else takeaways.push(`钩子 ${hooks} 处：集中在${[...new Set(beats.filter((b) => b.kind === 'hook').map((b) => b.words[0]))].join('、')}这类词上，可直接搬进自家大纲的开场。`);
  if (payoffs === 0) takeaways.push('没有扫到爽点词（揭穿/曝光/跪下/反转）——缺打脸与反转，中段容易塌。');
  else takeaways.push(`爽点 ${payoffs} 处：平均每 ${Math.max(1, Math.round(lines.length / payoffs))} 行一个，节奏${payoffs >= 3 ? '偏紧，可对标' : '偏松，建议加密'}。`);
  if (emotions >= 3) takeaways.push(`情绪词 ${emotions} 处：情绪起伏足够，注意别让情绪盖过动作。`);
  takeaways.push('把节拍表按集拆分，每集保留 1 钩子 + 1 爽点 + 1 尾悬念，即可对齐 24 道质量门。');

  return {
    lines: lines.length,
    hooks, payoffs, emotions,
    density,
    beats,
    takeaways,
  };
}
