import { gateReport as scriptGates } from '../engine/script.mjs';
import { gateReport as outlineGates } from '../engine/outline.mjs';
import { analyzeScript, speechSeconds } from './analyzeService.js';
import { completeJson, status as llmStatus } from '../agent/llm.js';
import { scriptText } from '../assets/scriptRender.js';
import { logger } from '../logger.js';

// 剧本评估：确定性规则 + 结构指标两层，不调用模型、不做主观打分。
// 上游 YumingScroll 的做法是「生成 → 正则闸门 → 不通过就重写」，
// 这里把闸门换成可解释的门清单，并把量化阈值（中文 4.2 字/秒等）单独列出来。

const WEIGHTS = { script: 0.6, outline: 0.2, structure: 0.2 };

export function evaluate(script, outline) {
  const sGates = scriptGates(script, { outline });
  const oGates = outline ? outlineGates(outline) : [];
  const structure = analyzeScript(script, outline);

  const scriptPassed = sGates.filter((g) => g.ok).length;
  const outlinePassed = oGates.filter((g) => g.ok).length;
  const scriptRate = sGates.length ? scriptPassed / sGates.length : 0;
  const outlineRate = oGates.length ? outlinePassed / oGates.length : 0;

  // 结构分：时长偏差、对白占比、爽点覆盖三个维度各占三分之一
  const eps = structure.episodes ?? [];
  const durOk = eps.filter((e) => Math.abs(e.deviation) <= 15).length;
  const diaOk = eps.filter((e) => e.dialogueRatio <= 75).length;
  const hookOk = eps.filter((e) => e.hooks.length > 0).length;
  const structureRate = eps.length
    ? (durOk / eps.length + diaOk / eps.length + hookOk / eps.length) / 3
    : 0;

  const score = Math.round(
    (scriptRate * WEIGHTS.script + outlineRate * WEIGHTS.outline + structureRate * WEIGHTS.structure) * 100,
  );

  const gates = [
    ...sGates.map((g) => ({ ...g, scope: 'script' })),
    ...oGates.map((g) => ({ ...g, scope: 'outline' })),
  ];

  return {
    score,
    passed: scriptPassed + outlinePassed,
    total: sGates.length + oGates.length,
    gates,
    problems: gates.filter((g) => !g.ok),
    structure,
    // 逐句诵读时长：按 4.2 字/秒估算，标出可能念不完的句子
    speech: speechBreakdown(script),
    dimensions: {
      script: Math.round(scriptRate * 100),
      outline: Math.round(outlineRate * 100),
      structure: Math.round(structureRate * 100),
    },
  };
}

function speechBreakdown(script) {
  const rows = [];
  for (const ep of script?.episodes ?? []) {
    for (const sc of ep.scenes ?? []) {
      for (const b of sc.flow ?? []) {
        if (!b.line) continue;
        rows.push({
          ep: ep.ep,
          speaker: b.speaker,
          text: b.line,
          chars: b.line.replace(/\s/g, '').length,
          seconds: speechSeconds(b.line),
        });
      }
    }
  }
  const long = rows.filter((r) => r.chars > 35);
  return { count: rows.length, totalSeconds: Math.round(rows.reduce((s, r) => s + r.seconds, 0) * 10) / 10, long, rows: rows.slice(0, 200) };
}

/** 只跑门、不算分：给「体检已有剧本」的场景用 */
export function checkup(script, outline) {
  const gates = scriptGates(script, { outline });
  return { gates, failed: gates.filter((g) => !g.ok) };
}

/* ================= AI 评审（大模型层） ================= */
/*
 * 24 道门管「形状」：每集几场、台词几个字、钩子有没有——这些能算，且算得准。
 * 门管不了「好不好看」：第 7 集那个反转有没有说服力、这段台词是不是水词，算不出来。
 * 所以评估分两层，加权出总分：
 *   确定性层 0.6（可复现，拿来做回归）+ 模型层 0.4（懂戏，拿来判断留人能力）。
 * 模型层失败不阻断：门的分照给，并在响应里带 judgeError 说明原因——
 * 一次网络抖动不该让「评估」整个不可用。
 */
export const JUDGE_DIMENSIONS = Object.freeze(['hook', 'character', 'dialogue', 'pacing', 'commercial']);

const JUDGE_SYSTEM = `你是竖屏付费短剧的评审，只判断「留不留得住人」，不评价文学性。
拿到的剧本已经过了机器门（格式、时长、单句字数都合规），所以不要挑格式问题；
你要挑的是：观众第几秒会划走、哪一集开始拖、哪个爽点没兑现、哪句台词像网文。

评分维度（每个 0–100，60 分是「能上线但不亮眼」）：
- hook：开场三拍能不能抓住人；每集结尾卡点是不是真钩子（而不是总结陈词）
- character：主角目标是否清楚、反派是否可恨、人物动机立不立得住
- dialogue：有没有网文腔、水词、解释型台词（人物互相说对方早就知道的事）
- pacing：集内节奏与集间推进，有没有「这一集什么都没发生」
- commercial：付费转化——卡点位置、爽点密度、能不能剪出推广切片

只输出 JSON，不要解释、不要 Markdown 代码块；strengths / risks 必须具体到第几集。`;

const JUDGE_USER = (script, outline, base) => `【剧本正文】
${scriptText(script, outline, { maxChars: 12000 })}

【题材】${outline?.genre ?? script?.genre ?? '未标注'}
【全剧 ${base.total} 道门里未过 ${base.problems.length} 道（客观事实，别推翻，用来解释原因）】
${base.problems.slice(0, 12).map((p) => `- ${p.label}：${p.detail ?? '未通过'}`).join('\n') || '- 无（形状层面全部合规）'}

【输出】
{
  "verdict": "优秀|良好|及格|不合格",
  "score": 0,
  "summary": "两三句话：这部剧最值钱的地方 + 最致命的问题",
  "dimensions": {"hook": 0, "character": 0, "dialogue": 0, "pacing": 0, "commercial": 0},
  "strengths": ["最多 4 条，每条一句，具体到第几集的哪个处理"],
  "risks": ["最多 4 条，说清会在第几集掉观众、为什么"],
  "fixes": [{"where": "第3集第2场", "what": "怎么改", "why": "为什么这么改"}]
}

__TASK__: eval
__PARAMS__: {"episodes": ${(script?.episodes ?? []).length}, "gates": ${base.total}, "failed": ${base.problems.length}}`;

const VERDICTS = ['优秀', '良好', '及格', '不合格'];

const clampScore = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
};

const textList = (v, cap = 4) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String(x.what ?? x.text ?? '') : ''))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap);

const fixList = (v, cap = 6) =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'string'
      ? { where: '', what: x.trim(), why: '' }
      : { where: String(x?.where ?? '').trim(), what: String(x?.what ?? '').trim(), why: String(x?.why ?? '').trim() }))
    .filter((x) => x.what)
    .slice(0, cap);

/** 模型给什么都得能兜住：缺字段补默认，越界压回 0–100，类型不对就丢 */
export function normalizeJudge(raw, base) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('评审结果不是 JSON 对象');
  const dims = raw.dimensions && typeof raw.dimensions === 'object' ? raw.dimensions : {};
  const given = JUDGE_DIMENSIONS.filter((k) => Number.isFinite(Number(dims[k]))).length;
  if (!given && !Number.isFinite(Number(raw.score))) throw new Error('评审结果里没有任何可用分数');

  const dimensions = {};
  for (const k of JUDGE_DIMENSIONS) dimensions[k] = clampScore(dims[k], base.dimensions?.[k] ?? 60);
  const avg = JUDGE_DIMENSIONS.reduce((s, k) => s + dimensions[k], 0) / JUDGE_DIMENSIONS.length;
  const score = clampScore(raw.score, Math.round(avg));
  const verdict = VERDICTS.includes(raw.verdict) ? raw.verdict : score >= 85 ? '优秀' : score >= 72 ? '良好' : score >= 60 ? '及格' : '不合格';

  return {
    verdict,
    score,
    summary: String(raw.summary ?? '').trim().slice(0, 400),
    dimensions,
    strengths: textList(raw.strengths),
    risks: textList(raw.risks),
    fixes: fixList(raw.fixes),
  };
}

/** 评估 = 确定性门（可复现）+ 模型评审（懂戏），按 6:4 加权 */
export async function evaluateWithLLM(script, outline) {
  const base = evaluate(script, outline);
  const llm = llmStatus();
  let judge = null;
  let judgeError = '';

  try {
    const raw = await completeJson({ system: JUDGE_SYSTEM, user: JUDGE_USER(script, outline, base) });
    judge = normalizeJudge(raw, base);
    logger.info('evaluate.judge', { score: judge.score, verdict: judge.verdict, mode: llm.mode });
  } catch (e) {
    judgeError = e.message;
    logger.warn('evaluate.judge.fail', { reason: e.message, mode: llm.mode });
  }

  const score = judge ? Math.round(base.score * 0.6 + judge.score * 0.4) : base.score;
  return { ...base, score, judge, judgeError, llm: { mode: llm.mode, model: llm.model } };
}
