// 页面渲染检查：把全部视图在 Node 里真实执行一遍
//
// 为什么需要它：uicheck 只证明「接线对得上」，smoke/featuretest 只证明「接口有返回」，
// 都不证明「这个页面拿到数据后能不能画出来」。视图是零参纯函数，直接调用即可覆盖。
//
// 两种状态各渲染一遍：
//   A 空状态（首次打开、还没跑任何功能）—— 最容易白屏的状态
//   B 有数据（先给该工具注入它自己的输入，再调接口拿真实结果渲染）
//
// 注意：工具之间不共享输入。每个视图用 state.data.inputs[viewKey] 这一格，
// 所以这里必须逐视图注入，不能塞一个全局的「当前剧本」。
//
// 用法（需服务在跑）：
//   HOST=127.0.0.1 PORT=8899 node scripts/rendercheck.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { state } from '../public/core.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (p) => JSON.parse(readFileSync(resolve(here, 'fixtures', p), 'utf8'));
const BASE = `http://${config.host}:${config.port}`;

const SCRIPT = fixture('渡口-script.json');
const OUTLINE = fixture('渡口-outline.json');

const views = {
  home: (await import('../public/views/system.js')).viewHome,
  hot: (await import('../public/views/intel.js')).viewHot,
  split: (await import('../public/views/intel.js')).viewSplit,
  compare: (await import('../public/views/intel.js')).viewCompare,
  gen: (await import('../public/views/script.js')).viewGen,
  format: (await import('../public/views/script.js')).viewFormat,
  storyboard: (await import('../public/views/storyboard.js')).viewStoryboard,
  evaluate: (await import('../public/views/quality.js')).viewEvaluate,
  optimize: (await import('../public/views/quality.js')).viewOptimize,
  stats: (await import('../public/views/quality.js')).viewStats,
  assets: (await import('../public/views/assets.js')).viewAssets,
  linebook: (await import('../public/views/assets.js')).viewLinebook,
  relations: (await import('../public/views/assets.js')).viewRelations,
  templates: (await import('../public/views/tools.js')).viewTemplates,
  polish: (await import('../public/views/tools.js')).viewPolish,
  titles: (await import('../public/views/tools.js')).viewTitles,
  library: (await import('../public/views/system.js')).viewLibrary,
  engine: (await import('../public/views/system.js')).viewEngine,
};

let pass = 0;
const fails = [];
const ok = (n, d = '') => { pass += 1; console.log(`  ✓ ${n}${d ? ` — ${d}` : ''}`); };
const bad = (n, d = '') => { fails.push(`${n}${d ? ` — ${d}` : ''}`); console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`); };

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 忽略 */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error?.message ?? ''}`);
  return data;
}

/** 渲染一个视图并校验 */
function renderOne(key, expectText) {
  const fn = views[key];
  if (typeof fn !== 'function') throw new Error('视图函数不存在');
  let html;
  try {
    html = fn();
  } catch (e) {
    throw new Error(`渲染抛错：${e.message}`);
  }
  if (typeof html !== 'string') throw new Error(`返回的不是字符串（${typeof html}）`);
  if (html.length < 150) throw new Error(`输出过短（${html.length} 字符），疑似空页`);
  if (html.includes('页面渲染出错')) throw new Error('渲染结果里出现「页面渲染出错」');
  if (/undefined<\/|>undefined<|"undefined"/.test(html)) throw new Error('输出里出现裸 undefined');
  if (expectText && !html.includes(expectText)) throw new Error(`未出现预期内容「${expectText}」`);
  return `${html.length} 字符`;
}

/** 只给当前这个工具注入它自己的输入，其它工具保持为空 */
function giveInput(key) {
  state.view = key;
  state.data.inputs[key] = { script: SCRIPT, outline: OUTLINE, imported: true };
}

console.log(`页面渲染检查目标：${BASE}`);
console.log(`视图数：${Object.keys(views).length}`);

/* ---------- 准备真实 meta ---------- */
const meta = await call('GET', '/api/meta');
state.meta = meta;
state.projects = (await call('GET', '/api/projects')).items ?? [];

/* ---------- A. 空状态：首次打开、没有任何数据 ---------- */
console.log('\n[A] 空状态渲染（首次打开，最容易白屏的状态）');
for (const key of Object.keys(views)) {
  state.view = key;
  state.data = { inputs: {} };   // 每个工具都没有输入
  state.projectId = null;
  try {
    ok(key, renderOne(key));
  } catch (e) {
    bad(key, e.message);
  }
}

/* ---------- B. 有数据：先给该工具注入自己的输入，调接口，再渲染 ---------- */
console.log('\n[B] 有数据渲染（给该工具自己的输入 → 调对应接口 → 画页面）');

// 需要剧本的工具，各自注入自己那一格
const scriptTools = ['compare', 'evaluate', 'optimize', 'stats', 'storyboard', 'assets', 'linebook', 'relations', 'format'];
state.data = { inputs: {} };
for (const k of scriptTools) giveInput(k);

const cleanupIds = [];

const withData = [
  ['hot', async () => { state.data.hot = await call('GET', '/api/hot?limit=8'); }],
  ['split', async () => { state.data.split = await call('POST', '/api/split', { text: '她被推下楼梯，所有人都说这是意外。\n三年后，我回来了。' }); }],
  ['compare', async () => { state.view = 'compare'; state.data.compare = await call('POST', '/api/compare', { script: SCRIPT, outline: OUTLINE }); }],
  ['evaluate', async () => { state.view = 'evaluate'; state.data.eval = await call('POST', '/api/evaluate', { script: SCRIPT, outline: OUTLINE }); }, '分'],
  ['optimize', async () => { state.view = 'optimize'; state.data.opt = await call('POST', '/api/optimize', { script: SCRIPT, outline: OUTLINE, limit: 1 }); }],
  ['stats', async () => { state.view = 'stats'; state.data.stats = await call('POST', '/api/stats', { script: SCRIPT, outline: OUTLINE }); }],
  ['storyboard', async () => { state.view = 'storyboard'; state.data.shotsMap = { 1: await call('POST', '/api/shots/split', { script: SCRIPT, outline: OUTLINE, ep: 1 }) }; state.data.shotEp = 1; }],
  ['assets', async () => { state.view = 'assets'; state.data.assets = await call('POST', '/api/assets', { script: SCRIPT, outline: OUTLINE }); }],
  ['linebook', async () => { state.view = 'linebook'; state.data.linebook = await call('POST', '/api/linebook', { script: SCRIPT, outline: OUTLINE, includeCsv: true }); }],
  ['relations', async () => { state.view = 'relations'; state.data.relations = await call('POST', '/api/relations', { script: SCRIPT, outline: OUTLINE }); }],
  ['format', async () => { state.view = 'format'; state.data.fmt = await call('POST', '/api/format', { script: SCRIPT, outline: OUTLINE, format: 'short-drama' }); }],
  ['templates', async () => { state.view = 'templates'; state.data.tpl = await call('POST', '/api/templates/character-turnaround/fill', { vars: { 角色名: '沈知微' } }); }],
  ['polish', async () => { state.view = 'polish'; state.data.polish = await call('POST', '/api/polish', { line: '那个，我其实吧，就是不想去' }); }],
  ['titles', async () => { state.view = 'titles'; state.data.titles = await call('POST', '/api/titles', { genre: '悬疑', keyword: '渡口', count: 8 }); }],
  ['gen', async () => {
    state.view = 'gen';
    const r = await call('POST', '/api/script-gen/story', { concept: '都市重生复仇：女主被夺走公司，重生回到酒会当晚', genre: '都市重生复仇', episodes: 10 });
    state.data.genflow = { story: r.story };
  }],
  ['library', async () => {
    state.view = 'library';
    // 作品库是只读工具。为了让「详情卡」也真的被渲染到，没有作品时临时造一份，渲染完删掉。
    if (!state.projects.some((p) => !p.missing)) {
      const p = await call('POST', '/api/projects', { name: '渲染检查临时作品' });
      await call('POST', `/api/projects/${p.id}/script`, { script: SCRIPT, outline: OUTLINE });
      cleanupIds.push(p.id);
      state.projects = (await call('GET', '/api/projects')).items ?? [];
    }
    const list = state.projects.filter((p) => !p.missing);
    state.data.library = list.length ? await call('GET', `/api/projects/${list[list.length - 1].id}`) : null;
  }],
];

for (const [key, load, expect] of withData) {
  try {
    await load();
    ok(key, renderOne(key, expect));
  } catch (e) {
    bad(key, e.message);
  }
}

// 纯 meta 页也再验一次
for (const key of ['home', 'engine']) {
  state.view = key;
  try {
    ok(`${key}（含 meta）`, renderOne(key));
  } catch (e) {
    bad(`${key}（含 meta）`, e.message);
  }
}

/* ---------- C. 增量生成的运行态（新增 UI 分支，必须单独画一次） ---------- */
console.log('\n[C] 增量生成运行中（进度条 / 当前段高亮 / 排队按钮）');
try {
  state.view = 'gen';
  const story = (await call('POST', '/api/script-gen/story', {
    concept: '都市重生复仇：女主被夺走公司，重生回到酒会当晚', genre: '都市重生复仇', episodes: 6,
  })).story;
  const { outline } = await call('POST', '/api/script-gen/outline', { story });
  const one = await call('POST', '/api/script-gen/episode', { story, outline, ep: 1 });
  state.data.genflow = {
    story,
    outline,
    eps: { 1: { text: one.text, passed: one.passed, gates: one.gates, open: true } },
    assembled: null,
    run: { running: true, total: outline.episodes.length, currentEp: 2, failedEp: null },
  };
  ok('gen（增量运行中）', renderOne('gen', '正在写第 2 集'));
  // 失败态：应出现「可续跑」提示
  state.data.genflow = {
    ...state.data.genflow,
    run: { running: false, total: outline.episodes.length, currentEp: null, failedEp: 3 },
  };
  ok('gen（失败可续跑）', renderOne('gen', '续跑'));
} catch (e) {
  bad('gen（增量运行态）', e.message);
}

// 清理本次临时造的作品（只删自己造的，不动已有数据）
for (const id of cleanupIds) { try { await call('DELETE', `/api/projects/${id}`); } catch { /* 忽略 */ } }

console.log('\n' + '='.repeat(56));
if (fails.length) {
  console.log(`✗ ${pass} 项通过，${fails.length} 项失败`);
  fails.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exitCode = 1;
} else {
  console.log(`✓ 页面渲染 ${pass} 项全部通过（${Object.keys(views).length} 个视图 × 空/有数据）`);
}
