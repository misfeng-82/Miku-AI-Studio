/**
 * 去 AI 味服务：确定性扫描 + 带门禁的模型改写
 *
 * 逻辑来源：移植自「绘梦」的章节流水线（pipelines/write-chapter.json）：
 *   L1 量化扫描 → 去 AI 味改写（减法 + 加法）→ 复扫定档。
 * 本文件把这条链压成一个同步可调的服务，并接进本项目的门禁体系。
 *
 * 为什么先扫描再改，而不是直接扔给模型「帮我改得人味一点」：
 *   模型对「AI 味」没有可验证的标准，改完通常会自我评价「已优化」。
 *   先把 13 个维度实测出来（分、最差项、命中词），改写提示词里带着这些具体数字，
 *   模型才知道要动哪里；改完复扫同一个扫描器，分数降没降是可核对的，不是它说了算。
 *
 * 为什么改写最多两轮：
 *   每一轮都是一次完整重写，费用和原文长度成正比。第一轮通常已经能把分拉下来；
 *   第二轮只在「仍然不过门」时才跑，且必须带上第一轮的具体诊断。
 *   再多的轮次交给用户自己决定 —— 反复重写会开始丢情节细节，得不偿失。
 */
import { complete, status as llmStatus } from '../agent/llm.js';
import { logger } from '../logger.js';
import { analyzeText, deaiGate } from '../engine/deaiScan.mjs';
import { SIX_CHECKS, SUBTRACT, ADD, RULES } from '../assets/deaiRules.js';

export const LIMITS = Object.freeze({
  minChars: 30,
  maxChars: 60000,
  defaultTarget: 40,
  minTarget: 10,
  maxTarget: 80,
  maxRounds: 2,
});

/** 改写纪律：写成清单，模型照做，人也能核对 */
const DISCIPLINE = Object.freeze([
  '不改情节、人物关系、事件顺序、场次数量；只改表达',
  '不得缩短篇幅：改后字数 ≥ 原稿的 95%',
  '用户标注「必须保留」的内容一个字都不动',
  '先做减法（清套话/解释/模板句），再做加法（补具体感官、潜台词、留白）',
  '只做减法会让文字变干净但变冷，两步都要做',
]);

const SYSTEM = `你是去 AI 感编辑。AI 感不是几个禁用词的集合，而是文本在语言、人物、情节、情绪、节奏上
呈现的模式化、可替换性与低决策密度。所以不做表面词语替换，不做同义词搬运。

工作顺序：先诊断六项 → 再做减法 → 再做加法。

【六项诊断】
${SIX_CHECKS.map((c, i) => `${i + 1}. ${c.name}：${c.question}`).join('\n')}

【减法 · 表层病灶】
${SUBTRACT.map((s, i) => `${i + 1}. ${s.name}（${s.target}）→ ${s.pass}`).join('\n')}

【加法 · 人味与决策】
${ADD.map((a, i) => `${String.fromCharCode(65 + i)}. ${a.name} → ${a.pass}`).join('\n')}

【硬性要求】
${DISCIPLINE.map((r, i) => `${i + 1}. ${r}`).join('\n')}

【输出格式 · 严格三段】
### 一、修改后全文
（完整正文，可直接替换原稿，不加任何标记、不加说明）

### 二、修改记录
| # | 原句 | 改句 | 检查项 |
|---|------|------|--------|
至少 6 条，必须是有价值的改动；检查项写六项诊断或减法/加法的名称，禁止「很→非常」式凑数。

### 三、未处理项
说明哪些地方你选择不改，以及理由（一到三条即可）。`;

/** 把模型的输出拆成「正文 / 修改记录 / 未处理项」 */
export function splitRewriteOutput(text) {
  const t = String(text ?? '');
  const bodyHeads = '(?:修改后全文|定稿全文|最终全文|修改全文|正文|定稿)';
  const recordHeads = '(?:修改记录|修订记录|修改说明|改动记录)';
  const pendingHeads = '(?:未处理项|未处理|保留项)';

  const grab = (heads) => {
    const re = new RegExp(`^#{1,4}\\s*[一二三四五六七八九十\\d]*\\s*[、.．)）]?\\s*${heads}\\s*\\n([\\s\\S]*?)(?=^#{1,4}\\s|$(?![\\s\\S]))`, 'm');
    return t.match(re)?.[1]?.trim() ?? '';
  };

  let body = grab(bodyHeads);
  if (!body) {
    // 兜底：模型没按格式输出时，取「修改记录」之前的部分当正文
    const cut = t.search(new RegExp(`^#{1,4}\\s*[一二三四五六七八九十\\d]*\\s*[、.．)）]?\\s*${recordHeads}`, 'm'));
    body = (cut > 0 ? t.slice(0, cut) : t).trim();
  }
  return { body, record: grab(recordHeads), pending: grab(pendingHeads) };
}

/** 扫描（纯本地，不调模型）；maxScore 决定门禁线 */
export function scan(text, opts = {}) {
  const maxScore = Number(opts.maxScore) > 0 ? Number(opts.maxScore) : LIMITS.defaultTarget;
  const report = analyzeText(text, { bodyOnly: opts.bodyOnly !== false });
  return { report, gates: deaiGate(report, { maxScore }), maxScore };
}

/** 一次改写的提示词：把实测数据翻译成「这一轮该动哪里」 */
function buildUser({ text, report, target }) {
  const worst = report.dimensions
    .filter((d) => d.effectiveWeight > 0 && d.penalty > 0)
    .slice(0, 4)
    .map((d) => `- ${d.label}：惩罚 ${d.penalty}（${d.detail}）`)
    .join('\n');

  const hits = report.issues.slice(0, 12)
    .map((i) => `${i.word}×${i.count}`)
    .join('、');

  const advice = [];
  if (report.structureFlags.some((f) => f.type === '章末总结式结尾')) {
    advice.push('末段是总结式结尾：删掉「终于明白 / 从此」这类收束句，停在一个动作上。');
  }
  if (report.triads.length) advice.push(`有 ${report.triads.length} 处三连排比，至少打破一处节奏。`);
  if (report.openingRepeats.length) advice.push(`有 ${report.openingRepeats.length} 处相邻段首重复，换主语或直接并段。`);
  if (report.basic.dialogRatio < 0.08 && report.charCount >= 1200) {
    advice.push('对话占比过低，叙述压得太满：把该由人物说出口的冲突改成对话。');
  }

  return `【原文】
${text}

【本机实测扫描】
AI 痕迹分：${report.score} / 100（${report.grade}）　门禁线：${target}
字数：${report.charCount}　句数：${report.basic.sentences}　段数：${report.basic.paragraphs}
${worst ? `最该动的维度：\n${worst}` : '各项都在合格区间，按可读性精修即可。'}
${hits ? `命中套话（按次数）：${hits}` : '没有命中套话词表。'}
${advice.length ? `\n【结构提示】\n${advice.map((a) => `- ${a}`).join('\n')}` : ''}

【本轮目标】把 AI 痕迹分降到 ${target} 以下，同时不得丢情节与字数。
__TASK__: deai
__PARAMS__: {"target": ${target}, "score": ${report.score}}`;
}

/**
 * 去味改写主流程：改 → 复扫 → 不过门带诊断再改一轮。
 * 模型未接入或样本引擎时不做假动作：直接如实返回 note，不假装改过。
 */
export async function rewrite({ text, target, rounds } = {}) {
  const src = String(text ?? '').trim();
  const want = Math.min(LIMITS.maxTarget, Math.max(LIMITS.minTarget, Number(target) || LIMITS.defaultTarget));
  const maxRounds = Math.min(LIMITS.maxRounds, Math.max(1, Number(rounds) || LIMITS.maxRounds));

  const before = analyzeText(src);
  if (!before.ok) {
    return { ok: false, error: before.error, before: null, after: null, text: '', target: want };
  }

  const llm = llmStatus();
  if (llm.mode !== 'live') {
    return {
      ok: true,
      skipped: true,
      before,
      after: null,
      text: '',
      target: want,
      record: '',
      pending: '',
      rounds: [],
      gates: deaiGate(before, { maxScore: want }),
      note: llm.mode === 'mock'
        ? '样本引擎不重写正文：扫描结果是真的（本机实测），改写需要接上模型。先看分数与命中的套话，能改的先自己改。'
        : '还没有接入模型：扫描是本地算的，随手可用；改写需要点右上角「接 API」填 Key 与 Base URL。',
      llm: { mode: llm.mode, model: llm.model },
    };
  }

  let current = src;
  let report = before;
  let record = '';
  let pending = '';
  const history = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    const user = buildUser({ text: current, report, target: want })
      + (round === 1 ? '' : `\n\n【上一轮没过的维度】\n${report.topProblems.map((d) => `- ${d.label}：${d.detail}`).join('\n')}\n这一轮优先处理这几项，其余不要乱动。`);

    const raw = String(await complete({ system: SYSTEM, user }) ?? '');
    const parts = splitRewriteOutput(raw);
    if (!parts.body || parts.body.length < src.length * 0.5) {
      // 模型没按格式输出，或者把稿子砍掉一半：这一轮作废，不覆盖原文
      history.push({ round, error: '模型返回没有可取正文（可能没按三段格式输出，或篇幅被砍掉一半以上）', score: null });
      logger.warn('deai.rewrite.bad-output', { round, chars: raw.length, bodyChars: parts.body.length });
      continue;
    }

    const next = analyzeText(parts.body);
    history.push({ round, score: next.score, grade: next.grade, chars: next.charCount, pass: next.score <= want });

    current = parts.body;
    report = next;
    record = parts.record;
    pending = parts.pending;
    logger.info('deai.rewrite.round', { round, score: next.score, target: want, chars: next.charCount });

    if (next.score <= want) break;
  }

  const ratio = before.charCount ? report.charCount / before.charCount : 1;
  const notes = [];
  if (report.score <= want) notes.push(`已过门：AI 痕迹分 ${before.score} → ${report.score}（门禁线 ${want}）`);
  else notes.push(`仍未过门：${before.score} → ${report.score}，门禁线 ${want}，建议再跑一轮或人工改最差项`);
  if (ratio < 0.95) notes.push(`注意：改后字数只有原稿的 ${Math.round(ratio * 100)}%，可能丢了内容，请对照修改记录确认`);

  return {
    ok: true,
    skipped: false,
    before,
    after: report,
    text: current,
    target: want,
    record,
    pending,
    rounds: history,
    gates: deaiGate(report, { maxScore: want }),
    improved: report.score < before.score,
    delta: Math.round((report.score - before.score) * 10) / 10,
    note: notes.join('；'),
    llm: { mode: llm.mode, model: llm.model },
  };
}

/** 规则库快照（前端展示「它凭什么扣分」） */
export function rules() {
  return {
    rules: RULES,
    sixChecks: SIX_CHECKS,
    subtract: SUBTRACT,
    add: ADD,
    limits: LIMITS,
  };
}
