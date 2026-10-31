// 前端接线静态审计：找出「喊了但不存在」的引用
// 这类问题的表现是「点进去白屏 / 按钮无反应 / 控制台报 undefined」，
// 而 HTTP 层测试完全看不到。
//
// 用法：node scripts/uicheck.mjs（不需要起服务）
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const P = join(ROOT, 'public');
const read = (f) => readFileSync(f, 'utf8');

const html = read(join(P, 'index.html'));
const core = read(join(P, 'core.js'));
const apiSrc = read(join(P, 'api.js'));
const appSrc = read(join(P, 'app.js'));
const viewFiles = readdirSync(join(P, 'views')).filter((f) => f.endsWith('.js')).map((f) => join(P, 'views', f));

const sources = [
  { name: 'app.js', src: appSrc },
  { name: 'core.js', src: core },
  ...viewFiles.map((f) => ({ name: `views/${f.split(/[\\/]/).pop()}`, src: read(f) })),
];

const problems = [];
const report = (kind, msg) => problems.push(`[${kind}] ${msg}`);

/* 1. index.html 的 id 集合 */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

/* 2. $('#xxx') / getElementById 引用 */
const refIds = new Map();
for (const { name, src } of sources) {
  for (const m of src.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) {
    if (!refIds.has(m[1])) refIds.set(m[1], new Set());
    refIds.get(m[1]).add(name);
  }
  for (const m of src.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) {
    if (!refIds.has(m[1])) refIds.set(m[1], new Set());
    refIds.get(m[1]).add(name);
  }
}
for (const [id, files] of refIds) {
  if (!htmlIds.has(id)) report('DOM id 缺失', `#${id}（被 ${[...files].join(',')} 引用）在 index.html 里不存在`);
}

/* 3. ICONS */
const iconsStart = core.indexOf('export const ICONS = {');
const iconsEnd = core.indexOf('\n};', iconsStart);
const iconsSrc = core.slice(iconsStart, iconsEnd);
const definedIcons = new Set([...iconsSrc.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
const usedIcons = new Set();
for (const { src } of sources) for (const m of src.matchAll(/\bICONS\.([A-Za-z0-9_]+)/g)) usedIcons.add(m[1]);
for (const ic of usedIcons) if (!definedIcons.has(ic)) report('图标缺失', `ICONS.${ic} 未定义`);

/* 4. api.X 方法 */
const apiKeys = new Set([...apiSrc.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\(/gm)].map((m) => m[1]));
const usedApi = new Set();
for (const { src } of sources) for (const m of src.matchAll(/\bapi\.([A-Za-z0-9_]+)\s*\(/g)) usedApi.add(m[1]);
for (const k of usedApi) if (!apiKeys.has(k)) report('API 方法缺失', `api.${k}() 在 public/api.js 里没有定义`);

/* 5. 侧栏 → PAGES → 视图函数 */
const sidebarIds = [...appSrc.matchAll(/\{\s*id:\s*'([A-Za-z0-9_]+)',\s*name:/g)].map((m) => m[1]);
const pStart = appSrc.indexOf('const PAGES = {');
const pagesSrc = appSrc.slice(pStart, appSrc.indexOf('\n};', pStart));
const pages = [...pagesSrc.matchAll(/^\s{2}([A-Za-z0-9_]+):\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/gm)]
  .map((m) => ({ key: m[1], mod: m[2], fn: m[3] }));
const pageKeys = new Set(pages.map((p) => p.key));
for (const id of sidebarIds) if (!pageKeys.has(id)) report('页面未注册', `侧栏项「${id}」在 PAGES 里没有对应视图`);

/* 6. PAGES 目标必须真的是导出的函数 */
// 按 PAGES 里实际用到的模块名去 import，不维护硬编码清单：
// 早先这里是手写的一份映射，加了「去 AI 味」页就得记着来这里补一行，
// 漏了就会误报「页面模块缺失」。清单能从 PAGES 推出来，就不该由人维护。
const modOf = {};
for (const name of [...new Set(pages.map((p) => p.mod))].sort()) {
  try {
    modOf[name] = await import(new URL(`../public/views/${name}.js`, import.meta.url));
  } catch {
    // 模块文件真的不存在：留给下面的「页面模块缺失」统一报
  }
}
for (const p of pages) {
  const mod = modOf[p.mod];
  if (!mod) { report('页面模块缺失', `PAGES.${p.key} 指向未导入模块 ${p.mod}`); continue; }
  if (typeof mod[p.fn] !== 'function') report('视图函数缺失', `PAGES.${p.key} → ${p.mod}.${p.fn} 不是函数`);
}

/* 7. 侧栏图标 */
const sidebarIcons = [...appSrc.matchAll(/icon:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
for (const ic of sidebarIcons) if (!definedIcons.has(ic)) report('侧栏图标缺失', `侧栏用了未定义的 ICONS.${ic}`);

/* 8. 视图文件必须导出至少一个 view* 函数 */
for (const f of viewFiles) {
  const src = read(f);
  if (!/export function view[A-Za-z0-9_]*/.test(src)) {
    report('视图未导出', `${f.split(/[\\/]/).pop()} 没有导出任何 view* 函数`);
  }
}

/* 9. 按钮 key → RUNNERS 处理器
 * 这是「点了没反应」的直接原因：按钮 data-run="x"，但 RUNNERS 里没有 x，
 * app.js 的 `run(k, RUNNERS[k])` 拿到 undefined，点击就静默失败。
 * 用真实导入取 RUNNERS 并集，比正则可靠。 */
const runnerKeys = new Set();
for (const [name, mod] of Object.entries(modOf)) {
  const r = mod.runners;
  if (!r || typeof r !== 'object') { report('模块缺 runners', `${name}.js 没有导出 runners`); continue; }
  for (const k of Object.keys(r)) runnerKeys.add(k);
}
// app.js 额外挂的
runnerKeys.add('usage');

const btnKeys = new Set();
for (const { src } of sources) {
  for (const m of src.matchAll(/busyBtn\('([A-Za-z0-9_]+)'/g)) btnKeys.add(m[1]);
  for (const m of src.matchAll(/data-run="([A-Za-z0-9_]+)"/g)) btnKeys.add(m[1]);
}
for (const k of btnKeys) {
  if (!runnerKeys.has(k)) report('按钮无处理器', `按钮 key「${k}」在 RUNNERS 里没有对应函数，点击会没反应`);
}

/* 10. data-act → ACTIONS 处理器
 * 与「按钮 key」同类：data-act="x" 但 ACTIONS 里没有 x，点了就没反应。
 * 注意 data-act 支持 "name:arg" 形式，只比较冒号前的名字。 */
const actionsStart = appSrc.indexOf('const ACTIONS = {');
const actionsSrc = appSrc.slice(actionsStart, appSrc.indexOf('\n};', actionsStart));
const actionKeys = new Set([...actionsSrc.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
const usedActs = new Set();
for (const { src } of sources) {
  for (const m of src.matchAll(/data-act="([A-Za-z0-9_]+)(?::[^"]*)?"/g)) usedActs.add(m[1]);
}
for (const k of usedActs) {
  if (!actionKeys.has(k)) report('动作无处理器', `data-act="${k}" 在 ACTIONS 里没有对应函数，点击会没反应`);
}

/* 11. audio/图片等静态引用是否存在 */
for (const m of html.matchAll(/(?:src|href)="\/([^"?]+\.(?:js|css|svg|png|ico))"/g)) {
  if (!existsSync(join(P, m[1]))) report('静态资源缺失', `index.html 引用的 /${m[1]} 不存在`);
}

console.log(`检查范围：index.html + ${viewFiles.length} 个视图 + app.js + core.js + api.js`);
console.log(`  DOM id：引用 ${refIds.size} 个 / 定义 ${htmlIds.size} 个`);
console.log(`  ICONS：使用 ${usedIcons.size} 个 / 定义 ${definedIcons.size} 个`);
console.log(`  api 方法：使用 ${usedApi.size} 个 / 定义 ${apiKeys.size} 个`);
console.log(`  侧栏 ${sidebarIds.length} 项 → PAGES 注册 ${pages.length} 个视图`);
console.log(`  按钮 key：视图里用了 ${btnKeys.size} 个 / RUNNERS 提供 ${runnerKeys.size} 个`);
console.log(`  data-act：视图里用了 ${usedActs.size} 个 / ACTIONS 提供 ${actionKeys.size} 个`);
console.log('');
if (problems.length) {
  console.log(`✗ 发现 ${problems.length} 处接线问题：`);
  problems.forEach((p) => console.log(`  ${p}`));
  process.exitCode = 1;
} else {
  console.log('✓ 接线全部对得上：无缺失 id / 图标 / API 方法 / 页面 / 静态资源');
}
