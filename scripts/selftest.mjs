// 自测：覆盖 JSON 降级解析、确定性优化器、引擎质量门三条主线
// 第一个 import 是「强制离线」：排在 config.js 之前，临时 DATA_DIR 让运行时 Key 为空
import './forceMockEnv.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import { loadJsonLike, loadJsonArrayLike } from '../src/agent/jsonRepair.js';
import { autoFixScript, evaluateScript, estimateSeconds } from '../src/services/scriptService.js';
import { gateReport as outlineGates } from '../src/engine/outline.mjs';
import { gateReport as scriptGates } from '../src/engine/script.mjs';
import { analyzeText as deaiAnalyze, deaiGate, extractBody, bankStats } from '../src/engine/deaiScan.mjs';
import { bookGates, chapterGates, readiness, wordCount, punctuationCount } from '../src/engine/novelGates.mjs';
import { tidyDialogue, tidyChapterBody } from '../src/engine/textClean.mjs';
import {
  analyzeChapter, buildBookMemory, memoryToPrompt, updateForeshadow, continuityCheck, confirmForeshadow,
} from '../src/engine/novelMemory.mjs';
import { parseScriptText } from '../public/parseScriptText.js';
import { generateStory, generateOutline, generateEpisode, assemble, splitLongLines } from '../src/services/scriptGenService.js';
import { HOT_DRAMAS, HOT_BOARD_META } from '../src/assets/hotDramas.js';
import { pickDramas } from '../src/services/crawlService.js';
import { analyzeHot } from '../src/services/analyzeService.js';

const here = dirname(fileURLToPath(import.meta.url));
// 夹具收在 scripts/fixtures/ 里：早先从项目外的 ../../repos/ 读，
// 于是「把项目单独打包带走」就再也跑不了自测——自测必须自包含
const fixture = (p) => JSON.parse(readFileSync(resolve(here, 'fixtures', p), 'utf8'));

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    fn();
    pass += 1;
  } catch (e) {
    fail += 1;
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
};
// 异步用例：同步 t() 等不到 Promise，统一收集到末尾 await，避免「假通过」
const asyncTests = [];
const tAsync = (name, fn) => asyncTests.push([name, fn]);

/* ---- 五级降级 JSON 解析 ---- */
t('直接解析合法 JSON', () => assert.deepEqual(loadJsonLike('{"a":1}'), { a: 1 }));
t('剥离代码围栏', () => assert.deepEqual(loadJsonLike('```json\n{"a":2}\n```'), { a: 2 }));
t('从前后废话里抠出对象', () => assert.deepEqual(loadJsonLike('好的：{"a":3} 以上'), { a: 3 }));
t('补未加引号的键', () => assert.deepEqual(loadJsonLike('{a: 4}'), { a: 4 }));
t('处理尾逗号', () => assert.deepEqual(loadJsonLike('{"a":5,}'), { a: 5 }));
t('中文引号归一', () => assert.deepEqual(loadJsonLike('{"a":"“引号”"}'), { a: '“引号”' }));
t('数组直取', () => assert.deepEqual(loadJsonArrayLike('[1,2,3]'), [1, 2, 3]));
t('从包装对象里取数组', () => assert.deepEqual(loadJsonArrayLike('{"items":[1,2]}'), [1, 2]));
t('解析不出来时返回兜底', () => assert.deepEqual(loadJsonArrayLike('完全不是JSON', []), []));

/* ---- 引擎质量门（用上游示例数据对账）---- */
const outline = fixture('渡口-outline.json');
const script = fixture('渡口-script.json');

t('大纲门共 14 道', () => assert.equal(outlineGates(outline).length, 14));
t('剧本门共 10 道', () => assert.equal(scriptGates(script, { outline }).length, 10));
t('示例剧本 10 门全过', () => assert.equal(scriptGates(script, { outline }).filter((g) => !g.ok).length, 0));

/* ---- 确定性优化器 ---- */
const broken = {
  source: 't',
  episodes: [{
    ep: 1,
    targetSeconds: 120,
    hook: 'h',
    cliff: 'c',
    hookBeat: [1, 1],
    scenes: [{
      sceneId: 'S01',
      characters: ['C01'],
      flow: [
        // 一句 60 字的超长台词，必须被拆开
        { speaker: 'C01', line: '这是一句非常非常长的台词用来测试超长台词是否会被正确拆分成多个短句以满足单句不超过三十五个字的质量门要求不然就会被拦下', delivery: '' },
      ],
    }],
  }],
};

t('超长台词被拆分', () => {
  const { script: fixed } = autoFixScript(broken, [{ id: 'line-length' }], {});
  const lines = fixed.episodes[0].scenes[0].flow.filter((b) => b.line);
  assert.ok(lines.length > 1, '应拆成多句');
  assert.ok(lines.every((b) => b.line.length <= 35), '每句都应不超过 35 字');
});

t('纯对白场次自动补动作节拍', () => {
  const { script: fixed } = autoFixScript(broken, [{ id: 'has-action' }], {});
  assert.ok(fixed.episodes[0].scenes[0].flow.some((b) => b.action), '应补入动作节拍');
});

t('时长不足时自动回补', () => {
  const short = {
    source: 't',
    episodes: [{
      ep: 1, targetSeconds: 120, hook: 'h', cliff: 'c', hookBeat: [1, 1],
      scenes: [{ sceneId: 'S01', characters: ['C01'], flow: [{ action: '只有一句动作' }] }],
    }],
  };
  const { script: fixed } = autoFixScript(short, [{ id: 'duration' }], {});
  const est = estimateSeconds(fixed.episodes[0]);
  assert.ok(est >= 120 * 0.85, `补齐后应进入目标区间，实际 ${est}s`);
});

t('评估返回分数与门清单', () => {
  const r = evaluateScript(script, outline);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(r.gates.length, 24);
});

/* ---- 画风预设：中/英/反向三件套必须齐全（参考仓库缺失的反例）---- */
const { STYLE_PRESETS, stylePromptSuffix, styleGuardrail } = await import('../src/assets/stylePresets.js');
t('画风预设成对齐全', () => {
  assert.ok(STYLE_PRESETS.length >= 12);
  for (const s of STYLE_PRESETS) {
    assert.ok(s.prompt && s.en && s.negative, `${s.id} 缺少中文/英文/反向提示词之一`);
  }
});
t('画风 id 无重复', () => assert.equal(new Set(STYLE_PRESETS.map((s) => s.id)).size, STYLE_PRESETS.length));
t('风格注入与护栏非空', () => {
  assert.ok(stylePromptSuffix('noir-manga').includes('画风'));
  assert.ok(styleGuardrail('noir-manga').length > 10);
});

/* ---- 提示词模板库 ---- */
const lib = await import('../src/assets/promptLibrary.js');
t('模板库含各阶段模板', () => {
  const targets = new Set(lib.PROMPT_TEMPLATES.map((x) => x.target));
  for (const k of ['outline', 'script', 'characterModel', 'sceneModel', 'imagePrompt', 'videoPrompt']) {
    assert.ok(targets.has(k), `缺少 ${k} 模板`);
  }
});
t('模板填充替换变量', () => {
  const out = lib.fillTemplate('character-turnaround', { '角色名': '沈知微' });
  assert.ok(out.includes('沈知微'));
});
t('未填变量保留占位符', () => assert.ok(lib.fillTemplate('scene-model', {}).includes('{场景名}')));

// 题材公式库（genreFormulas）随剧本生成功能框于 2026-10-17 一并下线，相关用例移除。

/* ---- 爆款结构拆解 ---- */
const analyze = await import('../src/services/analyzeService.js');
t('榜单画像产出建议', () => {
  const r = analyze.analyzeHot({ items: [
    { rank: 1, title: '逆袭', genre: '女频逆袭', platform: '抖音', heat: 95, episodes: 30, hookTypes: ['打脸'] },
    { rank: 2, title: '战神', genre: '男频战神', platform: '快手', heat: 90, episodes: 40, hookTypes: ['反转'] },
  ] });
  assert.equal(r.count, 2);
  assert.ok(r.advice.length > 0);
  assert.ok(r.hooks.length > 0);
});
t('中文诵读时长按 4.2 字/秒估算', () => {
  const s = analyze.speechSeconds('一二三四五六七八');   // 8 字 ≈ 1.9s
  assert.ok(s >= 1.5 && s <= 2.5, `实际 ${s}s`);
});
t('剧本结构体检产出警告', () => {
  const r = analyze.analyzeScript(script, outline);
  assert.ok(r.episodes.length > 0);
  assert.ok(Array.isArray(r.warnings));
});

/* ---- 评估与优化 ---- */
const { evaluate } = await import('../src/services/evaluateService.js');
const { deterministicFix, humanAdvice } = await import('../src/services/optimizeService.js');
t('评估产出三维分', () => {
  const r = evaluate(script, outline);
  assert.ok(r.dimensions.script >= 0 && r.dimensions.outline >= 0 && r.dimensions.structure >= 0);
  assert.equal(r.gates.length, 24);
});
t('确定性优化不降低分数', () => {
  const r = deterministicFix(script, outline);
  assert.ok(r.after.score >= r.before.score, `${r.before.score} -> ${r.after.score}`);
});
t('人工建议按门聚合', () => {
  const r = evaluate(script, outline);
  const advice = humanAdvice(r.problems);
  assert.ok(Array.isArray(advice));
  assert.ok(advice.every((a) => typeof a.advice === 'string' && a.advice.length > 0));
});

/* ---- 资产中心 ---- */
const assetService = await import('../src/services/assetService.js');
const assets = assetService.buildAssets(outline, script, { styleId: 'cn-guoman' });
t('资产含角色与场景', () => {
  assert.ok(assets.characters.length > 0 && assets.scenes.length > 0);
});
t('一致性提示词含锁定维度', () => {
  assert.ok(assets.characters[0].consistencyPrompt.includes('跨镜头锁定项'));
  assert.ok(assets.characters[0].consistencyPrompt.includes('发型'));
});
t('场景图强制无人', () => assert.ok(assets.scenes[0].noPeopleGuard.includes('禁止出现人物')));
t('参考图策略禁止串联', () => assert.ok(assets.referencePolicy.rules.some((r) => r.includes('串联'))));
t('统计资产实际出场', () => assert.ok(Array.isArray(assets.usage.characters)));

/* ---- 台词本 ---- */
const lineBook = await import('../src/services/lineBookService.js');
const book = lineBook.buildLineBook(script, outline, null);
t('台词本按角色汇总', () => {
  assert.ok(book.characters.length > 0);
  assert.ok(book.totals.lines > 0);
});
t('台词时间累加正确', () => {
  const sum = book.characters.reduce((s, c) => s + c.seconds, 0);
  assert.ok(Math.abs(sum - book.totals.seconds) < 1);
});
t('CSV 导出带表头', () => assert.ok(lineBook.toCsv(book).startsWith('"角色"')));
t('分角色台本按人分段', () => assert.ok(lineBook.toPerformerScript(book).includes('# ')));

/* ---- 都市涅槃标准稿解析（AI 短剧格式） ---- */
const nirvana = readFileSync(resolve(here, 'fixtures', '都市涅槃-sample.md'), 'utf8');
const nv = parseScriptText(nirvana);
t('都市涅槃格式：3 集 6 场全部解析', () => {
  assert.equal(nv.ok, true, nv.message);
  assert.equal(nv.script.episodes.length, 3);
  assert.equal(nv.script.episodes[0].scenes.length, 3, '第 1 集应是 3 场（含闪回场）');
});
t('都市涅槃格式：场号 U+2011 与场景名', () => {
  const s = nv.script.episodes[0].scenes[0];
  assert.equal(s.name, '铂悦酒店·顶层酒会大厅');
  assert.equal(s.lighting, '夜景');
  assert.equal(nv.script.episodes[2].scenes[1].name, '苏家别墅·苏清鸢卧室');
});
t('都市涅槃格式：台词拆出「角色+方式」', () => {
  const flow = nv.script.episodes[0].scenes[0].flow;
  const dlg = flow.find((b) => b.speaker && b.line.includes('家族撮合'));
  assert.equal(dlg.speaker, nv.outline.characters.find((c) => c.name === '顾景琛').id);
  assert.ok(dlg.delivery.includes('对着身边宾客'), `方式应进 delivery，实际：${dlg.delivery}`);
  // 守卫 b.speaker：动作块没有 line 字段，不守卫会撞上 undefined.includes
  const os = nv.script.episodes[0].scenes[2].flow.find((b) => b.speaker && b.line.includes('我回来了'));
  assert.equal(os.speaker, nv.outline.characters.find((c) => c.name === '苏清鸢').id);
  assert.ok(os.delivery.includes('OS'), `OS 应进 delivery，实际：${os.delivery}`);
});
t('都市涅槃格式：人物小传进大纲角色表', () => {
  const byName = new Map(nv.outline.characters.map((c) => [c.name, c]));
  assert.equal(byName.get('苏清鸢').role, '女主');
  assert.equal(byName.get('苏清鸢').tier, 'lead');
  assert.equal(byName.get('顾景琛').tier, 'lead');
  assert.equal(byName.get('苏明远').role, '苏父', '「苏父苏明远、苏母温岚」应拆成两个角色');
  assert.equal(byName.get('温岚').role, '苏母');
  assert.equal(byName.get('群演').tier, 'functional', '一次性配角应进群演桶');
  assert.ok(byName.size <= 5 + 10 + 10, '角色总数不能超大纲门的上限');
});
t('都市涅槃格式：闪回/字幕/音效标记留作动作', () => {
  const acts = nv.script.episodes[0].scenes.flatMap((s) => s.flow).filter((b) => b.action).map((b) => b.action);
  assert.ok(acts.some((a) => a.startsWith('字幕：')), '字幕行应是动作');
  assert.ok(acts.some((a) => a === '【闪回】'), '闪回标记应原样保留');
  assert.ok(acts.some((a) => a === '【闪出】'), '闪出标记应原样保留');
});
t('都市涅槃格式：前载（梗概/剧名/题材）进大纲', () => {
  assert.equal(nv.outline.title, 'AI短剧《都市涅槃》40集原创剧本');
  assert.equal(nv.outline.genre, '都市重生复仇');
  assert.ok(nv.outline.synopsis.includes('苏清鸢'));
});
t('都市涅槃格式：剧本门仅台词超长不过（人类样本正常长度）', () => {
  const failed = scriptGates(nv.script, { outline: nv.outline }).filter((g) => !g.ok).map((g) => g.id);
  assert.deepEqual(failed, ['line-length'], `样本只有台词长度会超引擎默认 35 字，实际未过：${failed.join(',')}`);
});

/* ---- 长台词拆句（生成链路的确定性兜底） ---- */
t('拆句：超 22 字的台词按标点切成连着说的两句', () => {
  const doc = { episodes: [{ ep: 1, scenes: [{ flow: [
    { speaker: 'C01', line: '冲销在四月二日。连本带息一共是三百二十万，你要是不认，我就把流水贴到楼下大堂去。' },
    { speaker: 'C01', line: '短句。' },
    { action: '他放下账本。' },
  ] }] }] };
  const flow = splitLongLines(doc).episodes[0].scenes[0].flow;
  const lines = flow.filter((b) => b.line).map((b) => b.line);
  const chars = (s) => s.replace(/\s+/g, '').length;
  assert.ok(lines.every((l) => chars(l) <= 22), `拆完仍超 22 字：${lines.join(' / ')}`);
  // 拆完拼回去必须一字不差：断句是重新分行，不是删内容
  assert.equal(lines.slice(0, -1).join(''), '冲销在四月二日。连本带息一共是三百二十万，你要是不认，我就把流水贴到楼下大堂去。');
  assert.ok(lines[0].endsWith('，') || lines[0].endsWith('。'), '应在标点处断，不是硬切');
  assert.equal(flow[0].speaker, 'C01', '拆出来的每句都还是同一个人说的');
  assert.equal(lines.at(-1), '短句。', '本来就短的台词不动');
  assert.ok(flow.some((b) => b.action === '他放下账本。'), '动作块不能被拆');
});

/* ---- 题材库 ---- */
const gl = await import('../src/assets/genreLibrary.js');
t('题材库：32 个题材，6 个原有标记 legacy，26 个新增', () => {
  assert.equal(gl.GENRES.length, 32);
  assert.equal(gl.GENRES.filter((g) => g.legacy).length, 6);
  assert.ok(gl.GENRES.filter((g) => !g.legacy).length >= 20, '新增题材至少 20 个');
});
t('题材库：每个题材字段齐全，爽点落在矩阵内', () => {
  for (const g of gl.GENRES) {
    for (const f of ['id', 'name', 'category', 'channel', 'era', 'tagline', 'audience', 'opening']) {
      assert.ok(String(g[f] ?? '').trim(), `${g.name} 缺 ${f}`);
    }
    assert.ok(g.thrills.length >= 2, `${g.name} 爽点太少`);
    assert.ok(g.thrills.every((t) => gl.THRILLS.includes(t)), `${g.name} 有爽点不在矩阵内`);
    assert.ok(g.keywords.length >= 3 && g.keywords.length <= 5, `${g.name} 关键词要 3–5 个`);
    assert.ok(g.tropes.length >= 3, `${g.name} 桥段池太少`);
    assert.equal(g.formats.length > 0, true, `${g.name} 没标适配篇幅`);
    assert.ok(gl.GENRE_CATEGORIES.some((c) => c.id === g.category), `${g.name} 大类不存在`);
  }
});
t('题材库：id 唯一，旧的中文题材名仍能查到', () => {
  assert.equal(new Set(gl.GENRES.map((g) => g.id)).size, gl.GENRES.length);
  for (const n of ['都市重生复仇', '都市逆袭', '战神归来', '悬疑反转', '古代宅斗', '甜宠言情']) {
    assert.ok(gl.genreById(n), `旧题材名 ${n} 查不到`);
  }
  assert.equal(gl.genreById('不存在的id').id, gl.DEFAULT_GENRE_ID, '未知 id 回落到默认题材');
});
t('题材库：题材块含差异化设定与禁止复用', () => {
  const g = gl.genreById('retro-70s-pet');
  const block = gl.genreBlock(g, { variant: gl.pickVariant(g, 3), avoid: ['《旧作A》', '苏清鸢、顾景琛'] });
  assert.ok(block.includes('【题材坐标】'), '要有题材坐标段');
  assert.ok(block.includes('本次差异化设定'), '要带变体');
  assert.ok(block.includes('【禁止复用】') && block.includes('《旧作A》'), '要带黑名单');
  assert.ok(block.includes(g.tagline), '定位要进块');
});
t('题材库：同题材按 seed 能取出不同变体组合', () => {
  const g = gl.genreById('urban-rebirth-revenge');
  const a = gl.pickVariant(g, 1);
  const b = gl.pickVariant(g, 2);
  assert.notDeepEqual(a, b, '相邻 seed 应给出不同组合');
  assert.ok(gl.variantSpace(g) >= 4, '组合空间至少 4 种');
});

/* ---- 结构资产库（节奏 / 付费卡点 / 反派 / 钩子） ---- */
const ss = await import('../src/assets/storyStructure.js');
t('结构库：付费卡点位置与密度符合行业口径', () => {
  for (const n of [40, 60, 100]) {
    const { count, marks } = ss.paywallPlan(n);
    assert.ok(count >= 3 && count <= 13, `${n} 集卡点数 ${count} 应在 3–13`);
    assert.ok(count / n >= 0.08 && count / n <= 0.15, `${n} 集卡点占比 ${(count / n * 100).toFixed(0)}% 应在 10–15%`);
    assert.ok(marks[0].ep >= 8 && marks[0].ep <= 12, `首个卡点应在第 8–12 集，实际 ${marks[0].ep}`);
    assert.ok(n - marks[marks.length - 1].ep <= 5, `终极卡点应在倒数 3–5 集，实际 ${marks[marks.length - 1].ep}`);
    for (let i = 1; i < marks.length; i += 1) {
      assert.ok(marks[i].ep - marks[i - 1].ep >= 5, `第 ${marks[i].ep} 集与上一卡点间隔应 ≥5 集`);
    }
    assert.equal(new Set(marks.map((m) => m.ep)).size, marks.length, '卡点集不能重复');
  }
  assert.deepEqual(ss.paywallPlan(6).marks, [], '集数太短不设付费卡点');
});
t('结构库：节奏四段覆盖全剧且不重叠', () => {
  for (const n of [40, 100]) {
    const plan = ss.rhythmPlan(n);
    assert.equal(plan[0].from, 1);
    assert.equal(plan[plan.length - 1].to, n);
    for (let i = 1; i < plan.length; i += 1) assert.equal(plan[i].from, plan[i - 1].to + 1, '段落必须连续');
  }
});
t('结构库：反派分层按集数切；甜宠类不设隐藏反派', () => {
  const full = ss.villainPlan(40, gl.genreById('urban-rebirth-revenge'));
  assert.equal(full.length, 4, '对抗驱动题材应四层齐全');
  assert.ok(full[0].fromEp < full[1].fromEp && full[1].fromEp < full[2].fromEp, '层级要递进');
  assert.equal(full[full.length - 1].toEp, 40, '最后一层要覆盖到结局');
  const light = ss.villainPlan(40, gl.genreById('sweet-pet'));
  assert.equal(light.some((v) => v.id === 'hidden'), false, '甜宠不该硬塞隐藏反派');
});
t('结构库：钩子连续 3 集不重样，末集不设钩子', () => {
  for (const gid of ['urban-rebirth-revenge', 'retro-70s-pet', 'suspense-twist']) {
    const plan = ss.hookPlan(40, gl.genreById(gid));
    assert.equal(plan.length, 40);
    assert.equal(plan[plan.length - 1].hook, null, '最后一集不设钩子，给圆满收束');
    for (let i = 2; i < plan.length; i += 1) {
      const same = plan[i].hook && plan[i].hook === plan[i - 1].hook && plan[i].hook === plan[i - 2].hook;
      assert.ok(!same, `${gid} 第 ${plan[i].ep} 集连续三集用了同一类钩子`);
    }
    assert.ok(plan.filter((p) => p.paywall).length >= 3, '卡点集要标出来');
  }
});
t('结构库：结构块给得出节奏 + 卡点 + 钩子三段', () => {
  const block = ss.structureBlock(40, gl.genreById('urban-rebirth-revenge'));
  assert.ok(block.includes('起势段') && block.includes('决战段'), '要有节奏分段');
  assert.ok(block.includes('付费卡点'), '要有卡点规划');
  assert.ok(block.includes('集尾钩子') && block.includes('连续 3 集不得用同一类钩子'), '要有钩子配额与禁令');
  assert.ok(ss.episodeStructure(10, 40, gl.genreById('urban-rebirth-revenge')).includes('付费卡点'), '卡点集要给套路');
});

/* ---- 三段式生成（mock 全链路，不花钱） ---- */
tAsync('生成链路：story → outline → episode → assemble 全过门', async () => {
  const story = await generateStory({ concept: '都市重生复仇：女主被闺蜜与未婚夫夺走公司，重生回到酒会当晚', episodes: 10 });
  assert.ok(story.characters.length >= 5, '人物表至少 5 个角色');
  assert.ok(/女主/.test(story.characters[0].role));

  const outline = await generateOutline({ story, from: 1, to: 10 });
  assert.equal(outline.episodes.length, 10);
  assert.equal(outlineGates(outline).filter((g) => !g.ok).length, 0, '分集大纲应 14 门全过');
  assert.ok(outline.beats.some((b) => b.weight === 'major' && b.episode < 10), '要有早期 major 爽点');
  // 结构要落进契约：钩子类型 / 是否卡点 / 属于哪一段，都由代码排定
  for (const e of outline.episodes) {
    assert.ok(e.hookType, `第 ${e.ep} 集缺 hookType`);
    assert.ok(e.stage, `第 ${e.ep} 集缺 stage`);
    assert.equal(typeof e.paywall, 'boolean', `第 ${e.ep} 集缺 paywall 标记`);
  }
  assert.ok(outline.episodes.some((e) => e.paywall), '10 集里应至少有一个付费卡点');

  const ep1 = await generateEpisode({ story, outline, ep: 1 });
  assert.equal(ep1.passed, true, `第 1 集应 10 门全过：${ep1.gates.filter((g) => !g.ok).map((g) => g.id).join(',')}`);
  assert.ok(ep1.text.includes('场1\u20111'), '场号连字符应是 U+2011');
  assert.ok(ep1.text.includes('【钩子字幕】') && ep1.text.includes('【黑屏】第1集完'), '结尾卡点二件套齐全');

  const full = await assemble({ story, outline, texts: [ep1.text] });
  assert.equal(full.passed, true, `整稿应全部门过：${full.gates.filter((g) => !g.ok).map((g) => `${g.scope}:${g.id}`).join(',')}`);
  assert.equal(full.script.episodes.length, 1);
  assert.ok(full.text.includes('## 【人物小传】'), '整稿应带前置区');
});

tAsync('生成链路：题材进 story，genreMeta 带变体与指纹', async () => {
  const story = await generateStory({
    concept: '年代文：女主穿成七十年代家里最不受待见的女儿', genreId: 'retro-70s-pet', episodes: 10, variantSeed: 5,
  });
  assert.equal(story.genre, '七零团宠', '题材名要按选择走，不许被模型改');
  assert.equal(story.genreMeta.id, 'retro-70s-pet');
  assert.ok(Object.keys(story.genreMeta.variant).length >= 1, '要带本次变体');
  assert.ok(story.genreMeta.fingerprint.startsWith('retro-70s-pet#'), '指纹要能区分同题材不同组合');
});

tAsync('生成链路：剧名撞了会重写一稿，两稿都撞才报错', async () => {
  const concept = '都市重生复仇：女主被闺蜜与未婚夫夺走公司，重生回到酒会当晚';
  const first = await generateStory({ concept, episodes: 10 });
  // 样本引擎按 concept 定种子，同一 concept 的剧名必然相同 → 两稿都撞，应该报错而不是硬返回
  await assert.rejects(
    generateStory({ concept, episodes: 10, avoid: [`《${first.title}》`] }),
    /撞/,
    '撞名两稿后必须报错，不能悄悄返回同题剧本',
  );
});

/* ---- 前端模块静态检查：用了 core 的导出就必须 import 进来 ---- */
// 防的是「save is not defined」这类只在点按钮时才炸的运行时崩：ES 模块里漏一个名字不报语法错，
// 走上线才在浏览器控制台炸红条，后端调用已经花掉了钱、结果却进不了 state。静态扫一遍最便宜。
t('前端模块：用到 core 的导出必须已 import', () => {
  const root = resolve(here, '..');
  const core = readFileSync(join(root, 'public', 'core.js'), 'utf8');
  const exported = new Set();
  const tail = core.match(/export\s*\{([\s\S]*?)\}\s*;?\s*$/m);
  if (tail) for (const n of tail[1].split(',')) { const t2 = n.trim().split(/\s+as\s+/).pop(); if (t2) exported.add(t2); }
  for (const m of core.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
  const vdir = join(root, 'public', 'views');
  const files = [join(root, 'public', 'app.js'), ...readdirSync(vdir).filter((f) => f.endsWith('.js')).map((f) => join(vdir, f))];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const imp = src.match(/import\s*\{([\s\S]*?)\}\s*from\s*'\.\.?\/core\.js'/);
    const imported = new Set(imp ? imp[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()) : []);
    const defined = new Set([...src.matchAll(/(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    for (const name of exported) {
      if (imported.has(name) || defined.has(name)) continue;
      if (new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}\\s*\\(`).test(src)) bad.push(`${f.split(/[\\/]/).pop()}: ${name}()`);
    }
  }
  assert.deepEqual(bad, [], `这些地方调用了 core 的函数却没导入：${bad.join(' / ')}`);
});

/* ---- 爆款榜单：全站只有「真实剧目榜」一个数据源 ---- */
// 2026-10-19：真实热榜（UApiPro）与红狐短剧榜整条链路已下线，用户明确说「后面这两个榜也不要」。
// 这里钉住几件事，防止哪天又被加回来或者留一半死代码：
//   ① 前端只剩 curated 一条路，没有模式切换标签；
//   ② 后端相关路由、服务、配置、Key 存储都已不存在；
//   ③ 首页首屏仍然内嵌剧目榜（那次 localStorage 盖掉默认值的坑不能白踩）。
t('爆款榜单：只剩真实剧目榜一个数据源', () => {
  const root = resolve(here, '..');
  const read = (p) => readFileSync(join(root, p), 'utf8');
  const intel = read('public/views/intel.js');
  const app = read('public/app.js');
  const core = read('public/core.js');
  const api = read('public/api.js');
  const system = read('public/views/system.js');
  const routes = read('src/routes/api.js');
  const cfg = read('src/config.js');
  const settingsRepo = read('src/repo/settingsRepo.js');
  const smoke = read('scripts/smoke.mjs');
  // 前端：没有模式切换标签，也没有第二/第三个数据源的渲染分支
  assert.ok(!/data-hotmode/.test(intel), 'intel.js 不该再有数据源切换标签');
  assert.ok(!/\[data-hotmode\]/.test(app), 'app.js 不该再处理模式切换');
  assert.ok(!/'redfox'|'real'/.test(intel), 'intel.js 不该再出现 real / redfox 两个模式');
  assert.ok(!/\bapi\.(board|boards|redfoxBoard)\(/.test(intel), 'intel.js 还在调已下线的榜单接口');
  assert.ok(!/redfox|rfKey|saveredfox/.test(system), '引擎页还留着红狐 Key 卡片');
  assert.ok(!/redfoxBoard|boards:|board:/.test(api), 'public/api.js 还挂着已下线的榜单接口');
  // cfg / data 的默认值里不能有已下线的键（注释与一次性迁移白名单除外，故只抠这两块字面量）
  const cfgBlock = core.match(/cfg:\s*\{[\s\S]*?\n  \},/)?.[0] ?? '';
  const dataBlock = core.match(/data:\s*\{[\s\S]*?\n  \},/)?.[0] ?? '';
  assert.ok(cfgBlock && !/hotMode|hotPlatform|hotKeyword/.test(cfgBlock), 'core.js 的 cfg 默认值里还留着已下线的榜单模式键');
  assert.ok(dataBlock && !/hotboard|redfox/.test(dataBlock), 'core.js 的 state.data 里还留着已下线的榜单元数据');
  // 后端：路由、服务文件、配置项、Key 存储一并消失
  assert.ok(!/api\/boards|api\/board\?|api\/redfox-board/.test(routes), '后端还挂着已下线的榜单路由');
  assert.ok(!/hotBoardService|redfoxBoardService|redfoxKeySummary|saveRedfox|getRedfox/.test(routes), '后端还引用已删除的红狐相关代码');
  assert.ok(!/analyzeBoard/.test(routes), '后端还在调 analyzeBoard');
  assert.ok(!/redfox|REDFOX/.test(cfg), 'config.js 还留着红狐/热榜端点配置');
  assert.ok(!/Redfox|redfox/.test(settingsRepo), 'settingsRepo 还留着红狐 Key 存储');
  assert.ok(!/hotBoardService|redfoxBoardService/.test(read('src/services/analyzeService.js')), 'analyzeService 还引用已删除的服务');
  assert.ok(!existsSync(join(root, 'src', 'services', 'hotBoardService.js')), 'hotBoardService.js 没删干净');
  assert.ok(!existsSync(join(root, 'src', 'services', 'redfoxBoardService.js')), 'redfoxBoardService.js 没删干净');
  // 冒烟脚本不该再去打已经下线的接口
  assert.ok(!/api\/boards|api\/board\?|api\/redfox-board/.test(smoke), '冒烟还在打已下线的榜单接口');
  // 首页必须把剧目榜嵌进首屏，且复用 intel 的同一个视图函数
  const home = read('public/views/system.js');
  assert.ok(/viewHot\(\{ withHead: false \}\)/.test(home), '首页没有内嵌爆款榜单');
});

/* ---- 载入剧本：JSON 直读与统计 ---- */
const { parseScriptJson, statsOf } = await import('../public/parseScriptText.js');

const JSON_SCRIPT = {
  episodes: [{
    ep: 1,
    scenes: [{ sceneId: 'S01', name: '渡口·码头', lighting: '夜景', characters: ['C01'], props: [], flow: [{ action: '阿莲推门进来。' }, { speaker: 'C01', line: '这箱子上了船。', delivery: '阿莲' }] }],
  }],
};

t('载入：JSON 剧本能直接读结构并算出统计', () => {
  const r = parseScriptJson(JSON.stringify({ script: JSON_SCRIPT, outline: { characters: [{ id: 'C01', name: '阿莲' }] } }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.stats.episodes, 1);
  assert.equal(r.stats.scenes, 1);
  assert.equal(r.stats.lines, 1);
  assert.equal(r.stats.actions, 1);
  assert.equal(r.stats.characters, 1);
});

t('载入：裸 episodes 也认，但缺 episodes 要说清缺什么', () => {
  assert.equal(parseScriptJson(JSON.stringify(JSON_SCRIPT)).ok, true);
  const bad = parseScriptJson('{"foo":1}');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /episodes/);
  const empty = parseScriptJson('{"episodes":[]}');
  assert.equal(empty.ok, false);
  assert.match(empty.message, /空的/);
  const broken = parseScriptJson('{"episodes":[{"ep":1}]}');
  assert.equal(broken.ok, false);
  assert.match(broken.message, /scenes/);
});

t('载入：坏 JSON 报解析位置，不冒充格式错误', () => {
  const r = parseScriptJson('{oops');
  assert.equal(r.ok, false);
  assert.match(r.message, /JSON 解析失败/);
});

t('载入：文本统计与解析结果对得上', () => {
  const p = parseScriptText('## 第1集\n场1-1 夜 内 渡口·码头\n人物：阿莲\n△阿莲推门进来。\n阿莲：这箱子上了船。\n【钩子字幕】箱子里有东西。\n【黑屏】第1集完');
  const st = statsOf(p.script);
  assert.equal(st.episodes, p.stats.episodes, '集数要一致');
  assert.equal(st.scenes, p.stats.scenes, '场数要一致');
  assert.equal(st.lines, p.stats.lines, '台词数要一致');
});

/* ---- 评估 / 优化：大模型层（mock 下跑，零费用） ---- */
const { evaluateWithLLM, normalizeJudge } = await import('../src/services/evaluateService.js');
const { optimizeWithLLM, graftEpisode } = await import('../src/services/optimizeService.js');
const { episodeText } = await import('../src/assets/scriptRender.js');

const SAMPLE = `## 第1集
场1-1 夜 内 渡口·码头
人物：阿莲、船客
△阿莲推门进来，手里拎着一只旧木箱。
阿莲：这箱子上了船，就下不去了。
△船客低头，手指敲着桌面。
船客：谁的箱子，谁心里清楚。
【钩子字幕】箱子里有东西。
【黑屏】第1集完

## 第2集
场2-1 日 内 渡口·账房
人物：阿莲、账房先生
△账房先生翻开账本。
阿莲：这笔账，从三年前就错了。
【钩子字幕】账本上少了一页。
【黑屏】第2集完`;

const sample = parseScriptText(SAMPLE);

t('渲染：结构 → 标准稿 → 结构，往返不丢集与场', () => {
  const text = episodeText(sample.script.episodes[0], sample.outline);
  assert.ok(text.startsWith('## 第1集'), '要从集标题开始');
  assert.ok(text.includes('【黑屏】第1集完'), '要有收尾');
  const back = parseScriptText(text);
  assert.equal(back.ok, true, `回环解析失败：${back.message ?? ''}`);
  assert.equal(back.script.episodes.length, 1);
  assert.equal(back.script.episodes[0].scenes.length, sample.script.episodes[0].scenes.length, '场数要一致');
});

t('合并：群演桶不会把两个人的台词算给同一个人', () => {
  const reply = `## 第1集
场1-1 夜 内 渡口·码头
人物：阿莲、账房先生

△阿莲把木箱掀开一条缝。
阿莲：这箱子，谁也别碰。
△账房先生后退半步。
账房先生：你把它打开了。

【钩子字幕】箱底压着一张旧照片。
【黑屏】第1集完`;
  const parsed = parseScriptText(reply);
  const book = {
    characters: sample.outline.characters.map((c) => ({ id: c.id, name: c.name, role: c.role ?? '' })),
    scenes: sample.outline.scenes.map((x) => ({ id: x.id, name: x.name })),
    episodes: [],
  };
  const ep = graftEpisode(parsed, book, 1, sample.script.episodes[0], {});
  assert.ok(ep, '要能合并出一集');
  const lines = ep.scenes.flatMap((x) => x.flow).filter((b) => b.line);
  const speakers = lines.map((b) => b.speaker);
  assert.equal(new Set(speakers).size, 2, `两个人的台词被并成了一个人：${speakers.join(',')}`);
  assert.ok(lines.every((b) => b.line.length <= 22), '台词长度要守住');
});

t('评审：越界与缺字段被夹回合法区间', () => {
  const base = { dimensions: { script: 80, outline: 70, structure: 60 } };
  const j = normalizeJudge(
    { score: 140, verdict: '神作', dimensions: { hook: -20, character: 'abc', dialogue: 88 }, strengths: 'not-array', risks: [1, '', '会掉人'], fixes: [{ what: '改第3集', why: '节奏' }, '加一场对峙'] },
    base,
  );
  assert.ok(j.score <= 100 && j.score >= 0, `分数没夹住：${j.score}`);
  assert.ok(['优秀', '良好', '及格', '不合格'].includes(j.verdict), `判决不在枚举里：${j.verdict}`);
  assert.equal(j.dimensions.hook, 0, '负数要压回 0');
  assert.ok(j.dimensions.character > 0, '非数字要用门分兜底');
  assert.equal(j.dimensions.dialogue, 88);
  assert.deepEqual(j.risks, ['会掉人'], '数组里非字符串要剔除');
  assert.equal(j.fixes.length, 2, '字符串形式的改法也要收下');
});

t('评审：不是对象就判无效，交给上层降级', () => {
  assert.throws(() => normalizeJudge(null, { dimensions: {} }), /不是 JSON 对象/);
  assert.throws(() => normalizeJudge({ summary: '没有任何分数' }, { dimensions: {} }), /可用分数/);
});

tAsync('评估：门分与模型分按 6:4 加权，响应带 llm 元信息', async () => {
  const base = evaluate(sample.script, sample.outline);
  const r = await evaluateWithLLM(sample.script, sample.outline);
  assert.ok(r.judge, `mock 下应当有评审：${r.judgeError ?? ''}`);
  assert.equal(r.llm.mode, 'mock');
  assert.equal(r.gates.length, r.total, '门明细要齐');
  assert.equal(r.score, Math.round(base.score * 0.6 + r.judge.score * 0.4), '总分必须是门 6 + 模型 4');
  assert.ok(r.judge.dimensions.hook > 0);
});

tAsync('优化：结构与旧版一致（before/after/script/advice/llm）', async () => {
  const r = await optimizeWithLLM({ script: sample.script, outline: sample.outline, limit: 3 });
  assert.equal(r.mode, 'llm');
  assert.ok(typeof r.before.score === 'number' && typeof r.after.score === 'number');
  assert.ok(Array.isArray(r.script.episodes) && r.script.episodes.length === sample.script.episodes.length);
  assert.ok(Array.isArray(r.advice));
  assert.ok(Array.isArray(r.rewritten));
  assert.ok(r.llm && typeof r.llm.mode === 'string');
  assert.ok(r.note.length > 0, '样本引擎下要说明为什么没重写');
});

/* ---- 角色识别：别名 / 未命名 / 出场段落 ---- */
const { analyzeCast, castPromptBlock } = await import('../src/services/castService.js');

t('角色识别：统计出场集与台词数，别名进 aliases，护士标未命名', () => {
  const script = {
    episodes: [
      { ep: 1, scenes: [{ flow: [{ speaker: 'C01', line: '这船今晚不走。' }, { speaker: 'C09', line: '家属不能进。' }] }] },
      { ep: 2, scenes: [{ flow: [{ speaker: 'C01', line: '把账本拿来。' }] }] },
    ],
  };
  const outline = {
    characters: [
      { id: 'C01', name: '阿莲', role: '女主', desc: '又名：莲姐。码头长大的船家女' },
      { id: 'C09', name: '护士', role: '配角', desc: '医院的护士，只负责拦人' },
    ],
  };
  const cast = analyzeCast(script, outline);
  const a = cast.characters.find((c) => c.name === '阿莲');
  const n = cast.characters.find((c) => c.name === '护士');
  assert.deepEqual(a.episodes, [1, 2], '出场集要统计全');
  assert.equal(a.lines, 2, '台词数要统计');
  assert.deepEqual(a.aliases, ['莲姐'], '「又名：」要进 aliases');
  assert.equal(a.unnamed, false);
  assert.equal(n.unnamed, true, '护士属于未命名角色');
  assert.equal(n.lines, 1);
});

t('角色表写进提示词：带编号与三条边界规则', () => {
  const cast = analyzeCast(
    { episodes: [{ ep: 1, scenes: [{ flow: [{ speaker: 'C02', line: '站住。' }] }] }] },
    { characters: [{ id: 'C02', name: '贺铭瑄', role: '反派', desc: '又名：铭瑄。长子' }] },
  );
  const block = castPromptBlock(cast);
  const hero = cast.characters.find((c) => c.name === '贺铭瑄');
  assert.ok(block.includes(hero.id), '要带编号');
  assert.ok(block.includes('铭瑄'), '要带别名');
  assert.ok(block.includes('未命名'), '要有未命名处理规则');
  assert.ok(block.includes('只写编号'), '要说明引用方式');
});

/* ---- 分镜拆分：15 秒段 · 子镜头 · 门禁 · 降级 · 模型链路 ---- */
const { normalizeSegments, gateReport, deterministicSegments, buildAnchors } = await import('../src/engine/shots.mjs');
const { splitEpisode } = await import('../src/services/shotService.js');

const shotFixture = () => {
  const p = parseScriptText(SAMPLE);
  return { script: p.script, outline: p.outline, episode: p.script.episodes[0] };
};

t('分镜归一化：15 秒段 + 中文景别/运镜映射，缺提示词自动补时间轴', () => {
  const { outline, episode } = shotFixture();
  const segs = normalizeSegments(
    { segments: [{ sec: 15, sceneIndex: 1, shots: [
      { sec: 3, size: '特写', move: '缓慢推近 + 左摇', visual: '她推门进来', cast: ['C01'], motion: ['steps in'], lighting: '夜景' },
      { sec: 3, size: '中景', move: '固定', visual: '她抬头', cast: ['C01'], motion: ['head lifts'], lighting: '夜景' },
      { sec: 3, size: '远景', move: '拉远', visual: '码头全景', cast: [], motion: ['fog drifts'], lighting: '夜景' },
    ] }] },
    { ep: 1, episode, outline, anchors: buildAnchors(outline) },
  );
  assert.equal(segs.length, 1);
  const seg = segs[0];
  assert.equal(seg.id, 'E01-G01', '段号要按 集-G 生成');
  assert.equal(seg.shots[0].id, 'E01-G01-01', '子镜号要带段号');
  assert.equal(seg.shots[0].size, 'close-up', '「特写」要映射成 close-up');
  assert.equal(seg.shots[0].move, 'push-in', '叠运镜取第一个');
  assert.ok(seg.prompt.includes('[视频约束]'), '缺提示词要按摄制单结构补');
  assert.ok(seg.prompt.includes('站位设定'), '要有站位设定');
  assert.ok(seg.prompt.includes('镜头 1'), '要有逐镜条目');
});

t('分镜门禁：段时长/子镜合计/丢台词/写人名都会被拦', () => {
  const { outline, episode } = shotFixture();
  const mkShot = (i, line = '', sec = 3) => ({
    id: `E01-G01-0${i}`, sec, size: 'medium', move: 'static', visual: '她推门进来看着他', cast: ['C01'], line,
    motion: ['hand moves'], lighting: '顶光偏冷',
  });
  const mkSeg = (shots, sec = 15) => ({
    id: 'E01-G01', index: 1, sceneIndex: 1, sec, beat: '冲突', env: '码头', lighting: '顶光偏冷',
    cast: ['C01'], shots, refs: { C: ['C01'], S: ['S01'], P: [] },
    prompt: [
      '[视频约束]', '1. 禁止字幕', '2. 禁止BGM', '3. 画质：4K 超高清，画面稳定无闪烁',
      `## 第1段・站位设定（镜头 1-${shots.length} 共用锚点）`,
      ...shots.map((_, i) => `## 第1段・镜头 ${i + 1} 【中景・固定机位】`),
      ...shots.map(() => '**防穿帮**：测试'),
    ].join('\n'),
  });
  const all = [mkShot(1, '这箱子上了船，就下不去了。'), mkShot(2, '谁的箱子，谁心里清楚。'), mkShot(3), mkShot(4), mkShot(5)];
  const ok = gateReport([mkSeg(all)], { episode, outline });
  assert.ok(ok.every((g) => g.ok), `合规的一段不该挂：${ok.filter((g) => !g.ok).map((g) => g.id)}`);

  const short = gateReport([mkSeg(all, 9)], { episode, outline }).find((g) => g.id === 'seg-sec');
  assert.equal(short.ok, false, '段长 9 秒必须挂 seg-sec');

  const missLine = gateReport([mkSeg([mkShot(1, '这箱子上了船，就下不去了。'), mkShot(2), mkShot(3), mkShot(4), mkShot(5)])], { episode, outline })
    .find((g) => g.id === 'line-once');
  assert.equal(missLine.ok, false, '少一句台词必须挂');

  const named = mkSeg(all);
  named.shots[0].visual = '阿莲推门进来看着他';
  assert.equal(gateReport([named], { episode, outline }).find((g) => g.id === 'no-name').ok, false, '画面写人名必须挂');
});

t('规则切段：台词一句不丢，每段 15 秒上下，提示词带时间轴', () => {
  const { script, outline } = shotFixture();
  const segs = deterministicSegments(script.episodes[0], outline, { ep: 1 });
  assert.ok(segs.length >= 1, '至少要有一段');
  const want = new Set(script.episodes[0].scenes.flatMap((sc) => (sc.flow ?? []).filter((b) => b.line).map((b) => b.line.trim())));
  const got = segs.flatMap((s) => s.shots ?? []).filter((x) => x.line).map((x) => x.line);
  assert.ok([...want].every((l) => got.includes(l)), '每句台词都要在子镜头里');
  assert.ok(segs.every((s) => s.sec >= 8 && s.sec <= 17), `段长异常：${segs.map((s) => s.sec)}`);
  assert.ok(segs.every((s) => (s.shots ?? []).length >= 1), '每段至少 1 个子镜头');
  assert.ok(segs.every((s) => s.prompt.includes('[视频约束]') && s.prompt.includes('防穿帮')), '段提示词要是摄制单结构');
});

tAsync('分镜拆分：mock 下一次调用出 15 秒段，全门通过', async () => {
  const { script, outline } = shotFixture();
  const r = await splitEpisode({ script, outline, ep: 1, aspect: '9:16' });
  assert.ok(r.segments.length >= 1, `没拆出段：${r.error}`);
  assert.equal(r.degraded, false, `不该走降级：${r.error}`);
  assert.equal(r.passed, true, `有门未过：${r.gates.filter((g) => !g.ok).map((g) => g.id)}`);
  assert.ok(r.segments.every((s) => s.shots.length >= 3 && s.shots.length <= 6), '每段 3–6 个子镜头');
  assert.ok(r.segments.every((s) => s.prompt.length > 60), '每段都要有提示词');
  assert.ok(r.shots.length >= r.segments.length * 3, '平铺镜头要与段对应');
  assert.equal(r.llm.mode, 'mock');
});

/* ---- 爆款剧目榜（真实数据，assets/hotDramas.js 集中维护） ---- */
t('剧目榜：10 条、排名 1-10 连续、必填字段齐全', () => {
  assert.equal(HOT_DRAMAS.length, 10, `应为 10 条，实际 ${HOT_DRAMAS.length}`);
  assert.deepEqual(HOT_DRAMAS.map((d) => d.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '排名必须 1..10 连续');
  for (const d of HOT_DRAMAS) {
    assert.ok(d.title && d.platform && d.pitch && (d.tags ?? []).length, `第 ${d.rank} 名缺必填字段`);
    assert.ok(/^https:\/\//.test(d.url), `${d.title} 链接必须是 https：${d.url}`);
    assert.ok(!d.cover || /^https:\/\//.test(d.cover), `${d.title} 海报地址非法`);
    assert.ok(d.heat > 0 && d.heatText, `${d.title} 热度缺失`);
  }
});

t('剧目榜元信息：来源、榜单日期、更新日期、待补说明都在', () => {
  assert.ok(HOT_BOARD_META.updatedAt, '缺 updatedAt');
  assert.ok(HOT_BOARD_META.dataDate, '缺 dataDate');
  assert.ok(HOT_BOARD_META.sources.length >= 2, '至少要两个可交叉核对的来源');
  assert.ok(HOT_BOARD_META.sources.every((s) => /^https:\/\//.test(s.url)), '来源链接必须是 https');
  assert.ok(HOT_BOARD_META.todos.length, '缺待补字段说明');
});

t('剧目榜：每条都有可点击链接与海报，非官方来源要在注释里说清', () => {
  assert.ok(HOT_DRAMAS.every((d) => d.cover), '每条都要有海报（拿不到官方图时才允许留空）');
  assert.ok(HOT_DRAMAS.every((d) => /^https:\/\//.test(d.cover)), '海报地址必须是 https');
  // 10 条官方 series_id 都已定位，任何一条退回购物/百科页都说明数据被改坏了
  const nonOfficial = HOT_DRAMAS.filter((d) => !/hongguoduanju\.com\/player\/\d+/.test(d.url));
  assert.equal(nonOfficial.length, 0, `不应再有资讯页兜底，实际 ${nonOfficial.length} 条：${nonOfficial.map((d) => d.title)}`);
  // 海报同理：全部走红果官方 CDN，别再拿第三方剧照顶（防盗链/失效都不可控）
  const badCover = HOT_DRAMAS.filter((d) => !/\.byteimg\.com\/novel-pic\//.test(d.cover));
  assert.equal(badCover.length, 0, `海报必须来自官方 CDN，实际 ${badCover.length} 条不是：${badCover.map((d) => d.title)}`);
  // 官方播放页的 series_id 必须是纯数字，不能是编的
  for (const d of HOT_DRAMAS) {
    const m = d.url.match(/\/player\/(\d+)/);
    if (m) assert.ok(/^\d{15,20}$/.test(m[1]), `${d.title} 的 series_id 不是合法数字：${m[1]}`);
  }
});

t('剧目榜：集数来自官方详情页，10 条都要有值', () => {
  assert.ok(HOT_DRAMAS.every((d) => Number.isInteger(d.episodes) && d.episodes > 0),
    `集数必须是正整数：${HOT_DRAMAS.map((d) => d.episodes)}`);
  assert.ok(HOT_DRAMAS.every((d) => d.pitchSource === 'source'), '推荐语必须都有出处，不许凭标题编');
});

t('抓取层：真实剧目榜带来源链接与站内搜索，题材筛选保持原排名', () => {
  const all = pickDramas({ limit: 10 });
  assert.equal(all.length, 10);
  assert.ok(all.every((x) => x.url && x.playUrl), '每条都要有来源链接与站内搜索入口');
  assert.ok(all.every((x) => x.cover), '每条都要带海报');
  const xh = pickDramas({ limit: 10, genre: '玄幻' });
  assert.ok(xh.length === 2 && xh.every((x) => x.tags.includes('玄幻')), `玄幻筛选不对：${xh.map((x) => x.title)}`);
  assert.deepEqual(xh.map((x) => x.rank), [3, 10], '筛选后必须保留榜单原排名，不能重排');
});

t('剧目榜分析：钩子按同一套词表扫描，集数参与平均', () => {
  const a = analyzeHot({ items: pickDramas({ limit: 10 }) });
  assert.ok(a.hooks.length > 0, '真实剧目应能扫出钩子词');
  assert.ok(a.averages.episodes > 0, `集数已核实，平均集数应大于 0，实际 ${a.averages.episodes}`);
  assert.ok(a.genres.length > 0 && a.platforms.length > 0, '题材/平台分布要统计出来');
});

/* ---- 引擎冒烟脚本自身的回归（原先 enginecheck / diag-gate 不在任何测试覆盖内，
 *      路径写坏了长期没人发现：一个去读项目外的 repos/，一个没解 URL 编码。
 *      这里既验夹具自包含，也真把两个脚本各起一个子进程跑通。---- */
t('enginecheck 夹具自包含：14 道大纲门 + 10 道剧本门全过', () => {
  const o = fixture('渡口-outline.json');
  const s = fixture('渡口-script.json');
  const g1 = outlineGates(o);
  const g2 = scriptGates(s, { outline: o });
  assert.ok(g1.length === 14, `大纲门数应为 14，实际 ${g1.length}`);
  assert.ok(g2.length === 10, `剧本门数应为 10，实际 ${g2.length}`);
  assert.deepEqual(g1.filter((g) => !g.ok).map((g) => g.id), [], '大纲门应全过');
  assert.deepEqual(g2.filter((g) => !g.ok).map((g) => g.id), [], '剧本门应全过');
});

t('夹具只从 scripts/fixtures 读，不依赖项目外目录', () => {
  // 打包带走后 repos/ 不存在——夹具必须全在这个目录里
  const names = readdirSync(resolve(here, 'fixtures'));
  for (const n of ['渡口-outline.json', '渡口-script.json']) {
    assert.ok(names.includes(n), `fixtures 里缺 ${n}，自测将不再自包含`);
  }
});

tAsync('enginecheck.mjs 作为独立进程可跑通', async () => {
  const out = execFileSync(process.execPath, [join(here, 'enginecheck.mjs')], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(out, /outline 门数: 14 通过: 14/, '大纲门应 14/14');
  assert.match(out, /script {2}门数: 10 通过: 10/, '剧本门应 10/10');
});

tAsync('diag-gate.mjs 作为独立进程可跑通（中文路径不炸）', async () => {
  // 该脚本按自身 URL 定位 ../data/：早先用 URL.pathname 拿到百分号编码串，
  // 中文目录下必然 ENOENT。这里只要求「不抛异常、正常退出」。
  const out = execFileSync(process.execPath, [join(here, 'diag-gate.mjs')], {
    encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ok(typeof out === 'string', 'diag-gate 应正常返回');
  assert.ok(!/ENOENT/.test(out), 'diag-gate 不应报 ENOENT（路径解析问题）');
});

/* ---- 报错定位不能打出「第 undefined 集」---- */
t('集号缺失时按 index / 位置兜底，绝不输出 undefined', () => {
  // 用 duration 门来验：它必然用 label 拼「第 N 集欠 X 秒」。
  // 场景刻意写短（估 0s vs 目标 120s），确保这道门一定不过、一定产出文案。
  const mk = (extra) => ({
    episodes: [{
      targetSeconds: 120, hook: '钩子', cliff: '悬念', hookBeat: [1, 1],
      scenes: [{
        sceneId: 'S01', lighting: '夜景', props: [],
        beats: [{ action: '他推门进来。' }],
        lines: [{ speaker: '林晚', text: '这箱子上了船。' }],
      }],
      ...extra,
    }],
  });
  // 注意用 scriptGates（剧本引擎），不要用上面从 shots.mjs 解构的同名 gateReport
  const detailOf = (doc) => scriptGates(doc).filter((g) => g.id === 'duration').map((g) => g.detail).join('');

  // 只有 index（前端解析器的自然产物）→ 用 index
  const withIndex = detailOf(mk({ index: 7 }));
  assert.match(withIndex, /第 7 集/, `应用 index 定位，实际：${withIndex || '(无 duration 文案)'}`);
  // 两个字段都没有 → 用位置（第 1 集）
  const bare = detailOf(mk({}));
  assert.match(bare, /第 1 集/, `应退到位置 1，实际：${bare || '(无 duration 文案)'}`);
  // 正常 ep → 用 ep
  const withEp = detailOf(mk({ ep: 3 }));
  assert.match(withEp, /第 3 集/, `应用 ep 定位，实际：${withEp || '(无 duration 文案)'}`);
  // 三种情况都不许出现 undefined
  assert.ok(!/undefined/.test(withIndex + bare + withEp), '报错文案里不应出现 undefined');
});


/* ---- 去 AI 味扫描器（移植自绘梦 deai_scan.py，13 维实测）---- */
// 这些用例锁的是「确定性」：同一段文本任何时候都要是同一个分，
// 否则它就不配当门禁，只能当参考。
const DIRTY = '他心中一紧，不禁后退半步。仿佛有什么东西在黑暗里蠕动，空气中弥漫着一种说不清的气息。'
  + '他深吸一口气，屏住呼吸。与此同时，他意识到，这一刻终究还是来了。一切都变了。他知道，从此以后再也回不去了。';
const CLEAN = '他把碗放到桌上，放得很轻。水汽往上走，糊住了窗子一角。'
  + '楼下有人在敲铁皮，一下，两下，停了。他数到第七下的时候，门外传来脚步声。';
const SCRIPT_SAMPLE = '场1-1 日 内 出租屋\n△阿May把碗摞起来，最上面那只晃了一下。\n阿May：你今天不走了？\n老周：走不了。\n阿May：那房租呢。';

t('去 AI 味：词表没有被删空', () => {
  const s = bankStats();
  assert.ok(s.groups >= 7, `套话分组应 ≥7，实际 ${s.groups}`);
  assert.ok(s.words >= 150, `词表应 ≥150 条，实际 ${s.words}`);
});

t('去 AI 味：空文本返回明确错误而不是 0 分', () => {
  const r = deaiAnalyze('   ');
  assert.equal(r.ok, false);
  assert.match(r.error, /没有可扫描/);
});

t('去 AI 味：同一段文本两次扫描同分（可当门禁用）', () => {
  const a = deaiAnalyze(DIRTY);
  const b = deaiAnalyze(DIRTY);
  assert.equal(a.score, b.score);
  assert.equal(a.clicheTotal, b.clicheTotal);
});

t('去 AI 味：套话文本分数明显高于干净文本', () => {
  const bad = deaiAnalyze(DIRTY).score;
  const good = deaiAnalyze(CLEAN).score;
  assert.ok(bad > good + 20, `脏文本 ${bad} 应明显高于干净文本 ${good}`);
});

t('去 AI 味：分数恒在 0–100，13 个维度齐全', () => {
  const r = deaiAnalyze(DIRTY);
  assert.ok(r.score >= 0 && r.score <= 100, `分数越界：${r.score}`);
  assert.equal(r.dimensions.length, 13);
  assert.ok(r.dimensions.every((d) => d.penalty >= 0 && d.penalty <= 1), '惩罚值应在 0–1');
});

t('去 AI 味：短样本给出「仅供参考」而不是硬判', () => {
  const r = deaiAnalyze('他走了。');
  assert.ok(r.advisory.some((a) => /不足 300 字|仅供参考/.test(a)), '短样本应给提示');
  const g = deaiGate(r, { maxScore: 20 })[0];
  assert.equal(g.ok, true, '样本太短时不应判死');
  assert.equal(g.soft, true);
});

t('去 AI 味：剧本「角色：台词」被识别为对话', () => {
  const r = deaiAnalyze(SCRIPT_SAMPLE);
  assert.ok(r.basic.dialogRatio > 0, `剧本对话占比应 > 0，实际 ${r.basic.dialogRatio}`);
  // 三句台词一共 13 个汉字，这里锁的是「有没有被认成对话」，不是字数阈值
  assert.ok(r.basic.dialogChars >= 10, `对话字数应 ≥10，实际 ${r.basic.dialogChars}`);
});

t('去 AI 味：只扫正文，不吃修改记录', () => {
  const raw = '# 第1章\n\n### 一、修改后全文\n' + CLEAN + '\n\n### 二、修改记录\n| 原句 | 改句 |\n|---|---|\n| 不禁 | 删 |';
  const got = extractBody(raw);
  assert.equal(got.extracted, true);
  assert.ok(got.text.includes('他把碗放到桌上'), '应抽到正文');
  assert.ok(!got.text.includes('修改记录'), '不应包含修改记录');
  assert.ok(!got.text.includes('不禁'), '不应把修改记录里的套话算进正文');
});

t('去 AI 味：门禁结构与其它引擎同形', () => {
  const r = deaiAnalyze(DIRTY);
  const [g] = deaiGate(r, { maxScore: 40 });
  assert.equal(g.id, 'deai');
  assert.equal(typeof g.label, 'string');
  assert.equal(typeof g.ok, 'boolean');
  assert.match(g.detail, /AI 痕迹分/);
});


/* ---- 小说引擎门禁（设定门 8 道 + 单章门 6 道）---- */
// 这些用例锁的是「门到底在数什么」：章数够不够装字数、伏笔有没有回收、
// 章末有没有钩子、对话够不够、AI 痕迹过不过线。门判错了比没有门更糟。
function goodBook() {
  return {
    title: '渡口灯',
    logline: '所有人都说那场船难是意外，只有他记得江上一盏没熄的灯。',
    targetWords: 60000,
    wordsPerChapter: 3000,
    bible: {
      promise: { sellingPoint: '一盏没熄的灯', theme: '为真相付多少', ending: '他拿回了证词，代价是自己的名字' },
      characters: [
        { name: '沈砚', role: '主角', want: '查清船难', flaw: '不信任何人', voice: '句子短', arc: '学会下注' },
        { name: '江照', role: '女主', want: '拿回码头', flaw: '怕水', voice: '爱反问', arc: '' },
        { name: '陈九', role: '反派', want: '让所有人闭嘴', flaw: '占上风就收不住', voice: '下命令', arc: '' },
      ],
      world: [
        { rule: '退潮时石阶露出不该有的门', cost: '拿一个名字去换', bound: '名字给出就没人再提起' },
        { rule: '雾能盖住声音', cost: '身上留腥气', bound: '只在无风夜里起雾' },
        { rule: '船票认人', cost: '留下随身之物', bound: '一人一票' },
      ],
    },
    outline: {
      chapters: Array.from({ length: 20 }, (_, i) => ({
        index: i + 1, title: `第${i + 1}章`, goal: '拿到票', conflict: '守夜人挡着', turn: '证人是他舅舅', hook: '门外有人敲了三下。',
      })),
      foreshadow: [
        { id: 'F1', content: '那盏灯', plantAt: 1, payoffAt: 14, tier: 1 },
        { id: 'F2', content: '票根背面的字', plantAt: 2, payoffAt: 18, tier: 1 },
      ],
    },
    chapters: [],
  };
}

t('小说：完整设定集 8 道门全过', () => {
  const g = bookGates(goodBook());
  assert.equal(g.length, 8);
  const bad = g.filter((x) => !x.ok);
  assert.equal(bad.length, 0, `未过：${bad.map((x) => x.label).join('、')}`);
});

t('小说：没排章纲时，章纲/伏笔门要给出提示（自由写作下不拦）', () => {
  const b = goodBook();
  b.outline = null;
  const freedomGates = bookGates(b);
  for (const id of ['beats', 'foreshadow']) {
    assert.ok(freedomGates.find((g) => g.id === id && !g.ok), `应提示 ${id}`);
  }
  // 章数不再硬性要求：自由写作下「篇幅」只报参考
  assert.equal(freedomGates.find((g) => g.id === 'scale').ok, true, '自由写作下篇幅不应判错');
  assert.equal(freedomGates.find((g) => g.id === 'scale').severity, 'soft');
  // 关掉自由写作才回到「篇幅必须匹配」
  assert.equal(bookGates(b, { freedom: false }).find((g) => g.id === 'scale').ok, false);
});

t('小说：伏笔只埋不收要被拦下', () => {
  const b = goodBook();
  b.outline.foreshadow[0].payoffAt = 1; // 等于埋设章，等于没回收
  const g = bookGates(b).find((x) => x.id === 'foreshadow');
  assert.equal(g.ok, false);
  assert.match(g.detail, /没回收/);
});

t('小说：纪律模式下章数装不下目标字数才判错', () => {
  const b = goodBook();
  b.targetWords = 200000;   // 20 章 × 3000 只有 6 万，差得远
  const g = bookGates(b, { freedom: false }).find((x) => x.id === 'scale');
  assert.equal(g.ok, false);
  assert.match(g.detail, /够不到/);
});

t('小说：单章门齐全（1 道硬门 + 6 道建议），合格章全过', () => {
  // 单块 25 字（不计标点），重复 120 次 ≈ 3000 字，正好落在 95%–115% 区间
  const body = '他把票根摊开。\n\n「今晚开闸吗。」\n\n没开。守夜人摇头，电筒照在他脸上。\n\n'.repeat(120)
    + '门外有人敲了三下。';
  const chapter = { index: 1, text: body, words: wordCount(body), scan: { score: 30, grade: '良好' } };
  const g = chapterGates({ book: goodBook(), chapter, prev: null, maxScan: 55 });
  assert.equal(g.length, 7, '正文存在 + 篇幅 + 5 道建议');
  const hard = g.filter((x) => x.severity === 'hard').map((x) => x.id).sort();
  assert.deepEqual(hard, ['has-text', 'words'], '严格字数下硬门是「正文存在 + 本章字数」');
  const bad = g.filter((x) => !x.ok);
  assert.equal(bad.length, 0, `未过：${bad.map((x) => `${x.label}(${x.detail})`).join('、')}`);
});

t('小说：字数默认严格（95%–115%），loose 才只报数', () => {
  const body = '短。';
  const strict = chapterGates({ book: goodBook(), chapter: { text: body, scan: { score: 20 } }, prev: null });
  const gate = strict.find((x) => x.id === 'words');
  assert.equal(gate.ok, false, '默认严格，字数不够应判错');
  assert.equal(gate.severity, 'hard', '严格模式下字数是硬门');

  const loose = chapterGates({ book: goodBook(), chapter: { text: body, scan: { score: 20 } }, prev: null, wordPolicy: 'loose' });
  assert.equal(loose.find((x) => x.id === 'words').ok, true, 'loose 不判字数');
});

t('小说：字数超标（>115%）也要提示', () => {
  const long = '字'.repeat(4000);
  const g = chapterGates({ book: goodBook(), chapter: { text: long, scan: { score: 20 } }, prev: null }).find((x) => x.id === 'words');
  assert.equal(g.ok, false);
  assert.match(g.detail, /偏多/);
});

t('小说：长段收尾且无悬念信号 → 钩子门挂；短句收尾 → 过', () => {
  const longTail = `${'他把船票摊在掌心，看了很久，想起父亲最后一次出门时的样子，也想起那天江面上没有风。'.repeat(6)}`;
  const longGate = chapterGates({ book: goodBook(), chapter: { text: longTail, scan: { score: 20 } }, prev: null }).find((x) => x.id === 'hook');
  assert.equal(longGate.ok, false, '长段收尾不应算钩子');

  const shortTail = '他把票根摊开，又攥回去。\n\n日期是明天。';
  const shortGate = chapterGates({ book: goodBook(), chapter: { text: shortTail, scan: { score: 20 } }, prev: null }).find((x) => x.id === 'hook');
  assert.equal(shortGate.ok, true, `短句收尾应算钩子，实际：${shortGate.detail}`);
});

t('小说：末段自我总结要被拦下', () => {
  const text = '他走了很远。\n\n他终于明白了，这一切都是命。';
  const g = chapterGates({ book: goodBook(), chapter: { text, scan: { score: 20 } }, prev: null }).find((x) => x.id === 'no-summary');
  assert.equal(g.ok, false);
});

t('小说：相邻两章开头雷同要被拦下', () => {
  const text = '雾是从江面先起的。他往前走了一步。';
  const prev = { text: '雾是从江面先起的，比昨天更浓。' };
  const g = chapterGates({ book: goodBook(), chapter: { text, scan: { score: 20 } }, prev }).find((x) => x.id === 'repeat');
  assert.equal(g.ok, false);
});

t('小说：就绪度能算出进度与通过章数', () => {
  const b = goodBook();
  b.chapters = [
    { index: 1, text: 'x'.repeat(3000), words: 3000, gates: [{ ok: true }] },
    { index: 2, text: 'y'.repeat(3000), words: 3000, gates: [{ ok: false }] },
  ];
  const r = readiness(b);
  assert.equal(r.written, 2);
  assert.equal(r.planned, 20);
  assert.equal(r.progress, 10);
  assert.equal(r.clean, 1);
  assert.equal(r.bibleReady, true);
});


/* ---- 连续性记忆（移植自墨笔 memory.js，改为按人物表点名）---- */
const MEM_TEXT = '雾是从江面先起的。沈砚把票根摊在掌心，又攥了回去。\n\n'
  + '守夜人：「今晚不开闸。」\n\n沈砚问：「我父亲的票，是谁卖的。」\n\n'
  + '守夜人没答。电筒照在沈砚的脸上。\n\n原来那盏灯是沈砚的父亲点的。三天后码头要拆了。';

t('记忆：按人物表点名，不产生「在沈砚」这类碎片', () => {
  const cast = [{ name: '沈砚' }, { name: '守夜人' }, { name: '陈九' }];
  const m = analyzeChapter('灯', MEM_TEXT, { cast });
  assert.deepEqual(m.characters.sort(), ['守夜人', '沈砚'].sort(), `实际：${m.characters.join('、')}`);
  assert.ok(!m.characters.some((n) => /在|问$/.test(n)), `不应出现碎片：${m.characters.join('、')}`);
});

t('记忆：没给别人物表时不会返回动词结尾的垃圾名', () => {
  const m = analyzeChapter('灯', MEM_TEXT);
  assert.ok(m.characters.every((n) => !/[问说看走开]$/.test(n)), `垃圾名：${m.characters.join('、')}`);
});

t('记忆：要点 ≤3 条且都来自正文', () => {
  const m = analyzeChapter('灯', MEM_TEXT);
  assert.ok(m.points.length >= 1 && m.points.length <= 3);
  for (const p of m.points) assert.ok(MEM_TEXT.includes(p.replace(/…$/, '').slice(0, 10)), `要点不在正文里：${p}`);
});

t('记忆：伏笔句与时间线能被抽出来', () => {
  const m = analyzeChapter('灯', MEM_TEXT);
  assert.ok(m.foreshadow.some((f) => f.includes('原来')), '应抽到揭示句');
  assert.ok(m.timeline.some((t) => t.includes('三天后')), '应抽到时间线');
});

t('记忆：全书脉络按章汇总，人物去重', () => {
  const a = analyzeChapter('灯', MEM_TEXT, { cast: [{ name: '沈砚' }] });
  const b = analyzeChapter('票', MEM_TEXT, { cast: [{ name: '沈砚' }] });
  const bm = buildBookMemory([{ index: 1, title: '灯', memory: a }, { index: 2, title: '票', memory: b }]);
  assert.equal(bm.writtenChapters, 2);
  assert.equal(bm.arc.length, 2);
  assert.deepEqual(bm.characters, ['沈砚']);
});

t('记忆：提示词里带上脉络/人物/待回收伏笔，并标出本章该收的', () => {
  const m = analyzeChapter('灯', MEM_TEXT, { cast: [{ name: '沈砚' }] });
  const bm = buildBookMemory([{ index: 1, title: '灯', memory: m }]);
  const text = memoryToPrompt(bm, { memory: m }, {
    foreshadow: [
      { id: 'F1', content: '那盏没熄的灯', plantAt: 1, payoffAt: 3, status: 'planted' },
      { id: 'F2', content: '票根背面的字', plantAt: 2, payoffAt: 2, status: 'planted' },
    ],
    current: 2,
  });
  assert.match(text, /【前情脉络】/);
  assert.match(text, /【已出场人物】沈砚/);
  assert.match(text, /【尚未回收的伏笔】/);
  assert.match(text, /F2：.*本章应回收/, '到回收章的伏笔要标注');
  assert.match(text, /【上一章发生了什么】/);
});

t('记忆：伏笔状态机（埋 → 收 / 逾期）', () => {
  const book = { outline: { foreshadow: [{ id: 'F1', content: '那盏没熄的灯', plantAt: 1, payoffAt: 2 }] } };
  updateForeshadow(book, { index: 1, text: '他看见了那盏灯。' });
  assert.equal(book.outline.foreshadow[0].status, 'planted', '埋设章应标 planted');

  updateForeshadow(book, { index: 2, text: '他绕回码头，那盏没熄的灯还亮着。' });
  assert.equal(book.outline.foreshadow[0].status, 'paid', '回收章提到关键词应标 paid');
  assert.equal(book.outline.foreshadow[0].paidAt, 2);
});

t('记忆：到回收章没提先标「待确认」，过章才判逾期', () => {
  const book = { outline: { foreshadow: [{ id: 'F1', content: '那盏没熄的灯', plantAt: 1, payoffAt: 2 }] } };
  updateForeshadow(book, { index: 1, text: '无关内容。' });
  updateForeshadow(book, { index: 2, text: '还是无关。' });
  assert.equal(book.outline.foreshadow[0].status, 'due', '正好到回收章且没提到，应标 due 而不是直接逾期');
});

t('记忆：人工确认回收', () => {
  const book = {
    outline: { foreshadow: [{ id: 'F1', content: '那盏没熄的灯', plantAt: 1, payoffAt: 2, status: 'due' }] },
    chapters: [{ index: 1, text: 'x' }, { index: 2, text: 'y' }],
  };
  const target = confirmForeshadow(book, 'F1');
  assert.equal(target.status, 'paid');
  assert.equal(target.confirmed, true);
});

t('记忆：到回收章没提，过章后判逾期', () => {
  const book = { outline: { foreshadow: [{ id: 'F1', content: '那盏没熄的灯', plantAt: 1, payoffAt: 2 }] } };
  updateForeshadow(book, { index: 1, text: '无关内容。' });
  updateForeshadow(book, { index: 2, text: '还是无关。' });
  updateForeshadow(book, { index: 3, text: '一直无关。' });
  assert.equal(book.outline.foreshadow[0].status, 'overdue');
});

t('记忆：连续性检查能认出设定外的新名字', () => {
  const book = {
    bible: { characters: [{ name: '沈砚' }] },
    outline: { chapters: [{ index: 1, characters: ['沈砚'] }] },
    memory: { characters: [] },
  };
  const chapter = { index: 1, memory: { characters: ['沈砚', '马保安'] } };
  const r = continuityCheck({ book, chapter });
  assert.deepEqual(r.newcomers, ['马保安']);
});


/* ---- 排版清理（引号内多余标点 / 叠标点）---- */
t('清理：引号内的句号要去掉（「急事。」→「急事」）', () => {
  assert.equal(tidyDialogue('「急事。」').text, '「急事」');
  assert.equal(tidyDialogue('他抬头：「急事。」然后走了。').text, '他抬头：「急事」然后走了。');
});

t('清理：语气标点要保留（！？…不要动）', () => {
  assert.equal(tidyDialogue('「急事！」').text, '「急事！」');
  assert.equal(tidyDialogue('「真的？！」他问。').text, '「真的？！」他问。');
  assert.equal(tidyDialogue('「等一下……」他停了。').text, '「等一下……」他停了。');
});

t('清理：引号内开头的接续标点要去掉', () => {
  assert.equal(tidyDialogue('「，你来。」她说。').text, '「你来」她说。');
});

t('清理：叠标点合并成一个，省略号不合并', () => {
  assert.equal(tidyDialogue('他说完了。。。。').text, '他说完了。');
  assert.equal(tidyDialogue('真的！！？').text, '真的！！？'.replace('！！', '！'), '叹号叠用应合并');
  assert.equal(tidyDialogue('他想了想……').text, '他想了想……', '省略号不能被合并成一个点');
});

t('清理：整章收尾只动排版，不动字数语义', () => {
  const { text, changes } = tidyChapterBody('  第一段。「急事。」\n\n\n\n第二段。  ');
  assert.equal(text, '第一段。「急事」\n\n第二段。');
  assert.ok(changes.length >= 2, '应记录清理项');
});


t('字数口径：标点与空白不计入字数', () => {
  const a = '「你过来。」';           // 中文 3 字 + 6 个标点
  assert.equal(wordCount(a), 3, `标点不该计入，实际 ${wordCount(a)}`);
  assert.equal(wordCount('他说：走吧！'), 4);
  assert.equal(wordCount('    \n\n  '), 0, '空白为 0');
});

t('字数口径：英文按词、数字串按 1 计', () => {
  assert.equal(wordCount('OK'), 1);
  assert.equal(wordCount('2026'), 1);
  assert.equal(wordCount('他说 OK 三遍'), 5, '中文3 + OK1 + 三遍2');
});

t('字数口径：与「含标点字符数」有明显差额（这正是用户觉得不合理的原因）', () => {
  const text = '「你过来。」周禄把折子合上，「我只认折子。上面有名，有画，有用途。」';
  const raw = text.replace(/\s/g, '').length;
  const eff = wordCount(text);
  assert.ok(raw - eff >= 10, `差额应可观：raw=${raw} eff=${eff}`);
  assert.equal(punctuationCount(text), raw - eff + 0, '标点数应与差额一致');
});

for (const [name, fn] of asyncTests) {
  try {
    await fn();
    pass += 1;
  } catch (e) {
    fail += 1;
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

// 别再报「全部通过」的假绿：有失败就必须说清有几项没过
if (fail) console.log(`✗ ${pass} 项通过，${fail} 项未过`);
else console.log(`✓ ${pass} 项自测全部通过`);
