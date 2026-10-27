/*
 * 剧本导入探针 —— 不联网、不花模型钱。
 *
 * 验一件事：人写的剧本文本 / 导出的 JSON → 引擎契约
 * （集号、场次、台词、角色 id 是否都对，解析不出来的输入是否被明确拒绝）。
 *
 * 用法：node scripts/probe-import.mjs
 */
import { parseScriptText, describeImport } from '../public/parseScriptText.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE = (n) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', n), 'utf8');

const SAMPLE_TEXT = `第1集
场1-2 夜 内 渡口·码头
阿莲推门进来，手里拎着一只旧木箱，箱角磨得发白。
阿莲：这箱子上了船，就下不去了。
船客甲（低声）：谁的箱子，谁心里清楚。
她攥紧箱盖的手指发白，指节在雾里像竹枝。
船客乙：三年前也是这个时辰，那条船没回来。
场2-1 夜 外 渡口栈桥
雾贴着水面走，栈桥的木板一块一块地响。
阿莲：你们每个人的小腿上，是不是都有一道一样的伤？

第2集
场1-1 日 内 渡口账房
账本摊在桌上，墨迹还没干。
阿莲：这页被人换过，纸色不对。
船客甲：换账的人，就是想换掉整条船的人。`;

const CASES = [
  { name: '剧本文本（短剧场号格式）', input: SAMPLE_TEXT },
  { name: '都市涅槃标准稿（AI 短剧格式）', input: FIXTURE('都市涅槃-sample.md') },
  { name: '导出的 JSON（契约形状）', input: JSON.stringify({ script: { source: '手写剧', episodes: [{ ep: 1, targetSeconds: 60, scenes: [{ sceneId: 'S01', lighting: '夜景', characters: ['C01'], props: [], flow: [{ action: '她推门进来。' }, { speaker: 'C01', line: '别问了。', delivery: '低声' }] }] }] } }) },
  { name: '空输入', input: '   ' },
  { name: '解析不出的废话', input: '。。。' },
];

let bad = 0;
for (const c of CASES) {
  const r = parseScriptText(c.input);
  console.log(`\n${'='.repeat(70)}\n▶ ${c.name}`);
  if (!r.ok) {
    console.log(`  → 拒绝（这是对的）：${r.message}`);
    continue;
  }
  const s = r.script;
  console.log(`  → 来源 ${r.from} | ${describeImport(r.stats)}`);
  console.log(`     集: ${s.episodes.map((e) => e.ep).join(',')} | 每集场次: ${s.episodes.map((e) => e.scenes.length).join('/')} | 每集拍数: ${s.episodes.map((e) => e.scenes.reduce((n, x) => n + x.flow.length, 0)).join('/')}`);
  console.log(`     角色: ${(r.outline?.characters ?? []).map((x) => `${x.id}=${x.name}`).join(' ')}`);
  const ep0 = s.episodes[0];
  console.log(`     第1集第1场: ${ep0.scenes[0].sceneId} / ${ep0.scenes[0].lighting} / 人物 ${JSON.stringify(ep0.scenes[0].characters)}`);
  console.log(`     前两拍: ${JSON.stringify(ep0.scenes[0].flow.slice(0, 2))}`);
  const okShape = s.episodes.every((e) => e.ep > 0 && e.scenes.length > 0 && e.scenes.every((x) => /^S\d{2,}$/.test(x.sceneId)))
    && s.episodes.some((e) => e.scenes.some((x) => x.flow.some((b) => b.line)))
    && ep0.scenes[0].flow.every((b) => (b.line ? typeof b.speaker === 'string' && /^C\d{2,}$/.test(b.speaker) : typeof b.action === 'string'));
  console.log(`     契约自检: ${okShape ? '✓' : '✗'}`);
  if (!okShape) bad += 1;

}

console.log(`\n${'='.repeat(70)}`);
console.log(bad === 0 ? '=== 剧本导入链路全部通过 ===' : `=== 有 ${bad} 处不通过 ===`);
process.exitCode = bad === 0 ? 0 : 1;
