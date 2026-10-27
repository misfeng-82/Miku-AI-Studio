/* 视图域：爆款情报 —— 榜单 / 文本拆解 / 对标分析 */
import { curInput,  state, api, esc, ICONS, ctx, needScript, busyBtn, pageHead, barRows, statStrip, toast, run, fmtTime } from '../core.js';
import { importCard } from './script.js';

/* ================= 爆款榜单 ================= */
/** 剧目榜的平台（与 src/assets/hotDramas.js 的 HOT_BOARD_META.platform 保持一致） */
const HOT_BOARD_PLATFORM = '红果短剧';

const fmtHeat = (n) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}亿` : n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : String(n ?? 0));

// withHead=false 供首页嵌入用：只要卡片本体，不要这一页自己的大标题与描述
// （首页有自己的主标题，模块带一个区块小标题就够，否则一屏全是 H1）
export function viewHot({ withHead = true } = {}) {
  const head = withHead ? pageHead : () => '';
  const hot = state.data.hot; // 剧目榜结果（喂对标分析的那份）

  // 2026-10-19：真实热榜（UApiPro）与红狐短剧榜整条链路按用户要求下线，
  // 全站只剩「真实剧目榜」一个数据源 —— 这里不再有模式判断，也不再有切换标签。
  const form = `<div class="card">
    <div class="card-head">
      <div><h2>爆款短剧剧目榜</h2><div class="sub">真实剧目榜 → 看海报 / 题材 / 推荐语 → 点卡片核来源、点剧名去平台搜</div></div>
      <div class="actions"><span class="tag outline">${hot ? `${hot.meta?.dataDate ?? ''} 榜单 · 更新于 ${hot.meta?.updatedAt ?? '—'}` : '未载入'}</span>${busyBtn('hot', '载入榜单', 'radar')}</div>
    </div>
    <div class="form-2">
      <label class="field"><span class="fl">题材筛选（可空）</span><input type="text" data-cfg="hotGenre" value="${esc(state.cfg.hotGenre)}" placeholder="如：玄幻 / 萌宝 / 种田" /></label>
      <label class="field"><span class="fl">抓取条数</span><input type="number" min="1" max="100" data-cfg="hotLimit" value="${esc(state.cfg.hotLimit)}" /></label>
    </div>
  </div>`;

  if (!hot) return head('爆款情报', '爆款榜单', '看真实可查的爆款短剧：剧名、题材、推荐语、平台与来源链接，点卡片就能去核对。榜单结构分析直接喂后面的对标分析。') + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.radar}</div><h3>还没有榜单数据</h3><p>点「载入榜单」。结果会自动做结构分析，也能直接喂给后面的对标分析。</p></div></div>`;

  const maxHeat = Math.max(...hot.items.map((i) => i.heat ?? 0), 1);
  const a = hot.analysis; // 剧目榜的结构分析（此前漏定义，切到剧目榜模式渲染会 ReferenceError）
  const meta = hot.meta ?? null;
  const cards = hot.items.map((it) => hotCard(it, maxHeat)).join('');
  const sourceLine = meta
    ? `<div class="notice notice-info" style="margin-top:16px">${ICONS.alert}<div>
        <div>${esc(meta.board)} · 榜单日期 ${esc(meta.dataDate)} · 本库更新于 ${esc(meta.updatedAt)}</div>
        <div style="margin-top:4px">来源：${(meta.sources ?? []).map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--brand)">${esc(s.name)} ↗</a>`).join(' · ')}</div>
        <div style="margin-top:4px">${esc(meta.verifyNote ?? '')}</div>
        ${(meta.todos ?? []).length ? `<div style="margin-top:6px">待补：${(meta.todos ?? []).map((x) => esc(x)).join('；')}</div>` : ''}
      </div></div>`
    : '';

  return head('爆款情报', '爆款榜单', '看真实可查的爆款短剧：剧名、题材、推荐语、平台与来源链接，点卡片就能去核对。榜单结构分析直接喂后面的对标分析。') + form + sourceLine + `
  <div class="card">
    <div class="card-head"><div><h2>完整榜单</h2><div class="sub">${hot.items.length} 条 · 点卡片直达官方播放页，点「站内搜」找同剧其它季</div></div>
      <span class="tag ${hot.source === 'curated' ? 'teal' : 'outline'}">${hot.source === 'curated' ? '真实剧目' : '远程'}</span></div>
    <div class="hot-grid">${cards}</div>
  </div>
  <div class="card">
    <div class="card-head"><div><h2>榜单结构分析</h2><div class="sub">${a.count} 条剧目 · 平均 ${a.averages.episodes || '—'} 集 · 钩子命中 ${a.averages.hookHits} 个/条</div></div>
      <span class="tag teal">${a.hooks[0]?.name ?? '—'} 居首</span></div>
    ${statStrip([
      { label: '剧目数', value: a.count },
      { label: '平均集数', value: a.averages.episodes || '—' },
      { label: '钩子命中/条', value: a.averages.hookHits, cls: 'hl' },
      { label: '高频钩子', value: a.hooks[0]?.name ?? '—' },
    ])}
    <div class="grid-2" style="margin-top:20px">
      <div><div class="fl" style="margin-bottom:10px">高频钩子 TOP</div>${a.hooks.length ? barRows(a.hooks) : '<div class="muted" style="font-size:11.5px">本榜剧名/梗概未命中共用钩子词表</div>'}</div>
      <div><div class="fl" style="margin-bottom:10px">题材分布</div>${barRows(a.genres)}</div>
    </div>
    <div style="margin-top:18px"><div class="fl" style="margin-bottom:10px">平台分布</div>${barRows(a.platforms, '', 'teal')}</div>
  </div>
  <div class="card">
    <div class="card-head"><div><h2>写作建议</h2><div class="sub">从高频结构反推，可直接用于自家大纲</div></div></div>
    <div class="notice notice-ai">${ICONS.spark}<div>${esc(a.advice[0] ?? '暂无建议')}</div></div>
    ${a.advice.length > 1 ? `<div class="gate-list" style="margin-top:12px">${a.advice.slice(1).map((x) => `<div class="gate gate-ok"><span class="gate-icon">${ICONS.check}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(x)}</span><span></span></div>`).join('')}</div>` : ''}
  </div>`;
}

/**
 * 单张榜单卡片：整卡是一个 <a>（新标签打开来源页），海报用远程直链，
 * 加载失败或本来就没有海报时回退占位块——占位块和图片同一个容器、
 * 同一个 3:4 比例，所以回退不会把布局撑歪。
 */
function hotCard(it, maxHeat) {
  const rank = String(it.rank ?? '').padStart(2, '0');
  const cover = it.cover || '';
  const tags = (it.tags ?? []).slice(0, 3);
  const inner = `
    <div class="hot-poster${cover ? '' : ' no-img'}">
      ${cover
        ? `<img src="${esc(cover)}" alt="${esc(it.title)} 宣传海报" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.classList.add('is-broken');this.closest('.hot-poster').classList.add('no-img')">`
        : ''}
      <div class="hot-fallback"><div>
        <div class="hot-fb-title">${esc(it.title)}</div>
        <div class="hot-fb-sub">${esc(cover ? '海报加载失败' : (it.coverNote || '暂无海报'))}</div>
      </div></div>
      <span class="hot-rank">${rank}</span>
    </div>
    <div class="hot-body">
      <div class="hot-title">${esc(it.title)}${it.url ? ' ↗' : ''}</div>
      <div class="chip-row"><span class="chip static">${esc(it.platform ?? '')}</span>${it.episodes ? `<span class="chip static">${it.episodes} 集</span>` : ''}${tags.map((t) => `<span class="chip static">${esc(t)}</span>`).join('')}</div>
      <p class="hot-pitch">${esc(it.pitch || it.synopsis || '')}</p>
      <div class="hot-meta">
        <span class="hot-heat">${esc(it.heatText || fmtHeat(it.heat))}</span>
        ${it.playUrl ? `<span class="hot-play" data-openurl="${esc(it.playUrl)}">站内搜 ↗</span>` : ''}
      </div>
      <div class="bar-track"><span class="bar-fill amber" style="width:${Math.round(((it.heat ?? 0) / maxHeat) * 100)}%"></span></div>
    </div>`;
  return it.url
    ? `<a class="hot-card" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" title="${esc(it.urlNote || it.title)}">${inner}</a>`
    : `<div class="hot-card is-static">${inner}</div>`;
}

/* ================= 爆款文本拆解 ================= */
export function viewSplit() {
  const r = state.data.split;
  const tags = `<span class="tag purple">按行扫节拍</span><span class="tag blue">钩子 / 爽点 / 情绪</span>`;
  const kindMeta = { hook: ['钩子', 'purple', 'target'], climax: ['爽点', 'amber', 'spark'], emotion: ['情绪', 'blue', 'message'] };

  const form = `<div class="card">
    <div class="card-head"><div><h2>爆款文本拆解</h2><div class="sub">粘贴任意剧本 / 简介，按行扫出钩子、爽点、情绪节拍</div></div></div>
    <label class="field"><span class="fl">原文（每行一句）</span>
      <textarea rows="6" data-cfg="splitText" placeholder="少年被当众退婚，众人耻笑。&#10;三日后测灵大会，他露出许久未动的底牌。">${esc(state.cfg.splitText)}</textarea></label>
    <div class="actions" style="margin-top:12px">
      ${busyBtn('split', '拆解节拍', 'scissors')}
      <span class="muted" style="font-size:11px">同一套词表也用于自家剧本质检与对标，口径可横向比</span>
    </div>
  </div>`;

  if (!r) return pageHead('爆款情报', '爆款拆解', '把一段爆款原文按行扫成节拍表：哪行是钩子、哪行是爽点、哪行只提供情绪。拆完就能知道该搬什么进自家结构。', tags) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.scissors}</div><h3>等待拆解</h3><p>粘贴一段爆款剧本或简介，点「拆解节拍」。</p></div></div>`;

  const beats = r.beats.map((b) => {
    const [label, cls, icon] = kindMeta[b.kind] ?? ['节拍', '', 'target'];
    return `<div class="row" style="grid-template-columns:64px 1fr auto">
      <div><span class="tag ${cls}">${label}</span></div>
      <div><div style="font-size:12.5px;line-height:1.7">${esc(b.text)}</div></div>
      <div class="chip-row" style="justify-content:flex-end">${b.words.map((w) => `<span class="chip static">${esc(w)}</span>`).join('')}</div>
    </div>`;
  }).join('');

  return pageHead('爆款情报', '爆款拆解', '把一段爆款原文按行扫成节拍表：哪行是钩子、哪行是爽点、哪行只提供情绪。拆完就能知道该搬什么进自家结构。', tags) + form + `
  <div class="card">
    <div class="card-head"><div><h2>拆解结果</h2><div class="sub">${r.lines} 行 · 节拍密度 ${r.density}/10 行</div></div>
      <span class="tag purple">${r.hooks} 钩子</span><span class="tag amber">${r.payoffs} 爽点</span></div>
    ${statStrip([
      { label: '扫描行数', value: r.lines },
      { label: '钩子', value: r.hooks, cls: 'hl' },
      { label: '爽点', value: r.payoffs, cls: 'warn' },
      { label: '节拍密度', value: `${r.density}/10行` },
    ])}
    <div class="rows" style="margin-top:16px">${beats || '<div class="empty"><p>没扫到节拍词，换一段信息密度更高的文本试试</p></div>'}</div>
    <div class="notice notice-info" style="margin-top:16px">${ICONS.alert}<div>${esc(r.takeaways[0])}</div></div>
    ${r.takeaways.length > 1 ? `<div class="gate-list" style="margin-top:10px">${r.takeaways.slice(1).map((x) => `<div class="gate gate-ok"><span class="gate-icon">${ICONS.check}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(x)}</span><span></span></div>`).join('')}</div>` : ''}
  </div>`;
}

/* ================= 对标分析 ================= */
export function viewCompare() {
  const r = state.data.compare;
  const tags = `<span class="tag purple">自家 vs 爆款</span><span class="tag teal">结构性差距</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>对标分析</h2><div class="sub">把自家剧本放进爆款坐标系：钩子密度、集尾悬念、对白占比逐项量差距</div></div></div>
    <div class="notice notice-info">${ICONS.target}<div>爆款基准实时取自「爆款榜单」（没抓过会自动拉一份）。同套词表、同时长公式，横向可比。</div></div>
    <div class="actions" style="margin-top:14px">${curInput() ? busyBtn('compare', '开始对标', 'scale') : `<button class="btn btn-primary" disabled>${ICONS.scale}开始对标</button>`}</div>
  </div>`;

  if (!curInput()) return pageHead('爆款情报', '对标分析', '抓了爆款不看可惜——把自家剧本放进去逐项量差距，才知道差在哪、改什么。', tags) + importCard({ previewOpen: false }) + form + `<div style="margin-top:16px">${needScript()}</div>`;
  if (!r) return pageHead('爆款情报', '对标分析', '抓了爆款不看可惜——把自家剧本放进去逐项量差距，才知道差在哪、改什么。', tags) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.scale}</div><h3>等待对标</h3><p>点「开始对标」，会拉一份爆款基准做分母。</p></div></div>`;

  const levelTag = { bad: 'red', warn: 'amber', ok: 'teal' };
  return pageHead('爆款情报', '对标分析', '抓了爆款不看可惜——把自家剧本放进去逐项量差距，才知道差在哪、改什么。', tags) + form + `
  <div class="card">
    <div class="card-head"><div><h2>结论</h2><div class="sub">${r.gaps.length} 处差距</div></div>
      <span class="tag ${r.gaps.some((g) => g.level === 'bad') ? 'red' : r.gaps.length ? 'amber' : 'teal'}">${r.gaps.some((g) => g.level === 'bad') ? '需优先修' : r.gaps.length ? '可优化' : '贴合基准'}</span></div>
    <div class="notice ${r.gaps.some((g) => g.level === 'bad') ? 'notice-warn' : 'notice-ok'}">${r.gaps.some((g) => g.level === 'bad') ? ICONS.alert : ICONS.check}<div>${esc(r.verdict)}</div></div>
  </div>
  <div class="grid-2">
    <div class="card card-tight">
      <div class="card-head"><div><h2>自家剧本</h2><div class="sub">当前生成结果</div></div></div>
      ${statStrip([
        { label: '集数', value: r.mine.episodes },
        { label: '场次', value: r.mine.scenes },
        { label: '每集钩子', value: r.mine.hooksPerEpisode, cls: 'hl' },
        { label: '每集爽点', value: r.mine.payoffPerEpisode },
      ])}
      <div class="kv-grid" style="margin-top:16px">
        <div class="kv"><dt>对白占比</dt><dd class="mono">${r.mine.dialogueRatio}%</dd></div>
        <div class="kv"><dt>场次台词密度</dt><dd class="mono">${r.mine.lineDensity} 句/场</dd></div>
        <div class="kv"><dt>集尾悬念覆盖</dt><dd class="mono">${r.mine.cliffCoverage}%</dd></div>
        <div class="kv"><dt>总时长</dt><dd class="mono">${fmtTime(r.mine.seconds)}</dd></div>
      </div>
    </div>
    <div class="card card-tight card-quiet">
      <div class="card-head"><div><h2>爆款基准</h2><div class="sub">榜单样本均值</div></div></div>
      ${statStrip([
        { label: '平均集数', value: r.benchmark.episodes },
        { label: '钩子密度', value: r.benchmark.hookDensity },
        { label: '爽点词均次', value: r.benchmark.payoffHits },
        { label: '情绪词均次', value: r.benchmark.emotionHits },
      ])}
      <div style="margin-top:16px"><div class="fl" style="margin-bottom:8px">爆款高频钩子</div><div class="chip-row">${r.benchmark.topHooks.map((h) => `<span class="chip static">${esc(h.name)} ×${h.value}</span>`).join('')}</div></div>
      <div style="margin-top:14px"><div class="fl" style="margin-bottom:8px">爆款热门题材</div><div class="chip-row">${r.benchmark.topGenres.map((g) => `<span class="chip static">${esc(g.name)} ×${g.value}</span>`).join('')}</div></div>
    </div>
  </div>
  ${r.gaps.length ? `<div class="card">
    <div class="card-head"><div><h2>差距清单</h2><div class="sub">按严重度排序，改完可重跑</div></div></div>
    <div class="gate-list">${r.gaps.map((g) => `<div class="gate ${g.level === 'bad' ? 'gate-fail' : 'gate-ok'}">
      <span class="gate-icon">${g.level === 'bad' ? ICONS.x : ICONS.alert}</span>
      <span><span class="gate-name">${esc(g.label)}</span><div class="gate-detail">${esc(g.detail)}</div></span>
      <span class="tag ${levelTag[g.level] ?? 'amber'}">${g.level === 'bad' ? '优先' : '建议'}</span></div>`).join('')}</div>
  </div>` : ''}`;
}

/* ================= 运行器 ================= */
export const runners = {
  async hot() {
    const limit = Number(state.cfg.hotLimit) || 12;
    const hot = await api.hot(limit, state.cfg.hotGenre || '', true);
    state.data.hot = hot;
    // 不再往项目里写：本工具的产出只留在本工具
    toast(hot.items.length
      ? `载入 ${hot.items.length} 条真实剧目 · ${hot.meta?.dataDate ?? ''} 榜单 · ${hot.items.filter((x) => x.cover).length} 张海报`
      : '没有匹配题材的剧目，换个题材关键词试试');
  },
  async split() {
    const text = state.cfg.splitText;
    if (!text.trim()) return toast('先粘贴一段爆款剧本或简介', 'warn');
    state.data.split = await api.split(text);
    toast('拆解完成，节拍表已生成');
  },
  async compare() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    state.data.compare = await api.compare(ctx());
    toast('对标完成，差距清单已生成');
  },
};
