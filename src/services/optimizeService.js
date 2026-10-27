import { autoFixScript } from './scriptService.js';
import { evaluate } from './evaluateService.js';
import { complete, status as llmStatus } from '../agent/llm.js';
import { logger } from '../logger.js';
import { parseScriptText } from '../../public/parseScriptText.js';
import { gateReport as scriptGates } from '../engine/script.mjs';
import { episodeText } from '../assets/scriptRender.js';

// 剧本优化 = 确定性预修 + 逐集模型改写。
//
// 为什么先确定性：「拆超长台词、给纯对白场次补动作」这类改动机器改了一定对，
// 交给模型反而有写坏的风险，而且白花钱。能算的不问模型。
//
// 为什么逐集而不是整稿：「整稿重写」一次要吃几万字，模型必然开始偷工减料（漏集、
// 砍场次），而且失败一次全稿作废。逐集改、逐集过门，坏也只坏一集——和生成链路
// 一个思路（scriptGenService 的 REPAIR_ROUNDS 那一套）。
//
// 改完必须复评：分数不涨的「优化」等于没优化，界面要能看见前后对比。

/** 模型的改写纪律：不动故事骨架，只改可拍性 */
export const REWRITE_RULES = Object.freeze([
  '保留核心故事线和主要人物设定，不改变故事主旨',
  '不改场次数量（2–4 场）与场景地点，只在原有场次里改台词与动作',
  '台词去网文腔、去水词：不解释观众已经看见的事，人物不互相复述已知信息',
  '每句台词 ≤22 字；长句拆成两句连说，不要写成一段独白',
  '强化戏剧冲突：每场至少有一个「谁赢了这一回合」的明确结果',
  '集尾卡点落在情绪最高点，不许用旁白/字幕总结剧情',
]);

/** 单集重修次数：门的诊断带回去重写，再多就交给人 */
const REPAIR_ROUNDS = 1;
/** 一次优化最多重写几集：逐集调用是要花钱的，默认按「最烂的 8 集」修 */
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;

const REWRITE_SYSTEM = `你是短剧剧本医生，专治「能拍但留不住人」的稿子。
你只做外科手术，不做重写：人物、场次、地点、事件顺序都不许换，换的是台词的密度、
动作的可拍性、以及每场戏的输赢落点。

${REWRITE_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}

【硬约束】
1. 只输出这一集的标准稿正文：从「## 第N集」开始，到「【黑屏】第N集完」结束。
   不要解释、不要 Markdown 代码块、不要输出别的集。
2. 场号行格式：场N‑M 时间 内外 场景名，场景名沿用原文。
3. 人物只能用「可出场人物」里的人，不许新增角色；不许把配角写成主角。
4. 每场至少 2 个 △ 动作；△ 里只写动作和画面，不写心情形容词。
5. 集尾必须有【钩子字幕】一句话，紧接【黑屏】第N集完。`;

const REWRITE_USER = ({ ep, src, entry, problems, cast }) => `【本集原文】
${src}

【本集大纲】
梗概：${entry.synopsis ?? '（无）'}
开场钩子：${entry.hook ?? '（无）'}
结尾卡点：${entry.suspense ?? '（无）'}
${(entry.scenePlan ?? []).length ? `场景计划：\n${entry.scenePlan.map((s) => `- ${s.location}：${s.event}`).join('\n')}` : ''}

【本集未过的质量门（逐条修掉，不要绕）】
${problems.map((p) => `- ${p.label}${p.detail ? `：${p.detail}` : ''}`).join('\n') || '- 无硬性问题，按可拍性与节奏精修'}

【可出场人物】
${cast.map((c) => `- ${c.name}｜${c.role || '配角'}`).join('\n') || '- （原文里出现的人）'}

【改写重点】
- 观众会在哪一秒划走？把那个位置的动作或台词换掉。
- 有哪一句是「人物在给观众解释剧情」？改成动作或冲突。
- 这一集结束时，观众必须有一个非点开下一集不可的理由。

__TASK__: optrewrite
__PARAMS__: {"ep": ${ep}, "problems": ${problems.length}}`;

/** 角色/场景簿记：用大纲的表来对账，模型返回的人名要映射回原有 id */
function bookOf(script, outline) {
  return {
    characters: (outline?.characters ?? []).map((c) => ({ id: c.id, name: c.name, role: c.role ?? '' })),
    scenes: (outline?.scenes ?? []).map((s) => ({ id: s.id, name: s.name })),
    episodes: (outline?.episodes ?? []).map((e) => ({
      ep: e.ep,
      sceneIds: [...(e.sceneIds ?? [])],
      characterIds: [...(e.characterIds ?? [])],
      crowdPlan: e.crowdPlan,
    })),
  };
}

/** 哪几集最该改：先按未过门数排，同样多按集号排 */
function pickTargets(script, outline, limit) {
  const rows = [];
  for (const ep of script?.episodes ?? []) {
    const gates = scriptGates({ ...script, episodes: [ep] }, { outline });
    const failed = gates.filter((g) => !g.ok);
    if (failed.length) {
      rows.push({
        ep: ep.ep,
        failed: failed.length,
        problems: failed.map((g) => ({ label: g.label, detail: g.detail })),
      });
    }
  }
  rows.sort((a, b) => b.failed - a.failed || a.ep - b.ep);
  return rows.slice(0, limit);
}

/**
 * 把模型返回的一集「长回」原剧本的簿记上。
 *
 * 不能直接复用 remapIds：解析器会把「只在一集里开口」的人都塞进群演桶，
 * 于是 C01 的 name 是「群演」，按名字回查会把阿莲的台词安给群演。
 * 但解析器把原名字留在了 delivery 里（"阿莲" / "船客 低声"），按它认人才对。
 * 认不出来的名字（模型自己编的）落到群演桶，不新造角色——优化不该改人物表。
 */
export function graftEpisode(parsed, book, ep, original, entry) {
  const nameToId = new Map(book.characters.map((c) => [c.name, c.id]));
  const parsedName = new Map((parsed.outline?.characters ?? []).map((c) => [c.id, c.name]));
  const bucket = book.characters.find((c) => c.name === '群演')?.id ?? null;
  const sceneIdByName = new Map(book.scenes.map((s) => [s.name, s.id]));

  const idOf = (speakerId, delivery) => {
    // 以「原文写的名字」为准：解析器把每句台词前面的名字原样留在 delivery 里，
    // 而 id 会被群演桶合并，按 id 回查会把两个人的台词算到同一个人头上
    const written = String(delivery ?? '').split(/\s+/)[0].trim();
    const raw = parsedName.get(speakerId);
    const name = written || (raw && raw !== '群演' ? raw : '');
    if (name && name !== '群演' && nameToId.has(name)) return nameToId.get(name);
    return bucket ?? speakerId;
  };

  const src = parsed.script?.episodes?.[0];
  if (!src) return null;

  const scenes = (src.scenes ?? []).map((sc, i) => {
    const name = String(sc.name ?? '').trim();
    let sceneId = sceneIdByName.get(name);
    if (!sceneId) {
      sceneId = `S${String(book.scenes.length + 1).padStart(2, '0')}`;
      book.scenes.push({ id: sceneId, name: name || `场景${i + 1}` });
      sceneIdByName.set(name, sceneId);
    }
    const flow = (sc.flow ?? [])
      .map((b) => (b.speaker ? { ...b, speaker: idOf(b.speaker, b.delivery) } : b))
      .filter((b) => !b.speaker || !String(b.speaker).startsWith('C') || book.characters.some((c) => c.id === b.speaker));
    return {
      ...sc,
      sceneId,
      // flow 必须是映射过的那份：只写 characters 不写 flow，等于把原 id 又搬了回去
      flow,
      characters: [...new Set(flow.filter((b) => b.speaker).map((b) => b.speaker))],
    };
  });

  return {
    ...src,
    ep,
    scenes,
    hook: entry.hook ?? original.hook ?? src.hook,
    cliff: entry.suspense ?? original.cliff ?? src.cliff,
    beatsClaimed: original.beatsClaimed ?? [],
    targetSeconds: original.targetSeconds ?? src.targetSeconds,
  };
}

/** 改一集：调模型 → 解析 → 映射回原有 id → 过门；不过门带诊断再修一轮 */
export async function rewriteEpisode({ script, outline, ep, problems }) {
  const book = bookOf(script, outline);
  const entry = (outline?.episodes ?? []).find((e) => e.ep === ep) ?? {};
  const original = (script.episodes ?? []).find((e) => e.ep === ep);
  if (!original) return { ok: false, episode: null, gates: [], error: `正文里没有第 ${ep} 集` };
  // 没有角色表就没法把模型返回的人名映射回原 id，硬合并会把说话人安错人
  if (!book.characters.length) return { ok: false, episode: null, gates: [], error: '这份剧本没有角色表（outline 缺失），无法安全合并改写结果' };

  const src = episodeText(original, book);
  let gates = [];
  let error = '';
  let episode = null;

  for (let round = 0; round <= REPAIR_ROUNDS; round += 1) {
    const user = REWRITE_USER({ ep, src, entry, problems, cast: book.characters })
      + (round === 0 ? '' : `\n\n【重修指令】上一稿没过门，按诊断逐条修：\n${gates.filter((g) => !g.ok).map((g) => `- ${g.label}：${g.detail}`).join('\n')}`);
    const text = String(await complete({ system: REWRITE_SYSTEM, user }) ?? '');

    const parsed = parseScriptText(text);
    if (!parsed.ok) { error = `解析失败：${parsed.message}`; continue; }

    episode = graftEpisode(parsed, book, ep, original, entry);
    if (!episode) { error = '返回里没有解析出任何一集'; continue; }

    gates = scriptGates({ ...script, episodes: [episode] }, { outline: { ...outline, characters: book.characters, scenes: book.scenes } });
    if (gates.every((g) => g.ok)) { error = ''; break; }
    error = gates.filter((g) => !g.ok).map((g) => g.label).join('、');
    logger.warn('optimize.episode.gates', { ep, round, failed: gates.filter((g) => !g.ok).map((g) => g.id) });
  }

  return { ok: Boolean(episode) && error === '', episode, gates, error };
}

const replaceEpisode = (script, episode) => ({
  ...script,
  episodes: (script.episodes ?? []).map((e) => (e.ep === episode.ep ? episode : e)),
});

/**
 * 优化主流程。返回结构与旧版一致（before/after/script/changed/advice），
 * 另加 rewritten（逐集结果）与 llm（这次是谁改的）。
 */
export async function optimizeWithLLM({ script, outline, limit } = {}) {
  const before = evaluate(script, outline);

  // 第一刀：机器一定能改对的先改（拆长句、补动作、回补节拍）
  const pre = deterministicFix(script, outline);
  let current = pre.script;

  const max = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const targets = pickTargets(current, outline, max);
  const llm = llmStatus();
  const rewritten = [];
  let note = '';

  if (!targets.length) {
    // 分清两种「没得改」：确定性修复动过手 vs 一个字都没动。
    // 早先统一写「只做了确定性修复」，在改动数为 0 时会让用户以为「优化了但什么都没变」，
    // 看起来像功能坏了——实际是这份稿已经达标。
    note = pre.changed > 0
      ? `门全过：没有需要重写的集，只做了 ${pre.changed} 处确定性修复`
      : '这份稿已达标：24 门全过，确定性修复也没找到可改项，无需重写。可直接导出或送去拆分镜。';
  } else if (llm.mode === 'mock') {
    // 样本引擎写不出能过门的正文，硬跑只会产出一堆解析失败——如实说明，不假装改过
    note = `样本引擎不重写正文：识别到 ${targets.length} 集待改，接上模型后会自动逐集精修`;
  } else {
    for (const t of targets) {
      try {
        const r = await rewriteEpisode({ script: current, outline, ep: t.ep, problems: t.problems });
        if (r.ok && r.episode) current = replaceEpisode(current, r.episode);
        rewritten.push({ ep: t.ep, ok: r.ok, failedBefore: t.failed, gates: r.gates, error: r.error });
        logger.info('optimize.episode', { ep: t.ep, ok: r.ok, gates: r.gates.filter((g) => g.ok).length });
      } catch (e) {
        rewritten.push({ ep: t.ep, ok: false, failedBefore: t.failed, gates: [], error: e.message });
        logger.warn('optimize.episode.fail', { ep: t.ep, reason: e.message });
      }
    }
  }

  const after = evaluate(current, outline);
  const total = (script?.episodes ?? []).length;
  return {
    mode: 'llm',
    script: current,
    before,
    after,
    changed: pre.changed,
    rewritten,
    targets: targets.map((t) => t.ep),
    skipped: Math.max(0, total - targets.length),
    note,
    advice: humanAdvice(after.problems),
    llm: { mode: llm.mode, model: llm.model },
  };
}

/** 机器可修的先修，修完立刻复评，给出可核对的前后对比 */
export function deterministicFix(script, outline) {
  const before = evaluate(script, outline);
  const { script: fixed, changed, remaining } = autoFixScript(script, before.problems, script?.params ?? {}, outline);
  const after = evaluate(fixed, outline);
  return { script: fixed, before, after, changed, remaining };
}

/** 汇总人工建议：把机器改不了的问题翻译成人能执行的动作 */
export function humanAdvice(problems) {
  const byGate = new Map();
  for (const p of problems) {
    if (!byGate.has(p.id)) byGate.set(p.id, { id: p.id, label: p.label, details: [] });
    if (p.detail) byGate.get(p.id).details.push(p.detail);
  }
  return [...byGate.values()].map((g) => ({
    ...g,
    // 有专属建议用专属的；没有就把门自己的诊断带出来——六条一样的「逐条检查」等于没建议
    advice: ADVICE[g.id] ?? `按「${g.label}」处理：${g.details[0] ?? '必要时人工改写相关场次。'}`,
  }));
}

const ADVICE = Object.freeze({
  'duration': '调整场次数量或节拍密度，让单集时长回到目标区间；不要靠加快语速硬凑。',
  'line-length': '把长句拆成两句，或把陈述改成动作，让演员有换气空间。',
  'has-action': '为纯对白场次补动作节拍，用画面推进信息而不是靠台词解释。',
  'action-prose': '动作描述要写成叙述体，对白必须走台词节拍，两者不要混在一个节拍里。',
  'beats-claimed': '回到大纲确认这一集认领了哪个爽点，并把它的 type 写进 beatsClaimed。',
  'hook-cliff': '补上开场钩子或结尾悬念，二者缺一都会掉完播率。',
  'hook-open': '用 hookBeat 标出钩子落在第几场第几拍，且必须在开场三拍内。',
  'speaker': '检查说话人是否在本场人物里，画外音要显式标 VO。',
  'refs': '角色与场景 id 要对得上大纲/美术设定，改名或删人后记得同步。',
});
