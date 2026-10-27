/* ============================================================
   核心层：状态 / 工具 / 图标 / 提示 / 持久化
   所有视图模块共用，不直接依赖 DOM 之外的全局
   ============================================================ */
import { api } from './api.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtTime = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const pct = (v) => `${Math.round(v)}%`;

let toastTimer;
export function toast(msg, kind = 'ok', ms = 2600) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast is-on ${kind === 'ok' ? '' : kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), ms);
}

/** 把某个元素里的文字整体选中，配合 Ctrl+C 用（复制被浏览器拦截时的出路） */
function selectEl(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch { return false; }
}

/** @returns {Promise<boolean>} 是否真的进了剪贴板（失败时调用方可给替代出路） */
export async function copyText(text, label = '已复制到剪贴板', fallbackEl = null) {
  const s = String(text ?? '');
  if (!s.trim()) { toast('没有可复制的内容', 'warn'); return false; }

  // 首选异步剪贴板 API：它要求安全上下文 + 用户手势，
  // 局域网 http 访问或权限被拒时整个失败（全能版提示词又是大段文本，
  // 失败一次用户就得手动全选，很烦），所以下面必须有兜底
  try {
    await navigator.clipboard.writeText(s);
    toast(label);
    return true;
  } catch { /* 落到兜底 */ }

  // 兜底：临时 textarea + execCommand('copy')，兼容非安全上下文与旧浏览器
  try {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) { toast(label); return true; }
  } catch { /* 两种都失败 */ }

  // 两种都失败：至少把内容替用户选好，按 Ctrl+C 就能拿走
  if (fallbackEl && selectEl(fallbackEl)) {
    toast('浏览器拦了剪贴板：已帮你全选，按 Ctrl+C 复制', 'warn');
    return false;
  }
  toast('复制失败：请手动选中提示词框里的内容复制', 'warn');
  return false;
}

export function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`已下载 ${filename}`);
}

/* ---------------- 图标 ---------------- */
const P = (d, w = 1.9) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
export const ICONS = {
  home: P('M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z'),
  spark: P('M12 2 14 9l7 2-7 2-2 7-2-7-7-2 7-2z'),
  doc: P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5'),
  radar: P('M12 12a1 1 0 1 0 0-.01M12 12a9 9 0 0 0 9 9M12 12V3M12 12 4.6 4.6'),
  film: P('M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4'),
  shield: P('M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4'),
  wrench: P('M14 6a4 4 0 1 0 4 4l-8 8-4-4 8-8z'),
  grid: P('M4 4h7v7H4zM13 4h7v7h-7zM13 13h7v7h-7zM4 13h7v7H4z'),
  box: P('M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9'),
  message: P('M4 5h16v11H9l-5 4z'),
  book: P('M5 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H5zM19 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z'),
  cpu: P('M7 7h10v10H7zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3'),
  check: P('M5 12l5 5L20 7', 2.4),
  x: P('M6 6l12 12M18 6L6 18', 2.4),
  copy: P('M9 9h10v10H9zM5 15V5h10'),
  download: P('M12 4v11M7 11l5 5 5-5M5 20h14'),
  refresh: P('M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4'),
  play: P('M7 4l12 8-12 8z'),
  clock: P('M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18'),
  user: P('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6'),
  map: P('M9 4 4 6v14l5-2 6 2 5-2V4l-5 2zM9 4v14M15 6v14'),
  alert: P('M12 3l9 16H3zM12 10v4M12 17h.01'),
  scissors: P('M6 4l8 8M18 4l-8 8M6 20l4-4M18 20l-4-4'),
  file: P('M7 3h7l4 4v14H7zM14 3v4h4'),
  layers: P('M12 3l9 5-9 5-9-5zM3 13l9 5 9-5'),
  scale: P('M12 4v16M8 20h8M4 8h16M7 8l-3 6h6zM17 8l-3 6h6z'),
  chart: P('M3 3v18h18M7 15l4-4 3 3 5-6'),
  network: P('M12 8a2 2 0 1 0 0-.01M5 19a2 2 0 1 0 0-.01M19 19a2 2 0 1 0 0-.01M12 8 5 19M12 8l7 11M5 19l7-5M19 19l-7-5'),
  wand: P('M15 4l5 5M4 20L14 10M18 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1z'),
  search: P('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'),
  arrow: P('M5 12h14M13 6l6 6-6 6'),
  target: P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01', 2.4),
  type: P('M4 6V4h16v2M12 4v16M8 20h8'),
  pen: P('M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z'),
};

/* ---------------- 全局状态 ---------------- */
export const state = {
  view: 'home',
  projectId: null,
  meta: null,
  projects: [],
  cfg: {
    // idea / source 是剧本生成功能框的参数，随该框下线一并移除（2026-10-17）
    genre: '女频逆袭', episodes: 3, minutes: 2, style: '',
    // 短剧框架：决定结构怎么搭（和「题材」是两个维度）
    framework: 'auto',
    aspect: '9:16',
    // 优化一次最多重写几集：逐集调模型要花钱，默认按「最烂的 8 集」修
    optLimit: 8, hotLimit: 10, hotGenre: '',
    splitText: '', tplId: '', tplVars: {},
    // AI 剧本生成（都市涅槃标准稿）的入参
    // genGenreIds 是有序多选：第 1 个是主题材（决定 genreId），其余作为「融合参考」拼进创意
    genConcept: '', genGenre: '都市重生复仇', genGenreIds: [], genCustom: '',
    genEra: '', genChannel: '', genFormat: 'micro', genEpisodes: 40, genVariantSeed: 0,
    // 剧本转分镜：当前在拆第几集
    shotEp: 1,
    fmt: 'short-drama', polishLine: '', titleGenre: '悬疑', titleKw: '', titleHook: '', titleCount: 12,
  },
  data: { hot: null, inputs: {}, genflow: null, eval: null, checkup: null, usage: null, opt: null, assets: null, linebook: null, split: null, tpl: null, compare: null, stats: null, relations: null, titles: null, polish: null, fmt: null, importError: null, shots: null, shotsMap: {}, library: null },
  busy: {},
  sel: { lineChar: null },
};

// localStorage 键名沿用旧名（comic-drama-studio-v2）：键对用户不可见，
// 换名会让老用户丢掉「上次停留页面/项目/界面配置」，不值得
const LS = 'comic-drama-studio-v2';
// 配置版本：只用来做一次性迁移。老用户 localStorage 里存着两个已下线榜单的
// 模式键（2026-10-19 随那两条链路整条移除），版本对不上就把这几个失效键删掉，
// 其余配置照旧保留——不然死键会一直躺在 cfg 里，哪天读它还会得出旧行为。
const RETIRED_CFG_KEYS = ['hotMode', 'hotPlatform', 'hotKeyword'];
const CFG_VER = 3;
export function save() {
  // 只存「界面停留在哪一页 + 这个工具的配置」，不存任何跨工具状态
  try { localStorage.setItem(LS, JSON.stringify({ ver: CFG_VER, view: state.view, cfg: state.cfg })); } catch {}
}
export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS) || '{}');
    if (d.view) state.view = d.view;
    if (d.cfg) Object.assign(state.cfg, d.cfg);
    if (d.ver !== CFG_VER) for (const k of RETIRED_CFG_KEYS) delete state.cfg[k];
  } catch {}
}

/* ---------------- API 上下文 ---------------- */
/* ---------------- 工具私有输入 ----------------
 * 每个工具都有自己的输入槽，键是视图 id：state.data.inputs[state.view]。
 * 这样工具之间不存在任何共享状态——A 工具载入的剧本，B 工具看不到，也不需要看到。
 * 想换输入就在本工具内重新载入，不必跳去别的页面。
 */
export function curInput() {
  return state.data.inputs?.[state.view] ?? null;
}
export function setCurInput(v) {
  state.data.inputs[state.view] = v;
  return v;
}
export function clearCurInput() {
  delete state.data.inputs[state.view];
  state.data.importError = null;
}

// 每个工具自己的结果槽。换输入时只清自己这一格，不碰别的工具的结果。
const RESULT_SLOT = {
  evaluate: 'eval', optimize: 'opt', checkup: 'checkup', stats: 'stats',
  assets: 'assets', linebook: 'linebook', relations: 'relations', compare: 'compare',
  format: 'fmt', storyboard: 'shots', gen: 'genflow', hot: 'hot', split: 'split',
  titles: 'titles', polish: 'polish', templates: 'tpl', library: 'library',
};
export function clearOwnResult() {
  const k = RESULT_SLOT[state.view];
  if (k) state.data[k] = null;
}

export function ctx(extra = {}) {
  // 只取「当前工具自己的输入」。不读项目、不读别的工具留下的一切。
  const inp = curInput();
  const base = {
    name: '未命名漫剧', genre: state.cfg.genre, episodes: Number(state.cfg.episodes) || 3,
    minutesPerEpisode: Number(state.cfg.minutes) || 2, visualStyle: state.cfg.style || undefined,
    framework: state.cfg.framework || 'auto',
  };
  if (inp?.script) { base.script = inp.script; base.outline = inp.outline ?? null; }
  return { ...base, ...extra };
}

export function countScenes(script) {
  return (script?.episodes ?? []).reduce((n, ep) => n + (ep.scenes ?? []).length, 0);
}

/* ---------------- 运行器 ---------------- */
export async function run(key, fn) {
  if (state.busy[key]) return;
  state.busy[key] = true;
  render();

  // 模型调用常见 10–40 秒。之前按钮只写「处理中…」，用户不知道是卡住了还是在跑，
  // 于是反复点、或者以为坏了。这里每秒把已等待秒数写进按钮（只改一个节点，不重渲染整页）。
  const t0 = Date.now();
  let warned = false;
  const ticker = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const el = document.querySelector(`[data-run="${key}"] .elapsed`);
    if (el) el.textContent = `${sec}s`;
    if (!warned && sec >= 20) {
      warned = true;
      toast('模型还在生成（已 20 秒）——剧本类任务通常 20–40 秒，请稍候', 'warn');
    }
  }, 1000);

  try { await fn(); }
  catch (e) { toast(e.message || '操作失败', 'err'); }
  finally { clearInterval(ticker); state.busy[key] = false; render(); }
}

/* ---------------- 公共渲染片段 ---------------- */
export function emptyState(icon, title, desc, actionHtml = '') {
  return `<div class="empty"><div class="eicon">${ICONS[icon] ?? ICONS.doc}</div><h3>${esc(title)}</h3><p>${esc(desc)}</p>${actionHtml}</div>`;
}

export function needScript() {
  // 不再指路到别的页面——每个工具都自带输入，就地载入即可。
  return `<div class="notice notice-info">${ICONS.alert}<div>这个工具还没拿到剧本：在上方「本工具输入」里粘贴或上传一份即可。它只用于本工具，不会影响其他工具。</div></div>`;
}

export function busyBtn(key, label, icon = 'play') {
  const b = state.busy[key];
  // 处理中带上已等待秒数（.elapsed 由 run() 的计时器每秒更新）
  return `<button class="btn btn-primary" data-run="${key}" ${b ? 'disabled' : ''} title="${b ? '正在调用模型，已等待时间会显示在按钮上' : ''}">${b ? `<span class="spin">${ICONS.refresh}</span>处理中 <span class="elapsed"></span>` : `${ICONS[icon] ?? ICONS.play}${label}`}</button>`;
}

export function pageHead(kicker, title, desc, tags = '') {
  return `<div class="page-head"><div class="ph-kicker">${tags}<span class="tag outline">${esc(kicker)}</span></div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</div>`;
}

/* 分数环 */
export function scoreRing(score) {
  const c = 2 * Math.PI * 36;
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = score >= 90 ? 'var(--teal)' : score >= 70 ? 'var(--amber)' : 'var(--rose)';
  return `<div class="score-ring"><svg width="88" height="88">
    <circle cx="44" cy="44" r="36" fill="none" stroke="var(--surface-3)" stroke-width="8"></circle>
    <circle cx="44" cy="44" r="36" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}"></circle>
    </svg><div class="rv">${score}<small>分</small></div></div>`;
}

/* 质量门列表 */
export function gateList(gates) {
  return `<div class="gate-list">${gates.map((g) => `
    <div class="gate ${g.ok ? 'gate-ok' : 'gate-fail'}">
      <span class="gate-icon">${g.ok ? ICONS.check : ICONS.x}</span>
      <span><span class="gate-name">${esc(g.label)}</span>${g.detail ? `<div class="gate-detail">${esc(g.detail)}</div>` : ''}</span>
      <span class="gate-scope">${esc(g.scope ?? '')}</span>
    </div>`).join('')}</div>`;
}

/* 条形图 */
export function barRows(list, unit = '', color = '') {
  const max = Math.max(...list.map((x) => x.value), 1);
  return list.slice(0, 8).map((x) => `<div class="bar-row">
    <span class="bl" title="${esc(x.name)}">${esc(x.name)}</span>
    <div class="bar-track"><span class="bar-fill ${color}" style="width:${pct((x.value / max) * 100)}"></span></div>
    <span class="bv">${x.value}${unit}</span></div>`).join('');
}

/* 数据条 */
export function statStrip(items) {
  return `<div class="stat-strip">${items.map((s) => `<div class="stat ${s.cls ?? ''}"><div class="sv">${esc(s.value)}</div><div class="sl">${esc(s.label)}</div></div>`).join('')}</div>`;
}

/* 占位：避免循环依赖，由 app.js 注入 */
export let render = () => {};
export function setRender(fn) { render = fn; }

/**
 * 生成与续写是否走真实模型。
 * 后端 modes.llm 有三种值：runtime（网页里填了 key）/ env（.env 里配的）/ mock。
 * 早先前端写死判 `=== 'live'`，而后端从来没返回过 'live'——
 * 结果就是接了 API 也永远显示「本地引擎」。除 mock 之外都算已接入。
 */
export const llmMode = () => state.meta?.llm?.mode ?? state.meta?.modes?.llm ?? 'unconfigured';
// 只有真正接上模型才算 live。'unconfigured'（未配置）和 'mock'（测试）都不是。
// 之前的写法是 mode !== 'mock'，会把「未接入」误判成「真模型」。
export const isLiveLLM = () => llmMode() === 'live';
/** 统一的模型状态标签：真模型 / 样本引擎（仅测试）/ 未接入模型 */
export const llmModeLabel = () => {
  const m = llmMode();
  if (m === 'live') return `真模型 · ${llmLabel() || '已接入'}`;
  if (m === 'mock') return '样本引擎（仅测试）';
  return '未接入模型';
};
/** 已接入模型的展示名，未接入给空串 */
export const llmLabel = () => state.meta?.llm?.model ?? '';
/** 当前推理等级的中文短名（DeepSeek 等思考模型才有意义） */
export const llmReasoningLabel = () => ({
  auto: '默认档', off: '关思考', low: 'Low', high: 'High', max: 'Max',
}[state.meta?.llm?.reasoning ?? 'auto'] ?? '');

export { api };
