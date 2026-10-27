import { estimateSeconds } from './scriptService.js';
import { profileItem, analyzeScript } from './analyzeService.js';

// 对标分析：把「自家剧本」放到「爆款榜单」的坐标系里量差距。
// 这是抓取功能的闭环——抓来的爆款不只是看，是用来对标的。
// 全部确定性计算：同一套词表、同一个时长公式，横向可比。

/** 从剧本里抽出可对标的扁平文本（钩子/爽点/情绪词扫描用） */
function scriptCorpus(script) {
  const parts = [];
  for (const ep of script?.episodes ?? []) {
    parts.push(ep.hook ?? '', ep.cliff ?? '');
    for (const sc of ep.scenes ?? []) {
      for (const b of sc.flow ?? []) {
        parts.push(b.action ?? '', b.line ?? '');
      }
    }
  }
  return parts.join('\n');
}

/** 剧本自己的结构画像：口径与 profileItem 对齐 */
export function profileScript(script) {
  const episodes = script?.episodes ?? [];
  const scenes = episodes.flatMap((ep) => ep.scenes ?? []);
  const lines = episodes.flatMap((ep) => (ep.scenes ?? []).flatMap((sc) => (sc.flow ?? []).filter((b) => b.speaker)));
  const seconds = episodes.reduce((n, ep) => n + (ep.targetSeconds ?? 0), 0);
  const corpus = scriptCorpus(script);

  const hookWords = ['身份', '真相', '失踪', '背叛', '重生', '复仇', '怀孕', '退婚', '打脸', '离婚', '继承', '隐藏', '秘密', '救命', '危机', '赌注', '最后', '竟然', '居然', '原来'];
  const payoffWords = ['揭穿', '曝光', '跪下', '道歉', '反转', '认出', '亮出', '碾压', '拿下', '赢了'];

  // 每集钩子数：集钩子字段 + 集内扫到的钩子词，取大值避免空转
  const perEpisode = episodes.map((ep) => {
    const inEp = (ep.hook ?? '') + (ep.cliff ?? '') + (ep.scenes ?? []).flatMap((sc) => (sc.flow ?? []).map((b) => (b.line ?? '') + (b.action ?? ''))).join('');
    const hits = hookWords.filter((w) => inEp.includes(w)).length;
    return hits + (ep.hook ? 1 : 0);
  });

  return {
    episodes: episodes.length,
    scenes: scenes.length,
    seconds,
    lines: lines.length,
    // 台词密度＝台词数 / 场数，漫改剧本通常 6-10
    lineDensity: scenes.length ? Math.round((lines.length / scenes.length) * 10) / 10 : 0,
    // 对白占比：台词字数 / 总字数，短剧经验区间 45%-65%
    dialogueRatio: (() => {
      const total = corpus.replace(/\s/g, '').length || 1;
      const spoken = lines.reduce((n, b) => n + (b.line ?? '').length, 0);
      return Math.round((spoken / total) * 100);
    })(),
    hooksPerEpisode: episodes.length ? Math.round((perEpisode.reduce((a, b) => a + b, 0) / episodes.length) * 10) / 10 : 0,
    payoffPerEpisode: episodes.length ? Math.round((corpus.split('\n').filter((l) => payoffWords.some((w) => l.includes(w))).length / episodes.length) * 10) / 10 : 0,
    cliffCoverage: episodes.length ? Math.round((episodes.filter((ep) => (ep.cliff ?? '').trim()).length / episodes.length) * 100) : 0,
  };
}

/**
 * 对标：自家剧本 vs 爆款样本均值
 * @returns {{ mine, benchmark, gaps, verdict }}
 */
export function compareWithHot(script, hot) {
  const mine = profileScript(script);
  const samples = (hot?.items ?? []).map(profileItem);
  // 只平均「有数」的：真实榜单集数可能是 null，拿 0 参与会把基准压没
  const avg = (key) => {
    const vals = samples.map((s) => s[key]).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  };
  const benchmark = {
    episodes: avg('episodes'),
    hookDensity: avg('hookDensity'),
    payoffHits: avg('payoffHits'),
    emotionHits: avg('emotionHits'),
    topGenres: topOf(samples.map((s) => s.genre), 3),
    // 真实剧目没有人工 hookTypes，取词表实际命中，和 analyzeHot 同一口径
    topHooks: topOf(samples.flatMap((s) => (s.hooks?.length ? s.hooks : s.hookTypes)), 5),
  };

  const gaps = [];
  // 集数对标：漫剧单集 1-3 分钟，与爆款均集数不必相同，只提示偏离
  if (mine.episodes && benchmark.episodes) {
    const ratio = mine.episodes / benchmark.episodes;
    if (ratio < 0.1) gaps.push({ label: '集数远低于爆款均值', detail: `自家 ${mine.episodes} 集 vs 爆款均值 ${benchmark.episodes} 集。爆款靠集数铺钩子，漫剧可适当加量或用单集多段补偿。`, level: 'warn' });
  }
  if (mine.hooksPerEpisode < 1) gaps.push({ label: '每集钩子不足 1 个', detail: `当前每集 ${mine.hooksPerEpisode} 个钩子。爆款通常每集 1-2 个身份/真相级信息反转。`, level: 'bad' });
  if (mine.cliffCoverage < 100) gaps.push({ label: '有集数没埋集尾悬念', detail: `集尾悬念覆盖率 ${mine.cliffCoverage}%，未覆盖的集会掉追更率。`, level: 'bad' });
  if (mine.dialogueRatio < 40) gaps.push({ label: '对白占比偏低', detail: `当前 ${mine.dialogueRatio}%，低于 40% 会像小说不像剧；短剧经验区间 45%-65%。`, level: 'warn' });
  if (mine.dialogueRatio > 70) gaps.push({ label: '对白占比偏高', detail: `当前 ${mine.dialogueRatio}%，超过 70% 会缺乏动作与画面信息，注意「能演就不说」。`, level: 'warn' });
  if (mine.lineDensity < 5) gaps.push({ label: '场次台词偏少', detail: `平均每场 ${mine.lineDensity} 句台词，低于 5 会显得空；补动作或加对位戏。`, level: 'warn' });

  const bad = gaps.filter((g) => g.level === 'bad').length;
  const verdict = bad === 0 && gaps.length === 0
    ? '结构与爆款基准无明显差距，可以直接进入下一步。'
    : bad === 0
      ? `整体贴近爆款基准，${gaps.length} 处可优化项不阻塞推进。`
      : `${bad} 处结构性差距建议先修：${gaps.filter((g) => g.level === 'bad').map((g) => g.label).join('、')}。`;

  return { mine, benchmark, gaps, verdict };
}

function topOf(list, n) {
  const m = new Map();
  for (const x of list) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, value]) => ({ name, value }));
}
