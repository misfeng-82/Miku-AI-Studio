/*
 * 真模型产出回放：拿 data/ 里真实引擎产出（DeepSeek 等）跑一遍
 * 「大纲修复 → 剧本归一化/归属修复 → 确定性自动修复 → 质检」，
 * 全程不联网、零费用。
 *
 * 这是验证「模型管创意、代码管契约」是否真的成立的最硬证据：
 * 模型返回什么形状都不该让门挂掉，契约必须由代码兜住。
 *
 * 用法：
 *   node scripts/replay.mjs                      # 回放 data/ 下全部有 outline+script 的项目
 *   node scripts/replay.mjs data/project-xx.json  # 只回放指定文件
 */
import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dataDir = resolve(root, 'data');

const S = await import('../src/services/scriptService.js');

const args = process.argv.slice(2);
const files = (args.length ? args : fs.readdirSync(dataDir).map((f) => resolve(dataDir, f)))
  .filter((f) => f.endsWith('.json'))
  .filter((f) => {
    try {
      const p = JSON.parse(fs.readFileSync(f, 'utf8'));
      return p?.stages?.outline?.data && p?.stages?.script?.data;
    } catch { return false; }
  });

if (!files.length) {
  console.log('data/ 下没有同时含 outline 与 script 的项目，无可回放样本');
  process.exit(0);
}

let worst = 100;
let emptySamples = 0;
for (const f of files) {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rawOutline = p.stages.outline.data;
  const rawScript = p.stages.script.data;
  const proj = p.project ?? {};

  console.log(`\n${'='.repeat(74)}`);
  console.log(`▶ ${rawOutline.source ?? '(无剧名)'} | ${rawScript.episodes?.length ?? 0} 集 | ${f.replace(root, '.')}`);
  console.log(`  原始形状 ep=[${Object.keys(rawScript.episodes?.[0] ?? {}).join(',')}] scene=[${Object.keys(rawScript.episodes?.[0]?.scenes?.[0] ?? {}).join(',')}]`);

  // 模型完全没给出场次节拍的样本：线上 generateScript 会直接报错要求重试。
  // 回放里如实标注并排除出评分——否则「引擎拒绝」会被误读成「质检不过」。
  const rawBeats = (rawScript.episodes ?? []).reduce((n, e) => n + (e.scenes ?? [])
    .reduce((m, s) => m + (s.flow ?? s.beats ?? s.actions ?? []).length, 0), 0);
  if (!rawBeats) {
    console.log('  ⚠ 空壳样本：模型未返回可用节拍 → 线上直接报错要求重试，不计入评分');
    emptySamples += 1;
    continue;
  }

  // ① 大纲：项目里存的就是当初已修复过的那份，直接用
  // （repairOutline 属生成链路，2026-10-17 随剧本生成功能框一并移除）
  const outline = rawOutline;

  // ② 剧本：同样是已归一化后的产物（normalizeScriptEpisodes / repairScriptEpisodes 同属生成链路，已移除）
  const norm = rawScript.episodes ?? [];
  const minutes = proj.minutesPerEpisode ?? rawOutline.params?.minutesPerEpisode ?? 2;
  const targetSeconds = Math.max(30, Math.round(minutes * 60));
  const params = { ...(rawOutline.params ?? {}), episodes: outline.episodes.length, minutesPerEpisode: minutes };
  const script = {
    source: rawScript.source || outline.source,
    params,
    episodes: norm.map((ep) => ({ ...ep, targetSeconds, hookBeat: ep.hookBeat ?? (ep.scenes?.length ? [1, 1] : undefined) })),
  };

  const before = S.evaluateScript(script, outline);
  // ③ 确定性自动修复
  const fixed = S.autoFixScript(script, before.problems, params, outline);
  script.episodes = fixed.script.episodes;
  const after = S.evaluateScript(script, outline);

  console.log(`  角色 ${outline.characters.length} / 场景 ${outline.scenes.length} / 道具 ${outline.props.length} / 节拍 ${outline.beats.length}`);
  console.log(`  每集场次 ${script.episodes.map((e) => e.scenes.length).join(',')} | 每集节拍 ${script.episodes.map((e) => e.scenes.reduce((n, s) => n + s.flow.length, 0)).join(',')}`);
  console.log(`  每集估秒 ${after.stats.episodes.map((e) => e.est).join(',')} / 目标 ${script.episodes.map((e) => e.targetSeconds).join(',')}`);
  console.log(`  质检 ${before.score} → ${after.score} 分 (${after.passed}/${after.total}) | 自动修复 ${fixed.changed} 处`);
  if (after.problems.length) {
    for (const g of after.problems) console.log(`    ✗ [${g.scope}] ${g.id}: ${g.gates ? '' : ''}${g.detail}`);
  } else {
    console.log('    ✓ 全部质量门通过');
  }
  worst = Math.min(worst, after.score);

}

console.log(`\n${'='.repeat(74)}`);
const valid = files.length - emptySamples;
console.log(`样本 ${files.length} 个（有效 ${valid}，空壳 ${emptySamples}）| 最低质检 ${worst} 分`);
console.log(worst === 100
  ? '=== 有效样本全部 100 分 ==='
  : '=== 仍有未过项，见上方明细 ===');
if (worst !== 100) process.exitCode = 1;
