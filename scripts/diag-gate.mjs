/* 门禁诊断：冒烟只报「23/24」，不说是哪道门。
 * 本脚本从存储里捞最近一份生成稿，把未过的门连细节一起打出来。
 * 用法：node scripts/diag-gate.mjs（只读，不调模型，不花钱）*/
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateReport as outlineGates } from '../src/engine/outline.mjs';
import { gateReport as scriptGates } from '../src/engine/script.mjs';

// 用 fileURLToPath 而不是 URL.pathname：后者返回百分号编码串（中文目录会变成
// %E5%88%9B…），拿去做 scandir 必然 ENOENT；它还会留下 Windows 盘符前的斜杠。
const dir = fileURLToPath(new URL('../data/', import.meta.url));

// 全新克隆 / 干净代码包里没有 data/。诊断脚本在这种情况应该「说清楚然后正常退出」，
// 而不是抛 ENOENT——否则 selftest 里「该脚本可跑通」那条在任何人第一次跑时都是红的。
if (!existsSync(dir)) {
  console.log('还没有 data/ 目录（全新克隆或第一次运行）。');
  console.log('先跑一次 node scripts/probe-scriptgen.mjs 或 node scripts/smoke.mjs 生成一份稿，再回来看门禁细节。');
  process.exit(0);
}

const cands = readdirSync(dir)
  .filter((f) => f.startsWith('project-') && f.endsWith('.json'))
  .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);

let found = false;
for (const { f } of cands) {
  let p;
  try { p = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
  if (!/生成稿/.test(p.name ?? '')) continue;
  const o = p.stages?.outline?.data;
  const s = p.stages?.script?.data;
  if (!o || !s) continue;
  found = true;
  const of_ = outlineGates(o).filter((g) => !g.ok);
  const sf = scriptGates(s, { outline: o }).filter((g) => !g.ok);
  console.log('项目:', p.name, '|', f, '| 集数:', s.episodes?.length);
  console.log('大纲门未过:', of_.map((g) => `${g.id}：${g.detail}`).join(' || ') || '无');
  console.log('剧本门未过:', sf.map((g) => `${g.id}：${g.detail}`).join(' || ') || '无');
  if (sf.length) {
    console.log('--- 剧本门细节 ---');
    for (const g of sf) console.log(JSON.stringify(g, null, 1).slice(0, 900));
    console.log('每集场数:', (s.episodes || []).map((e) => e.scenes?.length).join(','));
    console.log('角色:', (o.characters || []).map((c) => `${c.name}=${c.tier}`).join(' '));
  }
  break;
}

if (!found) {
  console.log(`data/ 里有 ${cands.length} 个项目，但没有同时含「大纲 + 剧本」的生成稿。`);
  console.log('先跑一次 node scripts/probe-scriptgen.mjs 生成一份，再看这里。');
}
