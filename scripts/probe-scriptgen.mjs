/*
 * 剧本生成链路探针 —— 不联网、不花模型钱（临时 DATA_DIR 让运行时设置为空，强制 mock）。
 *
 * 验两件事：
 *   ① 三段式（梗概人设 → 分集大纲 → 单集正文）在 mock 下能不能跑通
 *   ② 每段产出过不过引擎门（大纲门 / 剧本门）
 *
 * 用法：DATA_DIR="$TEMP/probe-scriptgen" node scripts/probe-scriptgen.mjs
 *   （DATA_DIR 必须指向一个空目录：运行时设置为空才会走 mock，不会误连真 API）
 */
import { generateStory, generateOutline, generateEpisode, assemble } from '../src/services/scriptGenService.js';

const CONCEPT = '都市重生复仇：女主被闺蜜与未婚夫联手夺走公司，重生回到他们密谋窃取项目的酒会当晚';

let bad = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) bad += 1;
};

const run = async () => {
  console.log('='.repeat(70));
  console.log('▶ Stage A：梗概与人物小传');
  const story = await generateStory({ concept: CONCEPT, episodes: 10 });
  check('story 形状', story.title.length > 0 && story.characters.length >= 5, `${story.title}｜${story.characters.length} 角色`);
  check('人物定位', story.characters.some((c) => /女主/.test(c.role)) && story.characters.some((c) => /反派/.test(c.role)),
    story.characters.map((c) => `${c.name}(${c.role})`).join(' '));

  console.log('\n▶ Stage B：分集大纲（1–10 集，一批）');
  const outline = await generateOutline({ story, from: 1, to: 10 });
  check('10 集大纲', outline.episodes.length === 10, `角色 ${outline.characters.length}｜场景 ${outline.scenes.length}｜爽点 ${outline.beats.length}`);
  const ogFailed = [];
  {
    const { gateReport } = await import('../src/engine/outline.mjs');
    for (const g of gateReport(outline)) if (!g.ok) ogFailed.push(`${g.id}:${g.detail.slice(0, 40)}`);
  }
  check('大纲门全过', ogFailed.length === 0, ogFailed.join('；') || '14/14');
  check('major 爽点在前', outline.beats.some((b) => b.weight === 'major' && b.episode < 10), `第 ${outline.beats.filter((b) => b.weight === 'major').map((b) => b.episode).join(',')} 集`);

  console.log('\n▶ Stage C：逐集正文（第 1、2 集）');
  const eps = [];
  for (const ep of [1, 2]) {
    const r = await generateEpisode({ story, outline, ep, prevEnding: ep === 1 ? '' : eps[0].text.slice(-80) });
    const failed = r.gates.filter((g) => !g.ok);
    check(`第 ${ep} 集生成`, r.passed, `${r.text.length} 字｜门 ${r.gates.length - failed.length}/${r.gates.length}${failed.length ? `｜未过 ${failed.map((g) => g.id)}` : ''}`);
    if (failed.length) console.log(`     诊断：${failed.map((g) => g.detail.slice(0, 60)).join('；')}`);
    eps.push(r);
  }

  console.log('\n▶ 组装整稿');
  const full = await assemble({ story, outline, texts: eps.map((e) => e.text) });
  check('整稿集数', full.script.episodes.length === 2, `${full.script.episodes.length} 集｜${full.stats.scenes} 场｜${full.stats.lines} 句台词`);
  check('整稿门禁', full.passed, `未过：${full.gates.filter((g) => !g.ok).map((g) => `${g.scope}:${g.id}`).join(',') || '无'}`);
  check('id 对齐（refs 门）', full.gates.find((g) => g.id === 'refs-characters')?.ok,
    `角色 ${full.outline.characters.length}｜场景 ${full.outline.scenes.length}`);

  console.log('\n' + '='.repeat(70));
  console.log(bad === 0 ? '=== 剧本生成链路全部通过 ===' : `=== 有 ${bad} 处不通过 ===`);
  process.exitCode = bad === 0 ? 0 : 1;
};

run().catch((e) => { console.error('探针崩了：', e); process.exitCode = 1; });
