// 端到端冒烟：各功能各自独立跑一遍，再走一次项目串联
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (p) => JSON.parse(readFileSync(resolve(here, 'fixtures', p), 'utf8'));

const BASE = `http://${config.host}:${config.port}`;
let failed = 0;

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data?.error?.message ?? ''}`);
  return data;
}

function check(name, cond, extra = '') {
  if (cond) console.log(`✓ ${name}${extra ? ` — ${extra}` : ''}`);
  else { console.error(`✗ ${name}${extra ? ` — ${extra}` : ''}`); failed += 1; }
}

console.log(`冒烟目标：${BASE}\n`);

// 0. 服务存活
const health = await call('GET', '/health');
check('健康检查', health?.status === 'ok');

// 0b. 清理上一轮冒烟残留，让冒烟可以重复跑。
//     背景：剧本生成有「剧名去重」守卫（recentAvoid 取最近 6 部作品），而 mock 引擎
//     固定产出《都市重生逆袭》。同一 DATA_DIR 跑第二遍时，上一轮存的稿子会进黑名单，
//     于是必然 502「连着两稿都和已有作品撞了」——这不是 bug，是防线正常工作。
//     解法：DELETE 是软删除（只摘索引、正文文件保留可找回），而 recentAvoid 读的是索引，
//     所以把上一轮的残留从索引摘掉即可，磁盘文件仍在，误删也能找回。
const SMOKE_PROJECT_NAMES = new Set(['冒烟项目', '生成稿冒烟']);
const before = await call('GET', '/api/projects');
const stale = (before.items ?? []).filter((it) => SMOKE_PROJECT_NAMES.has(it.name));
for (const it of stale) await call('DELETE', `/api/projects/${it.id}`);
if (stale.length) console.log(`（清理上一轮冒烟残留 ${stale.length} 个，使本次可重复运行）\n`);

// 1. 爆款剧目榜（真实剧目，assets/hotDramas.js 维护）
const hot = await call('GET', '/api/hot?limit=8&refresh=1');
check('载入真实剧目榜', (hot.items?.length ?? 0) > 0, `${hot.items.length} 条 · 来源 ${hot.source}`);
check('剧目带来源链接', hot.items.every((x) => /^https:\/\//.test(x.url ?? '')),
  `${hot.items.filter((x) => x.url).length}/${hot.items.length} 条有链接`);
// 10 条全部拿到官方 series_id 之后，这里就不该再允许任何一条用资讯页兜底
check('剧目直达红果官方播放页', hot.items.every((x) => /hongguoduanju\.com\/player\/\d{15,20}/.test(x.url ?? '')),
  `${hot.items.filter((x) => /\/player\/\d{15,20}/.test(x.url ?? '')).length}/${hot.items.length} 条是官方播放页`);
check('剧目全部带海报', hot.items.every((x) => /^https:\/\//.test(x.cover ?? '')),
  `${hot.items.filter((x) => x.cover).length}/${hot.items.length} 张`);
check('剧目集数已核实', hot.items.every((x) => Number.isInteger(x.episodes) && x.episodes > 0),
  hot.items.map((x) => `${x.episodes}`).join('/'));
check('榜单元信息', !!hot.meta?.updatedAt && (hot.meta?.sources?.length ?? 0) >= 2,
  `${hot.meta?.board} · 更新于 ${hot.meta?.updatedAt}`);
check('爆款结构分析', (hot.analysis?.hooks?.length ?? 0) > 0,
  `钩子 TOP：${hot.analysis.hooks.slice(0, 3).map((x) => `${x.name}×${x.value}`).join('、')}`);
check('写作建议', (hot.analysis?.advice?.length ?? 0) > 0);

// 1b. （真实每日热度榜与红狐短剧爆款榜已于 2026-10-19 整条下线，冒烟不再覆盖）

// 2. 剧本来源：剧本生成功能框已下线，冒烟改用仓库内夹具（真实引擎产物，离线可复现）。
//    下游每一步（评估/优化/资产/台词本…）都不关心剧本从哪来，只认契约形状。
const gen = { script: fixture('渡口-script.json'), outline: fixture('渡口-outline.json') };
check('夹具剧本可用', (gen.script?.episodes?.length ?? 0) > 0, `${gen.script.episodes.length} 集`);
// 只断言「集数 > 0」是不够的：集号有了、场次全空也算过——0 场剧本就是这么活下来的。
// 下面三条是「剧本真的能喂给下游」的最小底线。
const eps = gen.script.episodes;
check('集号是正整数', eps.every((e) => Number.isInteger(e.ep) && e.ep > 0),
  `ep = ${eps.map((e) => e.ep).join(',')}`);
check('每集都有场次', eps.every((e) => (e.scenes ?? []).length > 0),
  `每集场次 = ${eps.map((e) => (e.scenes ?? []).length).join('/')}`);
check('每集都有台词', eps.every((e) => (e.scenes ?? []).some((sc) => (sc.flow ?? []).some((b) => typeof b.line === 'string'))),
  `每集台词 = ${eps.map((e) => (e.scenes ?? []).reduce((n, sc) => n + (sc.flow ?? []).filter((b) => typeof b.line === 'string').length, 0)).join('/')} 句`);
check('大纲六件套', !!(gen.outline?.adaptation && gen.outline?.characters && gen.outline?.beats));

// 3. 剧本评估（独立，直接提交 script）
const ev = await call('POST', '/api/evaluate', { script: gen.script, outline: gen.outline });
check('剧本评估', typeof ev.score === 'number', `${ev.score} 分（${ev.passed}/${ev.total} 门）`);
check('评估·AI 评审', !!ev.judge && typeof ev.judge.score === 'number',
  ev.judge ? `${ev.judge.verdict} ${ev.judge.score} · ${ev.llm?.mode}` : `没拿到评审：${ev.judgeError ?? ''}`);
check('结构指标', (ev.structure?.episodes?.length ?? 0) > 0,
  `平均句长 ${ev.structure.totals.avgLineChars} 字，对白占比 ${ev.structure.totals.avgDialogueRatio}%`);
check('诵读时长', (ev.speech?.count ?? 0) > 0, `${ev.speech.count} 句 / ${ev.speech.totalSeconds} 秒`);

// 3b. 内容体检（独立，只报告不拦截）——原本挂在「剧本生成」页上，已迁到「剧本评估」页
const ck = await call('POST', '/api/checkup', { script: gen.script, outline: gen.outline });
check('内容体检', typeof ck.score === 'number' && ck.total > 0, `${ck.passed}/${ck.total} 项 · ${ck.score} 分`);

// 4. 剧本优化（独立）
const opt = await call('POST', '/api/optimize', { script: gen.script, outline: gen.outline, limit: 3 });
check('剧本优化', typeof opt.after?.score === 'number', `${opt.before.score} → ${opt.after.score} 分`);
check('优化·逐集结果', Array.isArray(opt.rewritten), `目标 ${opt.targets?.length ?? 0} 集，跳过 ${opt.skipped ?? 0} 集`);
check('优化·模型元信息', !!opt.llm && typeof opt.llm.mode === 'string', `${opt.llm?.mode} ${opt.llm?.model ?? ''}`.trim());
check('人工建议', Array.isArray(opt.advice));

// 5. 分镜拆分（调模型；15 秒段 + 段内子镜头 + 段提示词）
const sb = await call('POST', '/api/shots/split', { script: gen.script, outline: gen.outline, ep: 1, aspect: '9:16' });
check('分镜拆分', (sb.segments?.length ?? 0) > 0 && (sb.stats?.shots ?? 0) >= (sb.segments?.length ?? 0) * 3,
  `${sb.segments?.length ?? 0} 段 / ${sb.stats?.shots ?? 0} 镜 / ${sb.stats?.seconds ?? 0}s / ${sb.llm?.mode}`);
check('15 秒段规格', (sb.segments ?? []).every((x) => x.sec >= 14 && x.sec <= 16 && x.shots.length >= 3 && x.shots.length <= 6),
  (sb.segments ?? []).map((x) => `${x.sec}s×${x.shots.length}镜`).join(' '));
check('段提示词为摄制单结构', (sb.segments ?? []).every((x) => x.prompt.includes('[视频约束]') && x.prompt.includes('站位设定') && x.prompt.includes('防穿帮')),
  `首段 ${(sb.segments?.[0]?.prompt ?? '').split('\n').filter(Boolean).length} 行`);
const sbBad = (sb.gates ?? []).filter((g) => !g.ok);
check('分镜结构门', sbBad.length === 0,
  `${(sb.gates ?? []).length - sbBad.length}/${(sb.gates ?? []).length} 门${sbBad.length ? ` · 未过：${sbBad.map((g) => `${g.id}(${g.detail})`).join('；')}` : ''}`);
check('角色识别随拆分返回', (sb.cast?.characters?.length ?? 0) > 0,
  `${sb.cast?.summary?.named ?? 0} 个有名 / ${sb.cast?.summary?.unnamed ?? 0} 个未命名`);
check('分镜不是降级稿', sb.degraded === false, sb.degraded ? `降级原因：${sb.error}` : '模型/样本引擎正常');
const sbMd = await call('POST', '/api/shots/export', { ep: 1, segments: sb.segments, format: 'md' });
check('MD 分镜表导出', (sbMd.text ?? '').includes('| 镜号 |') && (sbMd.text ?? '').includes('15 秒提示词'),
  `${sbMd.total} 段 / ${sbMd.shots ?? 0} 镜 / ${sbMd.text.length} 字`);

// 5b. 资产中心
const assets = await call('POST', '/api/assets', { script: gen.script, outline: gen.outline, visualStyle: 'cn-guoman' });
check('资产中心', assets.characters.length > 0 && assets.scenes.length > 0,
  `${assets.characters.length} 角色 / ${assets.scenes.length} 场景`);
check('角色一致性提示词', (assets.characters[0]?.consistencyPrompt ?? '').includes('跨镜头锁定项'));
check('场景无人约束', (assets.scenes[0]?.noPeopleGuard ?? '').includes('禁止出现人物'));
check('参考图策略', (assets.referencePolicy?.rules?.length ?? 0) > 0);

// 5c. 台词本
const lb = await call('POST', '/api/linebook', { script: gen.script, outline: gen.outline, includeCsv: true });
check('台词本', lb.totals.lines > 0, `${lb.totals.speakers} 人 / ${lb.totals.lines} 句 / ${lb.totals.seconds}s`);
check('台词 CSV 导出', (lb.formats?.csv ?? '').includes('角色'));
check('分角色台本导出', (lb.formats?.performers ?? '').length > 0);

// 5d. 导出（/api/continue 剧本续写随生成功能框一并下线）
const md = await call('POST', '/api/export', { script: gen.script, outline: gen.outline, format: 'markdown' });
check('Markdown 导出', md.text.includes('# ') && md.text.includes('## 第'));

// 5e. AI 剧本生成（都市涅槃标准稿 · 三段式；调用量取决于服务当前接的是真模型还是样本引擎）
const gStory = await call('POST', '/api/script-gen/story', { concept: '都市重生复仇：女主被闺蜜与未婚夫夺走公司，重生回到酒会当晚', genre: '都市重生复仇', episodes: 10 });
check('生成·梗概与人设', (gStory.story?.characters?.length ?? 0) >= 5, `《${gStory.story?.title}》${gStory.story?.characters?.length} 角色`);
const gOutline = await call('POST', '/api/script-gen/outline', { story: gStory.story, from: 1, to: 10 });
check('生成·分集大纲', (gOutline.outline?.episodes?.length ?? 0) === 10, `${gOutline.outline?.beats?.length ?? 0} 个爽点`);
const gEp = await call('POST', '/api/script-gen/episode', { story: gStory.story, outline: gOutline.outline, ep: 1 });
check('生成·单集正文', gEp.passed === true && (gEp.text ?? '').includes('【黑屏】第1集完'),
  `门 ${(gEp.gates ?? []).filter((g) => g.ok).length}/${(gEp.gates ?? []).length}`);
const gFull = await call('POST', '/api/script-gen/assemble', { story: gStory.story, outline: gOutline.outline, texts: [gEp.text] });
check('生成·组装整稿', (gFull.script?.episodes?.length ?? 0) === 1 && (gFull.gates ?? []).every((g) => g.ok),
  `${(gFull.gates ?? []).filter((g) => g.ok).length}/${(gFull.gates ?? []).length} 门`);
// 生成稿和「载入剧本」走同一条下游：存项目 → 评估
const gProj = await call('POST', '/api/projects', { name: '生成稿冒烟', episodes: 1 });
const gSaved = await call('POST', `/api/projects/${gProj.id}/script`, { script: gFull.script, outline: gFull.outline });
check('生成稿存入项目', (gSaved.progress ?? 0) > 0, `进度 ${gSaved.progress}%`);

// 6. 资产层
const styles = await call('GET', '/api/styles');
check('画风预设', styles.items.length === 12, `${styles.items.length} 种`);
const tpls = await call('GET', '/api/templates');
check('提示词模板', tpls.items.length >= 6, `${tpls.items.length} 个`);
const filled = await call('POST', '/api/templates/character-turnaround/fill', { vars: { '角色名': '沈知微' } });
check('模板填充', filled.text.includes('沈知微'));

// 7. 项目串联
const proj = await call('POST', '/api/projects', { name: '冒烟项目', visualStyle: 'noir-manga', episodes: 2 });
check('新建项目', !!proj.id);
// 生成下线后，剧本写进项目走专门的端点（原来由 /api/generate 顺手写回）
const saved = await call('POST', `/api/projects/${proj.id}/script`, { script: gen.script, outline: gen.outline });
check('剧本存入项目', (saved.progress ?? 0) > 0, `进度 ${saved.progress}%`);
const p2 = await call('POST', '/api/evaluate', { projectId: proj.id });
check('按项目评估', typeof p2.score === 'number', `${p2.score} 分`);

// 8. 新增功能：对标 / 统计 / 格式 / 润色 / 标题 / 关系
const cmp = await call('POST', '/api/compare', { script: gen.script, outline: gen.outline });
check('对标分析', !!cmp.verdict && !!cmp.benchmark, `${cmp.gaps.length} 处差距`);
const st = await call('POST', '/api/stats', { script: gen.script, outline: gen.outline });
check('统计报表', st.totals.episodes > 0 && st.rhythm.length > 0, `${st.totals.scenes} 场 / ${st.totals.lines} 句`);
const fmts = await call('POST', '/api/format', { script: gen.script, outline: gen.outline, format: 'short-drama' });
check('格式转换', fmts.text.includes('场') && fmts.text.length > 100, `${fmts.text.length} 字`);
const pl = await call('POST', '/api/polish', { line: '那个，我跟你说，反正就是我今天就是说不太想去，然后呢就算了' });
check('台词润色', pl.polished.length < pl.original.length && !pl.polished.startsWith('，'), `${pl.changes.length} 处改动`);
const ti = await call('POST', '/api/titles', { genre: '悬疑', keyword: '渡口', count: 8 });
check('爆款标题', ti.items.length >= 4 && ti.total > ti.items.length, `${ti.items.length} 条 / 池 ${ti.total}`);
const rel = await call('POST', '/api/relations', { script: gen.script, outline: gen.outline });
check('人物关系', rel.nodes.length > 0 && Array.isArray(rel.edges), `${rel.nodes.length} 节点 / ${rel.edges.length} 边`);

// 9. 删除项目（软删除：只摘索引，正文文件保留在磁盘上，误删可找回）
await call('DELETE', `/api/projects/${proj.id}`);
const afterDel = await call('GET', '/api/projects');
check('删除项目', !(afterDel.items ?? []).some((it) => it.id === proj.id), '索引已摘除，正文文件保留可找回');
let delMissing = false;
try { await call('DELETE', '/api/projects/不存在的id'); } catch (e) { delMissing = e.message.includes('404'); }
check('删除不存在的项目返回 404', delMissing);

// 10. 错误处理
let rejected = false;
try { await call('POST', '/api/evaluate', {}); } catch (e) { rejected = e.message.includes('400') || e.message.includes('422'); }
check('缺参数时返回 4xx', rejected);

console.log(failed ? `\n✗ ${failed} 项失败` : '\n✓ 冒烟全部通过');
process.exit(failed ? 1 : 0);
