/* 短剧结构资产库 —— 「一部剧的骨架怎么排」。
 *
 * 和题材、框架都是不同维度，三者叠加才是一部剧：
 *   题材（genreLibrary）    决定**用什么词**、什么人物关系、观众是谁
 *   框架（storyFrameworks） 决定**结构套路**（复仇逆袭流 / 悬疑钩子流…）
 *   结构（本文件）          决定**节奏与商业布局**：集数怎么分段、哪几集设付费卡点、
 *                          反派分几层、每集结尾用什么钩子
 *
 * 来源（MIT，出处记在这里）：lism/short-drama 的 4 份参考文档，按原文口径落地——
 *   paywall-design.md  付费卡点的黄金位置、密度、5 种套路与 5 条禁忌
 *   villain-design.md  四层反派体系：层级 / 活跃区间 / 三段式交锋 / 伏笔要求
 *   rhythm-curve.md    四段式节奏曲线：起势 15% → 攀升 30% → 风暴 35% → 决战 20%
 *   hook-design.md     5 种钩子的分阶段配置、题材侧重、「连续 3 集不用同类」自检
 *
 * 这些东西本来是「写给模型看的散文」，这里全部做成**确定性函数**：
 * 模型写剧情，排版的事由代码排——卡点落在第几集、反派第几集退场，不该靠模型发挥。
 */

import { HOOK_TYPES } from './genreLibrary.js';

/* ------------------------------------------------------------------ */
/* 一、节奏曲线：四段式                                                */
/* ------------------------------------------------------------------ */

export const RHYTHM_STAGES = Object.freeze([
  {
    id: 'start', label: '起势段', ratio: 0.15,
    task: '建立角色与核心冲突，累积至少 3 个未解悬念，展示一次小规模爽点的味道',
    hooks: ['suspense', 'info'], intensity: '中等',
  },
  {
    id: 'rise', label: '攀升段', ratio: 0.30,
    task: '中反派登场并至少赢主角一次，情绪投入加深，卡点密度最高',
    hooks: ['suspense', 'emotion', 'twist'], intensity: '中等偏强',
  },
  {
    id: 'storm', label: '风暴段', ratio: 0.35,
    task: '大反派显露真身，高密度刺激，主角先受挫再翻盘',
    hooks: ['twist', 'crisis', 'info'], intensity: '强',
  },
  {
    id: 'final', label: '决战段', ratio: 0.20,
    task: '终极对决（2–3 集篇幅），可选揭露隐藏反派，最后一集不设钩子、给圆满收束',
    hooks: ['crisis', 'twist', 'suspense'], intensity: '最强',
  },
]);

/** 第 ep 集属于哪一段（确定性，按累计比例切） */
export function rhythmStageOf(ep, total = 40) {
  const n = Math.max(1, Number(total) || 40);
  const at = Math.min(n, Math.max(1, Number(ep) || 1));
  let acc = 0;
  for (const s of RHYTHM_STAGES) {
    acc += Math.round(n * s.ratio);
    if (at <= acc) return s;
  }
  return RHYTHM_STAGES[RHYTHM_STAGES.length - 1];
}

/** 全剧分段表：[{ stage, from, to }]，前端与 prompt 共用 */
export function rhythmPlan(total = 40) {
  const n = Math.max(1, Number(total) || 40);
  const out = [];
  let from = 1;
  for (const s of RHYTHM_STAGES) {
    const to = Math.min(n, from + Math.max(1, Math.round(n * s.ratio)) - 1);
    out.push({ ...s, from, to });
    from = to + 1;
    if (from > n) break;
  }
  if (out.length) out[out.length - 1].to = n; // 四舍五入的余数全给最后一段
  return out;
}

/* ------------------------------------------------------------------ */
/* 二、付费卡点                                                        */
/* ------------------------------------------------------------------ */

/** 5 种经典卡点套路（原文：paywall-design.md） */
export const PAYWALL_PATTERNS = Object.freeze([
  {
    id: 'identity', label: '身份即将揭露',
    how: '铺垫够了「被看不起」，在真相揭露的前一秒切断（如军衔/胸牌露出的瞬间）',
    forEra: ['modern', 'ancient', 'republic'],
  },
  {
    id: 'crisis', label: '生死一线',
    how: '主角陷入绝境、危险近在眼前，在是死是活揭晓前切断',
    forEra: ['ancient', 'fantasy', 'future'],
  },
  {
    id: 'emotion', label: '情感爆发中断',
    how: '断在「差一点就甜到」的位置，不是甜够了再断（甜宠类主钩子）',
    forEra: ['modern', 'republic'],
  },
  {
    id: 'conspiracy', label: '反派阴谋得逞',
    how: '主角跌到谷底、反派举杯庆祝的瞬间切断，激发愤怒与不甘',
    forEra: ['modern', 'retro', 'ancient'],
  },
  {
    id: 'truth', label: '真相即将大白',
    how: '核心谜题的证据/证人出现，在辨认出「是谁」的前一刻切断',
    forEra: ['modern', 'ancient', 'fantasy'],
  },
]);

/** 卡点禁忌（原文 5 条，进提示词当禁令） */
export const PAYWALL_DONT = Object.freeze([
  '无悬念硬切：平淡场景强行结束，观众没有付费动力',
  '虚假悬念：上集制造的悬念，下集开头 10 秒就化解（观众会觉得被骗）',
  '关键信息提前泄露：观众已经猜到答案，卡点就没意义了',
  '连续多集卡同一个悬念：一个悬念只能卡一次，下一个卡点必须是新悬念',
  '卡在无关紧要的小事上：观众付费是为了看核心剧情推进',
]);

/**
 * 付费卡点规划（确定性）。
 * 口径：占比 10–15%（取 12%）；首个卡点第 8–12 集；卡点间隔 ≥5 集；
 * 前 10 集最多 2 个；终极卡点落在倒数 3–5 集。
 * @returns {{count:number, marks:{ep:number,pattern:object,stage:string,first:boolean,last:boolean}[]}}
 */
export function paywallPlan(total = 40) {
  const n = Math.max(1, Number(total) || 40);
  if (n < 8) return { count: 0, marks: [] };           // 太短，没有付费墙的意义
  const count = Math.min(13, Math.max(3, Math.round(n * 0.12)));
  const step = Math.max(5, Math.floor((n - 12) / Math.max(1, count - 1)));

  const eps = [];
  // 首个卡点落在第 8–12 集（付费转化窗口）；短剧（<14 集）按比例提前，
  // 否则 10 集的剧根本没有卡点位置——免费内容也要留出 2 集以上
  let ep = Math.min(10, Math.max(3, Math.round(n * 0.7)));
  while (eps.length < count && ep <= n - 2) {
    eps.push(ep);
    ep += step;
  }
  // 终极卡点必须在倒数 3–5 集：最后一个不够近就把它挪过去
  if (eps.length && n - eps[eps.length - 1] > 5) {
    const last = n - 4;
    if (last > 0 && (!eps.length || last - (eps[eps.length - 2] ?? 0) >= 5)) eps[eps.length - 1] = last;
  }

  // 套路轮转：身份 → 真相 → 情感 → 阴谋 → 危机，保证相邻卡点不同套路
  const order = ['identity', 'truth', 'emotion', 'conspiracy', 'crisis'];
  const marks = eps.map((e, i) => {
    const id = order[i % order.length];
    return {
      ep: e,
      pattern: PAYWALL_PATTERNS.find((p) => p.id === id) ?? PAYWALL_PATTERNS[0],
      stage: rhythmStageOf(e, n).id,
      first: i === 0,
      last: i === eps.length - 1,
    };
  });
  return { count: marks.length, marks };
}

/** 卡点表 → prompt 文本（只给模型它需要知道的那几集） */
export function paywallText(total = 40) {
  const { marks } = paywallPlan(total);
  if (!marks.length) return '';
  const rows = marks.map((m) => {
    const tag = m.first ? '首个卡点（决定付费转化）' : m.last ? '终极卡点（对决前）' : '卡点';
    return `- 第 ${m.ep} 集｜${tag}｜套路：${m.pattern.label}（${m.pattern.how}）`;
  });
  return [
    `付费卡点共 ${marks.length} 处（占全剧 ${Math.round((marks.length / total) * 100)}%）：`,
    ...rows,
    '卡点集硬要求：情绪最高点 + 一个未解悬念，且必须是核心剧情；下一个卡点不能沿用同一个悬念。',
    `禁忌：${PAYWALL_DONT.join('；')}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 三、四层反派                                                        */
/* ------------------------------------------------------------------ */

export const VILLAIN_TIERS = Object.freeze([
  {
    id: 'small', label: '小反派·炮灰级', from: 0, to: 0.15, count: [1, 2],
    role: '前期给主角练手的靶子，被打脸后迅速退场',
    must: '嚣张但没有实力支撑；惨状要写足；退场干脆，不反复纠缠',
    exit: '被一次打脸后认怂 / 被靠山抛弃 / 自食其果',
  },
  {
    id: 'mid', label: '中反派·主要对手', from: 0.15, to: 0.45, count: [1, 2],
    role: '中期主要障碍，有资源有诉求，需要 2–3 次交锋才能击败',
    must: '三段式交锋：第一次小胜或平手 → 第二次主角受挫（低谷）→ 第三次翻盘；至少要赢主角一次',
    exit: '被更高实力击败 / 被大反派当弃子 / 阴谋败露',
  },
  {
    id: 'boss', label: '大反派·终极 Boss', from: 0.45, to: 0.8, count: [1, 1],
    role: '全剧终极对手，实力最强，最后 2–3 集正面对决',
    must: '出场有仪式感（先只闻其名）；要有「人性的一面」；失败必须让观众觉得「该！」',
    exit: '正面碾压 / 众叛亲离 / 伏法',
  },
  {
    id: 'hidden', label: '隐藏反派·终极反转（可选）', from: 0.8, to: 1, count: [0, 1],
    role: '身边最信任的人，决战段揭露，制造全剧最大反转',
    must: '至少埋 3 处可回溯伏笔；伏笔不能太明显；揭露后要有情感冲击；非必需，没铺垫就不要设',
    exit: '情感维度的最终对决',
  },
]);

/** 反派三问（原文：每个反派必须回答三个问题） */
export const VILLAIN_QUESTIONS = Object.freeze([
  '他为什么要做坏事？（动机：利益 / 嫉妒 / 恐惧 / 偏执 / 立场不同）',
  '他的能力从哪来？（支撑：家族权力 / 财富 / 人脉 / 特殊能力 / 情报）',
  '他为什么不更早、更直接地对付主角？（节制：没放在眼里 / 有所顾忌 / 在等更好时机）',
]);

/**
 * 反派分层计划（确定性）：按集数算每层活跃区间。
 * 甜宠 / 末世这类「不靠对抗驱动」的题材只排 3 层（原文：不是所有题材都要四层）。
 */
export function villainPlan(total = 40, genre = null) {
  const n = Math.max(1, Number(total) || 40);
  const light = genre?.category === 'romance' || genre?.category === 'family' || genre?.category === 'fantasy';
  const tiers = VILLAIN_TIERS.filter((t) => !(light && t.id === 'hidden'));
  return tiers.map((t) => ({
    ...t,
    fromEp: Math.max(1, Math.ceil(n * t.from) + (t.id === 'small' ? 0 : 1)),
    toEp: Math.max(1, Math.round(n * t.to)),
  }));
}

export function villainText(total = 40, genre = null) {
  const rows = villainPlan(total, genre).map((t) => {
    const opt = t.id === 'hidden' ? '（可选：没埋够伏笔就不要设）' : '';
    return `- ${t.label}：第 ${t.fromEp}–${t.toEp} 集活跃，${t.count[0]}–${t.count[1]} 位${opt}\n  作用：${t.role}\n  硬要求：${t.must}`;
  });
  return [
    '反派分层（递进式对抗，每层被击败后要有「更大的威胁出现」的过渡）：',
    ...rows,
    `每个反派必须回答三问：${VILLAIN_QUESTIONS.join('；')}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 四、钩子排布                                                        */
/* ------------------------------------------------------------------ */

/** 各题材的钩子侧重（原文 hook-design.md 的「不同题材的钩子侧重」表，按大类重写） */
export const HOOK_BIAS = Object.freeze({
  'urban-comeback': { main: ['suspense', 'crisis'], sub: ['info'], avoid: ['emotion'] },
  romance: { main: ['emotion'], sub: ['suspense'], avoid: ['crisis'] },
  costume: { main: ['twist', 'crisis'], sub: ['suspense'], avoid: [] },
  retro: { main: ['emotion', 'crisis'], sub: ['info'], avoid: [] },
  fantasy: { main: ['crisis'], sub: ['suspense'], avoid: ['emotion'] },
  suspense: { main: ['info', 'suspense'], sub: ['twist'], avoid: ['emotion'] },
  family: { main: ['emotion'], sub: ['suspense'], avoid: [] },
  republic: { main: ['emotion', 'twist'], sub: ['crisis'], avoid: [] },
  'campus-show': { main: ['emotion', 'suspense'], sub: ['twist'], avoid: [] },
});

const hookLabel = (id) => HOOK_TYPES.find((h) => h.id === id)?.label ?? id;

/**
 * 每集的钩子类型（确定性轮换）。
 * 规则：① 从本段落的候选池里挑；② 按题材侧重排序；③ **连续 3 集不得重复**
 * （原文自检项：「连续 3 集不用同类型钩子」）；④ 卡点集用本段最强的那个；⑤ 最后一集不设钩子。
 */
export function hookPlan(total = 40, genre = null) {
  const n = Math.max(1, Number(total) || 40);
  const bias = HOOK_BIAS[genre?.category] ?? { main: ['suspense', 'emotion'], sub: ['info'], avoid: [] };
  const marks = new Set(paywallPlan(n).marks.map((m) => m.ep));
  const rank = (id) => {
    if (bias.avoid.includes(id)) return 3;
    if (bias.main.includes(id)) return 0;
    if (bias.sub.includes(id)) return 1;
    return 2;
  };
  const out = [];
  let recent = [];
  for (let ep = 1; ep <= n; ep += 1) {
    // 末集不设钩子，但段落仍要标出来——下游按 stage 取，缺了会当成「没排」
    if (ep === n) {
      out.push({ ep, hook: null, label: '无（末集收束）', stage: rhythmStageOf(ep, n).id, paywall: false, note: '最后一集：不设钩子，给圆满收束' });
      continue;
    }
    const stage = rhythmStageOf(ep, n);
    const pool = [...stage.hooks].sort((a, b) => rank(a) - rank(b));
    const pick = pool.find((id) => !recent.slice(-2).includes(id)) ?? pool[0];
    recent.push(pick);
    if (recent.length > 2) recent = recent.slice(-2);
    out.push({
      ep,
      hook: pick,
      label: hookLabel(pick),
      stage: stage.id,
      paywall: marks.has(ep),
      note: marks.has(ep) ? '付费卡点：用本段最强的钩子' : '',
    });
  }
  return out;
}

/** 钩子表 → prompt 文本（按段落压缩，不逐集列，省 token） */
export function hookText(total = 40, genre = null) {
  const plan = hookPlan(total, genre);
  const byStage = RHYTHM_STAGES.map((s) => {
    const rows = plan.filter((p) => p.stage === s.id);
    const kinds = [...new Set(rows.map((r) => r.label).filter(Boolean))];
    const pw = rows.filter((r) => r.paywall).map((r) => r.ep);
    return `- ${s.label}（第 ${rows[0]?.ep}–${rows[rows.length - 1]?.ep} 集，强度 ${s.intensity}）：可用钩子 ${kinds.join('、')}${pw.length ? `；卡点集：第 ${pw.join('、')} 集` : ''}`;
  });
  return [
    '集尾钩子按段落配置（每集结尾必须有钩子，最后一集除外）：',
    ...byStage,
    '硬规则：连续 3 集不得用同一类钩子；钩子必须与主线相关；下集开头必须接住上集的钩子（不许 10 秒就化解）。',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 五、合起来                                                          */
/* ------------------------------------------------------------------ */

/** 大纲阶段的「结构块」：节奏 + 卡点 + 钩子，一次给全 */
export function structureBlock(total = 40, genre = null) {
  return [
    '【全剧结构（已排好，照着落集，不要另起一套）】',
    rhythmPlan(total).map((s) => `- ${s.label} 第 ${s.from}–${s.to} 集（${s.intensity}）：${s.task}`).join('\n'),
    '',
    paywallText(total),
    '',
    hookText(total, genre),
  ].filter(Boolean).join('\n');
}

/** 单集阶段：这一集的结构定位（段落 + 钩子 + 是不是卡点） */
export function episodeStructure(ep, total = 40, genre = null) {
  const row = hookPlan(total, genre).find((p) => p.ep === ep);
  if (!row) return '';
  const lines = [`本集结构定位：${rhythmStageOf(ep, total).label}，集尾钩子用「${row.label ?? '无'}」`];
  if (row.paywall) {
    const m = paywallPlan(total).marks.find((x) => x.ep === ep);
    lines.push(`**本集是付费卡点**：必须停在本段最强情绪点上，套路用「${m?.pattern.label ?? ''}」（${m?.pattern.how ?? ''}）`);
  }
  return lines.join('\n');
}

/** 前端用：把结构算好直接展示（大纲卡片上的 💰/🔥 标记） */
export function structureMap(total = 40, genre = null) {
  const marks = paywallPlan(total).marks;
  return {
    total,
    stages: rhythmPlan(total),
    paywall: marks.map((m) => ({ ep: m.ep, pattern: m.pattern.label, first: m.first, last: m.last })),
    hooks: hookPlan(total, genre),
    villains: villainPlan(total, genre),
  };
}
