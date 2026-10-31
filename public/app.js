/* ============================================================
   Miku AI创作平台 · 主程序
   架构学墨笔：SIDEBAR 分组注册表 + PAGES 分发 + 依赖注入运行器
   ============================================================ */
import { $, $$, state, save, load, api, esc, ICONS, toast, ctx, curInput, download, copyText, setRender, run, isLiveLLM, llmLabel } from './core.js';
import * as intel from './views/intel.js';
import * as script from './views/script.js';
import * as quality from './views/quality.js';
import * as assets from './views/assets.js';
import * as storyboard from './views/storyboard.js';
import * as tools from './views/tools.js';
import * as system from './views/system.js';
import * as deai from './views/deai.js';
import * as novel from './views/novel.js';

/* ================= 侧栏注册表（单一事实来源） ================= */
const SIDEBAR = [
    { group: '创作入口', items: [
      { id: 'home', name: '首页', icon: 'home' },
      { id: 'model', name: '接入模型', icon: 'cpu' },
    ]},
  { group: '爆款情报', items: [
    { id: 'hot', name: '爆款榜单', icon: 'radar' },
    { id: 'split', name: '爆款拆解', icon: 'scissors' },
    { id: 'compare', name: '对标分析', icon: 'scale', hot: true },
  ]},
  { group: '小说创作', items: [
    { id: 'novel', name: 'AI 写小说', icon: 'book', hot: true },
  ]},
  { group: '剧本创作', items: [
    { id: 'gen', name: 'AI 剧本生成', icon: 'spark', hot: true },
    { id: 'format', name: '格式转换', icon: 'type' },
    { id: 'storyboard', name: '剧本转分镜', icon: 'grid', hot: true },
  ]},
  { group: '质量把控', items: [
    { id: 'evaluate', name: '剧本评估', icon: 'shield' },
    { id: 'optimize', name: '剧本优化', icon: 'wrench' },
    { id: 'deai', name: '去 AI 味', icon: 'wand', hot: true },
    { id: 'stats', name: '统计报表', icon: 'chart' },
  ]},
  { group: '资产中心', items: [
    { id: 'assets', name: '资产库', icon: 'box' },
    { id: 'linebook', name: '台词本', icon: 'message' },
    { id: 'relations', name: '人物关系', icon: 'network' },
  ]},
  { group: '效率工具', items: [
    { id: 'templates', name: '提示词模板', icon: 'book' },
    { id: 'polish', name: '台词润色', icon: 'wand' },
    { id: 'titles', name: '爆款标题', icon: 'type' },
  ]},
  { group: '引擎', items: [
    { id: 'library', name: '作品库', icon: 'box' },
    { id: 'engine', name: '引擎与关于', icon: 'cpu' },
  ]},
];
const ALL_ITEMS = SIDEBAR.flatMap((g) => g.items);
const nameOf = (id) => ALL_ITEMS.find((i) => i.id === id)?.name ?? '首页';

/* ================= PAGES 分发 ================= */
const PAGES = {
  home: system.viewHome,
  model: system.viewModelSetup,
  engine: system.viewEngine,
  library: system.viewLibrary,
  hot: intel.viewHot,
  split: intel.viewSplit,
  compare: intel.viewCompare,
  gen: script.viewGen,
  format: script.viewFormat,
  evaluate: quality.viewEvaluate,
  optimize: quality.viewOptimize,
  deai: deai.viewDeai,
  novel: novel.viewNovel,
  stats: quality.viewStats,
  storyboard: storyboard.viewStoryboard,
  assets: assets.viewAssets,
  linebook: assets.viewLinebook,
  relations: assets.viewRelations,
  templates: tools.viewTemplates,
  polish: tools.viewPolish,
  titles: tools.viewTitles,
};

/* ================= 按需加载 ================= */
// 只有「小说」列表需要进页面时才拉：列表可能很长，首屏不该为它等一次请求。
// 拉完再 render 一次，于是第一次进来不会停在「正在读取书目…」。
async function lazyLoad(view) {
  if (view === 'novel' && state.data.novel === null) {
    try {
      state.data.novel = { list: (await api.novels()).items, book: null, gates: [], readiness: null };
      render();
    } catch { /* 拉不到就停在空态，不阻断页面 */ }
  }
}

/* ================= 运行器汇总 ================= */
const RUNNERS = {
  ...intel.runners,
  ...script.runners,
  ...quality.runners,
  ...assets.runners,
  ...storyboard.runners,
  ...tools.runners,
  ...deai.runners,
  ...novel.runners,
  usage: system.runners.usage,
};

/* ================= 写章的局部 loading ================= */
/**
 * 从「写这章」按钮发起生成：只在按钮自己身上做 loading，不整页重渲染。
 *
 * 为什么不用 run()：run() 一开始就 render() 整页——输入框失焦、长列表滚回顶部。
 * 而这里的按钮排在很长的章纲列表里，用户常想连着写好幾章。
 * 所以点击瞬间只改按钮本身（转圈 + 已等待秒数 + 禁用），其余界面照常可交互；
 * 只有生成结束、需要展示新章节时才整页 render，并把滚动位置原样还回去。
 */
async function writeChapterFromButton(btn, index) {
  // 全局互斥：并发生成两章会互相覆盖同一本书（另一个入口是「目标章节」卡的按钮）
  if (state.busy.novelWrite || state.busy.novelWriteTarget) return;
  if (btn.disabled) return;

  const original = btn.innerHTML;
  const t0 = Date.now();
  state.busy.novelWrite = true;
  btn.disabled = true;
  btn.classList.add('is-loading');
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `<span class="spin">${ICONS.refresh}</span>写第 ${index} 章 <span class="elapsed">0s</span>`;

  const ticker = setInterval(() => {
    const el = btn.querySelector('.elapsed');
    if (el) el.textContent = `${Math.round((Date.now() - t0) / 1000)}s`;
  }, 1000);

  const scrollY = window.scrollY;
  try {
    await RUNNERS.novelWrite(index);
    render();                      // 完成：把新章节 / 门禁 / 记忆画出来
    window.scrollTo(0, scrollY);   // 别把用户从列表中间弹回顶部
  } catch (e) {
    toast(e.message || '生成失败', 'err');
    // 失败必须恢复按钮，否则这一章永远点不动
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.innerHTML = original;
  } finally {
    clearInterval(ticker);
    state.busy.novelWrite = false;
  }
}

/* ================= 渲染 ================= */
function renderSidebar() {
  $('#sidebarNav').innerHTML = SIDEBAR.map((g) => `<div class="nav-group">
    <div class="nav-group-title">${esc(g.group)}</div>
    ${g.items.map((it) => `<button class="nav-item ${state.view === it.id ? 'is-on' : ''}" data-view="${it.id}" title="${esc(it.name)}">
      ${ICONS[it.icon] ?? ICONS.doc}<span>${esc(it.name)}</span>${it.hot ? '<span class="hot">NEW</span>' : ''}
    </button>`).join('')}
  </div>`).join('');

  const live = isLiveLLM();
  const sf = $('#sfEngine');
  sf.classList.toggle('is-api', live);
  $('#sfStatus').textContent = live ? `API · ${llmLabel() || '已接入'}` : '本地引擎 · 零费用';
}

function renderTop() {
  $('#crumb').innerHTML = `Miku AI创作平台<b> / ${esc(nameOf(state.view))}</b>`;
  const eng = $('#tbEngine');
  const live = isLiveLLM();
  eng.textContent = live ? `API · ${llmLabel() || '模型'}` : '本地引擎';
  eng.classList.toggle('on', live);
  eng.title = live ? '生成与续写调用该模型；质检/优化/拆镜仍本地' : '未接入 API：生成走本地组合引擎，零费用';
  // 顶栏不再有「项目」选择器：工具之间不共享任何东西，也就没有「当前项目」这个概念
}

function render() {
  renderSidebar();
  renderTop();
  const content = $('#content');
  try { content.innerHTML = (PAGES[state.view] ?? system.viewHome)(); }
  catch (e) { content.innerHTML = `<div class="card"><div class="notice notice-err">${ICONS.alert}<div>页面渲染出错：${esc(e.message)}</div></div></div>`; console.error(e); }
}
setRender(render);

/* ================= 作品库（只读） ================= */
// 作品库只是一个「看历史成果 + 导出」的工具，不向任何其他工具供数。
async function refreshProjects() {
  try { state.projects = (await api.projects()).items ?? []; } catch { state.projects = []; }
}

/* ================= API 接入设置 ================= */
const apiDraft = { preset: 'openai', baseUrl: '', model: '', apiKey: '', reasoning: 'auto', temperature: 0.85, maxTokens: 8000, timeout: 120, enabled: false };

async function openApiModal() {
  // 弹窗第一时间就打开：任何一步读取失败都不该让「接 API」点了没反应。
  // （早先 d 声明在 try 内、却在 try 外被引用 → ReferenceError，
  //   `$('#apiModal').hidden = false` 根本执行不到，弹窗永远打不开）
  $('#apiModal').hidden = false;
  $('#amTestResult').textContent = '';
  try {
    const d = await api.settings();
    const s = d.settings ?? {};
    Object.assign(apiDraft, {
      preset: s.preset ?? 'openai', baseUrl: s.baseUrl ?? '', model: s.model ?? '',
      apiKey: s.hasKey ? s.apiKey : '', reasoning: s.reasoning ?? 'auto',
      temperature: s.temperature ?? 0.85,
      maxTokens: s.maxTokens ?? 8000, timeout: Math.round((s.timeoutMs ?? 120000) / 1000),
      enabled: Boolean(s.enabled),
    });
    // 预设的 baseUrl / model / reasoning 由后端下发，前端不再自带一份默认值表
    $('#amPreset').innerHTML = (d.presets ?? []).map((p) => `<option value="${esc(p.id)}" ${p.id === apiDraft.preset ? 'selected' : ''} data-base="${esc(p.baseUrl ?? '')}" data-model="${esc(p.model ?? '')}" data-reasoning="${esc(p.reasoning ?? 'auto')}">${esc(p.name)}${p.hint ? ` — ${esc(p.hint)}` : ''}</option>`).join('');
    // DeepSeek 官方已下线老模型名：保存着老名字的人打开弹窗就自动纠正到新名字，
    // 并说清为什么改——否则点「测试连接」只会拿到一个 404，很容易误判成 Key 坏了
    const RETIRED = { 'deepseek-chat': 'deepseek-flash', 'deepseek-v4-flash': 'deepseek-flash' };
    if (RETIRED[s.model]) {
      const to = RETIRED[s.model];
      apiDraft.model = to;
      $('#amTestResult').innerHTML = `<span style="color:var(--amber)">模型名 ${esc(s.model)} 已被官方下线，已自动换成 ${esc(to)}</span>`;
    }
  } catch (e) { toast('读取接入配置失败：' + e.message, 'err'); }
  $('#amBase').value = apiDraft.baseUrl;
  $('#amModel').value = apiDraft.model;
  $('#amKey').value = apiDraft.apiKey;
  $('#amReasoning').value = apiDraft.reasoning;
  $('#amTemp').value = apiDraft.temperature;
  $('#amMax').value = apiDraft.maxTokens;
  $('#amTimeout').value = apiDraft.timeout;
  $('#amEnabled').checked = apiDraft.enabled;
}

function collectApiForm() {
  return {
    preset: $('#amPreset').value,
    baseUrl: $('#amBase').value.trim(),
    model: $('#amModel').value.trim(),
    apiKey: $('#amKey').value,
    reasoning: $('#amReasoning').value,
    temperature: Number($('#amTemp').value) || 0.85,
    maxTokens: Number($('#amMax').value) || 8000,
    timeoutMs: (Number($('#amTimeout').value) || 120) * 1000,
    enabled: $('#amEnabled').checked,
  };
}

async function saveApiSettings() {
  const body = collectApiForm();
  if (body.enabled && !body.apiKey) return toast('启用前要先填 API Key', 'warn');
  if (body.enabled && !body.baseUrl) return toast('启用前要先填 Base URL', 'warn');
  try {
    const r = await api.saveSettings(body);
    state.meta = await api.meta();
    render();
    $('#apiModal').hidden = true;
    toast(r.message ?? '已保存');
  } catch (e) { toast(e.message, 'err'); }
}

async function pullModels() {
  const body = collectApiForm();
  if (!body.baseUrl) return toast('先填 Base URL', 'warn');
  const btn = $('#amModels');
  btn.disabled = true;
  $('#amTestResult').textContent = '拉取模型列表…';
  try {
    const r = await api.llmModels({ baseUrl: body.baseUrl, apiKey: body.apiKey });
    $('#amModelList').innerHTML = (r.items ?? []).map((m) => `<option value="${esc(m)}"></option>`).join('');
    $('#amTestResult').innerHTML = `<span style="color:var(--teal)">✓ 拉到 ${r.total} 个模型，点模型名输入框即可选</span>`;
    if (!r.total) $('#amTestResult').innerHTML = '<span style="color:var(--amber)">该端点返回了空列表（有些网关不实现 /models），手动填模型名即可</span>';
  } catch (e) {
    // 拉不到不是错：很多自建网关没实现 /models，继续允许手填
    $('#amTestResult').innerHTML = `<span style="color:var(--red)">✗ ${esc(e.message)}——不影响使用，手动填模型名即可</span>`;
  } finally { btn.disabled = false; }
}

async function testApiSettings() {
  const body = collectApiForm();
  if (!body.apiKey) return toast('先填 API Key', 'warn');
  const btn = $('#amTest');
  btn.disabled = true;
  $('#amTestResult').textContent = '连接中…';
  try {
    const r = await api.testSettings(body);
    $('#amTestResult').innerHTML = `<span style="color:var(--teal)">✓ 通了（${r.ms}ms）模型 ${esc(r.model)} 回复：${esc(r.sample)}</span>`;
  } catch (e) {
    $('#amTestResult').innerHTML = `<span style="color:var(--red)">✗ ${esc(e.message)}</span>`;
  } finally { btn.disabled = false; }
}

$('#btnApi').addEventListener('click', openApiModal);
$('#amClose').addEventListener('click', () => { $('#apiModal').hidden = true; });
$('#apiModal').addEventListener('click', (e) => { if (e.target.id === 'apiModal') $('#apiModal').hidden = true; });
$('#amSave').addEventListener('click', saveApiSettings);
$('#amTest').addEventListener('click', testApiSettings);
$('#amClear').addEventListener('click', async () => {
  if (!confirm('确定抹除本机保存的 API 配置？\n\nKey 与 Base URL 会从 data/settings.json 中删除，不可恢复。\n之后调用模型相关功能会提示「未接入」。')) return;
  try {
    const r = await api.clearSettings();
    $('#amKey').value = '';
    $('#amBase').value = '';
    $('#amModel').value = '';
    $('#amEnabled').checked = false;
    toast(r.message, r.cleared ? 'ok' : 'warn');
    render();
  } catch (e) { toast(e.message, 'err'); }
});
$('#amModels').addEventListener('click', pullModels);
$('#amPreset').addEventListener('change', (e) => {
  // 切预设自动带出 baseUrl / model / 推理等级（用户手改过 baseUrl 的不动，免得白填）
  const opt = e.target.selectedOptions[0];
  const base = opt?.dataset.base ?? '';
  // 上一个预设自带的 baseUrl：输入框还是它（或为空）就说明用户没手改，可以整组覆盖
  const prevBase = [...e.target.options].find((o) => o.value === apiDraft.preset)?.dataset.base ?? '';
  if (base && (!$('#amBase').value || $('#amBase').value === prevBase)) {
    $('#amBase').value = base;
    $('#amModel').value = opt.dataset.model ?? '';
    $('#amReasoning').value = opt.dataset.reasoning ?? 'auto';
  }
  apiDraft.preset = e.target.value;
});

/* ================= 事件委托 ================= */
const ACTIONS = {
  // 首页/引导卡里点「去接入模型」直接打开配置弹窗
  openapi: openApiModal,
  resetusage: async () => {
    if (!confirm('清零本机的模型用量记录？只删统计数字，不动你的配置与项目。')) return;
    await api.llmUsageReset();
    state.data.usage = await api.llmUsage();
    render();
    toast('用量记录已清零');
  },
  dlcsv: async () => { if (curInput()) { const r = await api.export(ctx({ format: 'csv' })); download('台词本.csv', r.text); } },
  dlperformers: async () => { if (curInput()) { const r = await api.export(ctx({ format: 'performers' })); download('分角色台本.txt', r.text); } },

  /* ---- 作品库（只读工具自己的动作，不与其它工具互通）---- */
  libraryOpen: async (id) => {
    try {
      state.data.library = await api.project(id);
      render();
    } catch (e) { toast(e.message, 'err'); }
  },
  libraryClose: async () => { state.data.library = null; render(); },
  libraryExportJson: async (id) => {
    try {
      const p = state.data.library?.id === id ? state.data.library : await api.project(id);
      const sc = p.stages?.script?.data;
      if (!sc) return toast('这份作品里没有剧本内容', 'warn');
      download(`${p.name || '作品'}-剧本.json`, JSON.stringify({ name: p.name, script: sc, outline: p.stages?.outline?.data ?? null }, null, 2));
      toast('已导出 JSON：可直接在任意工具的「载入剧本」里用');
    } catch (e) { toast(e.message, 'err'); }
  },
  libraryExportMd: async (id) => {
    try {
      const p = state.data.library?.id === id ? state.data.library : await api.project(id);
      const sc = p.stages?.script?.data;
      if (!sc) return toast('这份作品里没有剧本内容', 'warn');
      const r = await api.export({ script: sc, outline: p.stages?.outline?.data ?? null, format: 'markdown' });
      download(`${p.name || '作品'}-剧本.md`, r.text);
      toast('已导出 Markdown');
    } catch (e) { toast(e.message, 'err'); }
  },
  dlfmt: async () => { const r = state.data.fmt; if (r) download(`漫剧剧本.${r.ext}`, r.text); },
  copyfmt: async () => { if (state.data.fmt) copyText(state.data.fmt.text, '转换结果已复制'); },
  // AI 生成整稿：下载 / 复制（都市涅槃标准稿全文）
  dlgen: () => script.downloadGen(),
  copygen: () => { const r = state.data.genflow?.assembled; if (r?.text) copyText(r.text, '整稿已复制'); else toast('先组装整稿', 'warn'); },
  // 逐集正文：单集复制（每集正文右上角）/ 全集复制（③ 区外侧）——
  // 只吃「已经写出来的集」，空集跳过：没写就复制，用户拿到的会是半截稿
  copyep: (ep) => {
    const n = Number(ep);
    const text = String(state.data.genflow?.eps?.[n]?.text ?? '');
    if (!text.trim()) return toast(`第 ${n} 集还没生成正文`, 'warn');
    copyText(text, `第 ${n} 集正文已复制`);
  },
  copyallep: () => {
    const eps = state.data.genflow?.eps ?? {};
    const nums = Object.keys(eps).map(Number).filter((n) => String(eps[n]?.text ?? '').trim()).sort((a, b) => a - b);
    if (!nums.length) return toast('还没有写好的集：先点某一集的「写第 N 集」', 'warn');
    const body = nums.map((n) => String(eps[n].text).trim()).join('\n\n');
    const total = Object.keys(eps).length;
    const missing = total - nums.length;
    copyText(body, `已复制 ${nums.length} 集正文${missing ? `（另有 ${missing} 集为空，已跳过）` : '（按集序拼接）'}`);
  },
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view],[data-goto],[data-run],[data-act],[data-copy],[data-fmt],[data-optmode],[data-aspect],[data-tpl],[data-linechar],[data-titlegenre],[data-genep],[data-genepview],[data-shotep],[data-shotview],[data-genre],[data-gfilter],[data-openurl],[data-deaitarget],[data-deai-adopt],[data-novelopen],[data-novelnew],[data-novelwrite],[data-novelexport],[data-novelgenre],[data-novelaud],[data-foreconfirm],[data-novelfree],[data-wordpolicy],[data-copychapter],[data-copyall]');
  if (!btn) return;

  // 榜单卡片里的小链接（如「去红果搜」）：卡片整块是 <a>，这里要拦住外层跳转
  if (btn.dataset.openurl !== undefined) {
    e.preventDefault();
    window.open(btn.dataset.openurl, '_blank', 'noopener,noreferrer');
    return;
  }
  if (btn.dataset.view !== undefined) { state.view = btn.dataset.view; save(); render(); lazyLoad(state.view); return; }
  if (btn.dataset.goto !== undefined) { state.view = btn.dataset.goto; save(); render(); return; }
  if (btn.dataset.run !== undefined) { const k = btn.dataset.run; run(k, RUNNERS[k]); return; }
  if (btn.dataset.act !== undefined) {
    const [name, arg] = btn.dataset.act.split(':');
    const fn = ACTIONS[name];
    if (fn) fn(arg);
    return;
  }
  if (btn.dataset.copy !== undefined) {
    // 复制被拦时，把这一块提示词替用户全选（按 Ctrl+C 即可拿走）
    copyText(btn.dataset.copy, '已复制到剪贴板', btn.closest('.pblock')?.querySelector('.pblock-body') ?? null);
    return;
  }
  if (btn.dataset.fmt !== undefined) { state.cfg.fmt = btn.dataset.fmt; state.data.fmt = null; save(); render(); return; }
  if (btn.dataset.optmode !== undefined) { state.cfg.optMode = btn.dataset.optmode; save(); render(); return; }
  if (btn.dataset.aspect !== undefined) { state.cfg.aspect = btn.dataset.aspect; save(); render(); return; }
  if (btn.dataset.tpl !== undefined) { state.cfg.tplId = btn.dataset.tpl; state.data.tpl = null; save(); render(); return; }
  if (btn.dataset.linechar !== undefined) { state.sel.lineChar = btn.dataset.linechar; render(); return; }
  if (btn.dataset.deaitarget !== undefined) { state.cfg.deaiTarget = Number(btn.dataset.deaitarget) || 40; state.data.deai = null; save(); render(); return; }
  if (btn.dataset.deaiAdopt !== undefined) { deai.adoptRewrite(); render(); return; }
  if (btn.dataset.novelopen !== undefined) {
    novel.openBook(btn.dataset.novelopen).then(render).catch((e) => toast(e.message, 'err'));
    return;
  }
  if (btn.dataset.novelnew !== undefined) {
    novel.backToShelf().then(render).catch(() => render());
    return;
  }
  if (btn.dataset.novelwrite !== undefined) {
    writeChapterFromButton(btn, Number(btn.dataset.novelwrite));
    return;
  }
  if (btn.dataset.novelexport !== undefined) {
    novel.exportBook(btn.dataset.novelexport).catch((e) => toast(e.message, 'err'));
    return;
  }
  if (btn.dataset.wordpolicy !== undefined) {
    state.cfg.novelWordPolicy = btn.dataset.wordpolicy === 'loose' ? 'loose' : 'strict';
    save(); render(); return;
  }
  if (btn.dataset.copychapter !== undefined) { novel.copyChapter(btn.dataset.copychapter); return; }
  if (btn.dataset.copyall !== undefined) { novel.copyAll(); return; }
  if (btn.dataset.novelfree !== undefined) {
    state.cfg.novelFreedom = btn.dataset.novelfree === '1';
    save(); render(); return;
  }
  if (btn.dataset.foreconfirm !== undefined) {
    const b = state.data.novel?.book;
    if (b) novel.confirmFore(b.id, btn.dataset.foreconfirm).then(render).catch((e) => toast(e.message, 'err'));
    return;
  }
  if (btn.dataset.novelgenre !== undefined) { state.cfg.novelGenre = btn.dataset.novelgenre; save(); render(); return; }
  if (btn.dataset.novelaud !== undefined) { state.cfg.novelAudience = btn.dataset.novelaud; save(); render(); return; }
  if (btn.dataset.titlegenre !== undefined) { state.cfg.titleGenre = btn.dataset.titlegenre; save(); render(); return; }
  // AI 剧本生成：写某一集（集数从按钮上带下来，闭包进 runner）；展开/收起某一集正文
  if (btn.dataset.genep !== undefined) { const ep = Number(btn.dataset.genep); run('genEp', () => RUNNERS.genEp(ep)); return; }
  // 剧本转分镜：分集列表里逐集拆解 / 查看某一集结果
  if (btn.dataset.shotep !== undefined) { const ep = Number(btn.dataset.shotep); run('shots', () => RUNNERS.shots(ep)); return; }
  if (btn.dataset.shotview !== undefined) { state.data.shotEp = Number(btn.dataset.shotview); render(); return; }
  if (btn.dataset.genepview !== undefined) {
    const ep = Number(btn.dataset.genepview);
    const e = state.data.genflow?.eps?.[ep];
    if (e) e.open = !e.open;
    render();
    return;
  }
  // AI 剧本生成：题材多选（有序，第 1 个是主题材）与维度筛选
  if (btn.dataset.genre !== undefined) {
    const id = btn.dataset.genre;
    const list = [...(state.cfg.genGenreIds ?? [])];
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else { list.push(id); if (list.length > 3) list.shift(); }
    state.cfg.genGenreIds = list;
    save();
    render();
    return;
  }
  if (btn.dataset.gfilter !== undefined) {
    const [key, val] = btn.dataset.gfilter.split(':');
    if (key === 'era') state.cfg.genEra = val ?? '';
    else if (key === 'channel') state.cfg.genChannel = val ?? '';
    else if (key === 'format') {
      state.cfg.genFormat = val ?? 'micro';
      const f = (state.meta?.genres?.formats ?? []).find((x) => x.id === val);
      if (f) state.cfg.genEpisodes = f.episodes; // 篇幅换集数：微短剧 40 / 标准 60 / 长剧 100
    }
    save();
    render();
    return;
  }
});

document.addEventListener('input', (e) => {
  const cfg = e.target.closest('[data-cfg]');
  if (cfg) {
    const k = cfg.dataset.cfg;
    state.cfg[k] = cfg.type === 'number' ? Number(cfg.value) : cfg.value;
    if (k === 'source') { const cc = cfg.parentElement.querySelector('.char-count'); if (cc) cc.textContent = `${cfg.value.length} / 20000`; }
    save();
    // 下拉类（画风）：换选要让「当前：xxx」这类联动文案立刻跟上
    if (cfg.tagName === 'SELECT') render();
    return;
  }
  const tv = e.target.closest('[data-tplvar]');
  if (tv) state.cfg.tplVars[tv.dataset.tplvar] = tv.value;
});

/* 顶栏与弹窗 */
// 项目选择器 / 新建 / 删除已随「工具解耦」移除：工具之间不再共享任何东西

/* 「选剧本文件」：文本进文本框（和粘贴同一条路）；.json 直接按结构载入并预览 */
document.addEventListener('change', (e) => {
  if (e.target.id !== 'importFile') return;
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast(`「${file.name}」有 ${(file.size / 1024 / 1024).toFixed(1)}MB，剧本文件不该这么大`, 'warn');
    e.target.value = '';
    return;
  }
  const fr = new FileReader();
  fr.onload = async () => {
    const text = String(fr.result ?? '');
    const ta = document.querySelector('[data-cfg=importText]');
    if (ta) {
      ta.value = text;
      // 交给全局 input 处理写进 state.cfg，重渲染后内容不丢
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (/\.json$/i.test(file.name)) {
      // JSON 自带结构，直接读；失败会把原因留在「载入剧本」卡上
      await run('load', () => script.loadFromText(text, file.name));
      e.target.value = '';
      return;
    }
    toast(`已读入「${file.name}」，点「载入并预览」开始`);
    e.target.value = '';
  };
  fr.onerror = () => { toast('文件读取失败：可能是编码不对，试试另存为 UTF-8', 'err'); e.target.value = ''; };
  fr.readAsText(file, 'utf-8');
});

/* 侧栏折叠 / 移动端抽屉 */
const btnCollapse = $('#btnCollapse');
function syncCollapse() {
  const on = document.body.classList.contains('collapsed');
  btnCollapse.setAttribute('aria-expanded', String(!on));
  btnCollapse.setAttribute('aria-label', on ? '展开侧栏' : '收起侧栏');
  try { localStorage.setItem('cds_sidebar', on ? 'collapsed' : 'expanded'); } catch {}
}
btnCollapse.addEventListener('click', () => { document.body.classList.toggle('collapsed'); syncCollapse(); });
try { if (localStorage.getItem('cds_sidebar') === 'collapsed') document.body.classList.add('collapsed'); } catch {}
syncCollapse();
$('#btnMobile').addEventListener('click', () => document.body.classList.toggle('mobile-open'));

/* 快捷键 */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#apiModal').hidden = true;
  if (e.ctrlKey && e.key === 'Enter') {
    const primary = { hot: 'hot', split: 'split', compare: 'compare', gen: 'gen', format: 'fmt', evaluate: 'qa', optimize: 'optimize', stats: 'stats', storyboard: 'shots', assets: 'assets', linebook: 'lines', relations: 'relations', templates: 'tpl', polish: 'polish', titles: 'titles' }[state.view];
    if (primary) { e.preventDefault(); run(primary, RUNNERS[primary]); }
  }
  if (e.altKey && /^[1-9]$/.test(e.key)) {
    const idx = Number(e.key) - 1;
    const v = ALL_ITEMS[idx];
    if (v) { e.preventDefault(); state.view = v.id; save(); render(); lazyLoad(v.id); }
  }
});

/* ================= 启动 ================= */
async function boot() {
  load();
  // 老用户 localStorage 里可能还存着已下线的页面（如 generate），回落到首页，
  // 否则渲染走 fallback 但侧栏没有任何高亮，看着像坏了
  if (!PAGES[state.view]) { state.view = 'home'; save(); }
  try {
    state.meta = await api.meta();
    state.cfg.style = state.cfg.style || state.meta.styles?.[0]?.id || '';
    state.cfg.tplId = state.cfg.tplId || state.meta.templates?.[0]?.id || '';
  } catch (e) { toast('元信息加载失败：' + e.message, 'err'); }
  await refreshProjects();
  // 不再根据「上次选的项目」自动往工具里灌剧本——每个工具的输入只归它自己
  state.projectId = null;
  render();
  lazyLoad(state.view);
  if (!state.data.hot) run('hot', RUNNERS.hot).catch(() => {});
}
boot();
