/* 剧本生成服务 —— 「梗概人设 → 分集大纲 → 逐集正文」三段式。
 *
 * 方法论来源（MIT，用法与剪裁写在对应提示词块里）：
 *   - honolulu0/llm-script-factory：六阶段创作流水线裁剪成三段；
 *     短剧常识、卡点规则、「集纲 → 标准拍摄脚本」的精修师原则原样端口；
 *     「爽点按节点分布、每卡上下串联」来自它的 DTG 卡纲体系。
 *   - zenstory-ai/drama-skills：可拍摄性原则（每场改变状态、对白必须承担动作、
 *     能演的不说、开场第一拍就是钩子）。
 *
 * 输出格式契约在 src/assets/scriptSpec.js（《都市涅槃》标准稿）。
 *
 * 设计约束：
 *   1. 每段产出都过引擎门（B 段过大纲门、C 段过剧本门），不过就带诊断重修一轮
 *      ——「剧本医生」思路，重试内容由门的 detail 决定，不是空口重来。
 *   2. id 簿记全在服务端确定性完成：角色 id 跟 stage A 的小传走，场景 id 按首次
 *      出现顺序发，爽点 id 顺序编号。模型只吐名字和文字，不碰 id。
 *   3. 解析统一走 public/parseScriptText.js —— 生成器产出的文本和用户粘贴的文本
 *      走同一条入口，「生成的剧本」和「导入的剧本」在下游没有任何区别。
 */
import { complete, completeJson } from '../agent/llm.js';
import { logger } from '../logger.js';
import { badRequest, upstreamError } from '../errors.js';
import { parseScriptText } from '../../public/parseScriptText.js';
import { gateReport as scriptGates, lineChars } from '../engine/script.mjs';
import { gateReport as outlineGates, RISK_PATTERNS } from '../engine/outline.mjs';
import {
  CRAFT_RULES, FORMAT_RULES, SAMPLE_EP1, EP_SECONDS,
  renderTitleBlock, renderCastBlock,
} from '../assets/scriptSpec.js';
import {
  genreById, pickVariant, genreBlock, castBiasText, beatBiasText,
  genreFingerprint, DEFAULT_GENRE_ID,
} from '../assets/genreLibrary.js';
import {
  villainText, villainPlan, structureBlock, episodeStructure, hookPlan, paywallPlan,
} from '../assets/storyStructure.js';

/** 分集大纲一批几集：红果口径 10 集一卡，一批一次调用，失败只重跑这一批 */
const OUTLINE_BATCH = 10;
/** 单集重修次数：门的诊断带回去重写，再多就交给人（模型连续两次写不好，第三次大概率也一样） */
const REPAIR_ROUNDS = 1;
/** 三人以上同框的兜底拆解方案：模型忘了写 crowdPlan 时补上，免得 crowd-plan 门无谓地挂 */
const DEFAULT_CROWD_PLAN = '三人以上同框：主角居中，反派一侧施压，配角递证据或反应，其余人物背景虚化。';

/* ================= Stage A：梗概与人物小传 ================= */

const STORY_SYSTEM = `你是短剧行业的创意合伙人，擅长把一句模糊的灵感变成逻辑严密、商业价值明确的故事蓝本。
你深谙短剧常识，写出来的梗概和人物直接可拍、可改、可过会。

${CRAFT_RULES}

【人物小传口径】
- 主角组：女主/男主各一位，大反派一至两位，定位里写清楚（如「反派/前未婚夫」）。
- 配角：父母、助理、军师、闺蜜等，按剧情需要设置，不为凑数硬加。
- 每条小传 80–120 字：性格内核 + 人物弧（前世/今生或开始/转变）+ 与主角的关系。
- 人物要有反差和记忆点，禁止完美人设。`;

const STORY_USER = (concept, genre, episodes, extra = {}) => `【用户创意】
${concept}

${extra.block ?? ''}

【任务】
基于上面的创意构建一部 ${episodes} 集短剧的故事蓝本。题材必须是「${genre}」，题材坐标里的爽点优先序、桥段池、差异化设定都要落实。
人物配比：${extra.cast || '主角组 2 位、反派 2 位、配角 4 位'}。
只返回 JSON，不要任何解释、不要 Markdown 代码块。

{
  "title": "剧名（4–8 字，带钩子，如《都市涅槃》）",
  "logline": "一句话梗概（30 字内，说清主角、目标、阻力）",
  "synopsis": "完整故事梗概，200–300 字：起承转合完整，明确核心冲突与结局走向",
  "genre": "${genre}",
  "characters": [
    {"name": "苏清鸢", "role": "女主", "villain": "", "desc": "性格理智清醒……80–120 字"},
    {"name": "顾景琛", "role": "反派/前未婚夫", "villain": "boss", "desc": "……"},
    {"name": "白若微", "role": "反派女配", "villain": "small", "desc": "……"},
    {"name": "陆砚辞", "role": "男主", "villain": "", "desc": "……"},
    {"name": "苏明远", "role": "父亲", "villain": "", "desc": "……"},
    {"name": "林筱", "role": "助理", "villain": "", "desc": "……"}
  ]
}

${extra.villain ?? ''}

要求：角色 5–8 个；禁止照抄示例里的人名与设定；desc 里不许出现引号对白。
反派必须在 villain 字段标出层级（small / mid / boss / hidden），非反派留空。
${extra.retryNote ?? ''}

__TASK__: story
__PARAMS__: ${JSON.stringify({ concept, genre, episodes })}`;

/** 剧名要不要算撞车：去掉书名号后完全相等，或者主角名与历史某部的前两位重合 */
function titleClash(story, avoid) {
  const norm = (s) => String(s ?? '').replace(/[《》\s]/g, '');
  const titles = new Set();
  const leadNames = new Set();
  for (const item of avoid ?? []) {
    const m = /^《(.+?)》/.exec(String(item));
    if (m) { titles.add(norm(m[1])); continue; }
    for (const n of String(item).split(/[、,，]/)) if (n.trim()) leadNames.add(n.trim());
  }
  if (titles.has(norm(story.title))) return `剧名《${story.title}》与已有作品重复`;
  const hits = story.characters.filter((c) => leadNames.has(c.name)).map((c) => c.name);
  if (hits.length >= 2) return `主角名 ${hits.slice(0, 3).join('、')} 与已有作品重复`;
  return '';
}

export async function generateStory({ concept, genre, genreId, episodes = 40, variant, variantSeed, avoid = [] } = {}) {
  const idea = String(concept ?? '').trim();
  if (idea.length < 4) throw badRequest('创意太短了：至少写三四句话，把主角、目标和阻力说个大概');
  const eps = Math.min(100, Math.max(1, Number(episodes) || 40));
  // genreId 优先，其次旧的中文题材名，都没有就回落到默认题材——老前端只传 genre 也能跑
  const g = genreById(genreId) ?? genreById(genre);
  const genreName = g?.name ?? String(genre ?? '都市重生复仇');
  const avoidList = [...new Set((avoid ?? []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 12);

  let lastClash = '';
  // 撞了就换一组变体重写一稿：换变体比换题材便宜，也比硬改剧名可信
  for (let round = 0; round < 2; round += 1) {
    const picked = round === 0 && variant && Object.keys(variant).length
      ? variant
      : pickVariant(g, (Number(variantSeed) || Math.floor(Date.now() / 1000)) + round * 7);
    const raw = await completeJson({
      system: STORY_SYSTEM,
      user: STORY_USER(idea, genreName, eps, {
        block: genreBlock(g, { variant: picked, avoid: avoidList }),
        cast: castBiasText(g),
        villain: villainText(eps, g),
        retryNote: round === 0 ? '' : `\n【重写】上一稿${lastClash}，这次剧名和主角名必须全新，差异化设定换成：${Object.values(picked).join(' / ')}`,
      }),
    });
    const story = normalizeStory(raw, { genre: genreName, episodes: eps });
    const clash = titleClash(story, avoidList);
    if (!clash) {
      if (g) {
        story.genreMeta = {
          id: g.id, name: g.name, category: g.category, channel: g.channel, era: g.era,
          variant: picked, fingerprint: genreFingerprint(g.id, picked, story.title),
          thrills: g.thrills, beatBias: g.beatBias,
        };
      }
      logger.info('scriptgen.story', {
        title: story.title, characters: story.characters.length,
        genre: g?.id ?? DEFAULT_GENRE_ID, variant: picked, round,
      });
      return story;
    }
    lastClash = clash;
    logger.warn('scriptgen.story.clash', { round, clash, title: story.title });
  }
  throw upstreamError(`连着两稿都和已有作品撞了（${lastClash}）：换个创意描述，或指定一个不同的题材再试`);
}

/** 反派层级：模型漏标就按「反派人数」确定性补位——层级决定活跃区间，不能靠模型自由发挥 */
const VILLAIN_ORDER = ['small', 'mid', 'boss', 'hidden'];

/** 服务端收口：形状、人数、必填字段都在这里兜住，模型少字段就补默认值 */
function normalizeStory(raw, { genre, episodes }) {
  const o = raw ?? {};
  const listed = (Array.isArray(o.characters) ? o.characters : [])
    .map((c) => ({
      name: String(c?.name ?? '').trim(),
      role: String(c?.role ?? '').trim() || '配角',
      desc: String(c?.desc ?? '').trim(),
      villain: VILLAIN_ORDER.includes(String(c?.villain ?? '')) ? String(c.villain) : '',
    }))
    .filter((c) => c.name && c.name.length <= 12);
  if (listed.length < 2) throw upstreamError('模型没给出可用的人物表（至少 2 个角色），换个创意描述再试');

  // 兜底：没标层级的、但定位写着反派的角色，按出现顺序填 small → mid → boss → hidden
  const tiers = villainPlan(episodes, genreById(o.genre ?? genre)).map((t) => t.id);
  const taken = new Set(listed.map((c) => c.villain).filter(Boolean));
  const free = tiers.filter((t) => !taken.has(t));
  let fi = 0;
  const characters = listed.map((c) => {
    if (c.villain) return c;
    if (!/反派|仇|敌人|对手|幕后|情敌/.test(c.role)) return c;
    const t = free[fi];
    if (!t) return c;
    fi += 1;
    return { ...c, villain: t };
  });
  return {
    title: String(o.title ?? '').trim() || '未命名剧集',
    logline: String(o.logline ?? '').trim(),
    synopsis: String(o.synopsis ?? '').trim(),
    // 题材是用户选的，不许模型自己改；模型爱把 genre 写成它自己发挥的方向
    genre: String(genre ?? '').trim() || String(o.genre ?? '').trim(),
    episodes,
    characters,
  };
}

/** 反派分层展示用：按层级排出「谁在第几集被解决」 */
export function villainCast(story, genre) {
  const plan = villainPlan(story?.episodes ?? 40, genre);
  return plan.map((t) => ({
    ...t,
    names: (story?.characters ?? []).filter((c) => c.villain === t.id).map((c) => `${c.name}（${c.role}）`),
  }));
}

/* ================= Stage B：分集大纲 ================= */

const OUTLINE_SYSTEM = `你是短剧的分集大纲师。任务是把故事蓝本拆成可拍的分集大纲，每集给出三栏：梗概（起承转合）、开场钩子、结尾卡点。

${CRAFT_RULES}

【分集口径】
1. 一集 60–90 秒：梗概用起、承、转、合四句话说清楚，单集梗概 80–150 字。
2. 一集 2–3 场，最多 4 场；每场写清地点和这场发生的关键事件。
3. 开场钩子：全集前 3 秒要看到的具象画面或第一句台词，20 字内。
4. 结尾卡点：全集最后 5 秒的钩子镜头，20 字内，禁止公式化。
5. 每集至少 1 个爽点，weight 取 minor/major；type 只能从这 9 类里选：
   打脸 / 逆袭 / 甜宠 / 虐心 / 悬疑 / 燃 / 搞笑 / 感动 / 反转（和题材配额表用的是同一套词）。
   第一批的第 1 集就要有一个 major 大爆点（大爆点不能等到最后才出现），每 10 集的整数集（第 10、20、30…集）也要有一个 major。
6. 集与集之间上下串联：这一集的结尾状态就是下一集的开场状态，禁止剧情断层。
7. 三人以上同框的集，必须给 crowdPlan：一镜头怎么站位、怎么分层、怎么带反应。`;

const OUTLINE_USER = (story, from, to, prev, extra = {}) => `【故事蓝本】
剧名：《${story.title}》
题材：${story.genre}
${extra.genreRules ? `\n【题材配额】（不是建议，是本题材的排布口径）\n${extra.genreRules}\n` : ''}
梗概：${story.synopsis}

【人物表】（只能用这些人，名字原样照抄）
${story.characters.map((c) => `- ${c.name}｜${c.role}：${c.desc}`).join('\n')}

【前情提要】（上一批已定的大纲，紧接它写，保持连贯）
${prev || '无（这是第一批，从故事开场写起）'}
${extra.structure ? `\n${extra.structure}\n` : ''}
${extra.hookAssign ? `\n【本批集尾钩子已排定】（照抄，不要换类型）\n${extra.hookAssign}\n` : ''}
【任务】
写第 ${from} 集到第 ${to} 集的分集大纲。只返回 JSON，不要任何解释、不要 Markdown 代码块。

{
  "episodes": [
    {
      "ep": ${from},
      "synopsis": "起：……承：……转：……合：……（80–150 字）",
      "openHook": "开场钩子，20 字内",
      "endHook": "结尾卡点，20 字内",
      "hookType": "集尾钩子类型，只能填 ${extra.hookKinds ?? '悬念钩/反转钩/情绪钩/信息钩/危机钩'} 之一（末集填「无」）",
      "scenes": [
        {"location": "铂悦酒店·顶层酒会大厅", "event": "这场发生的关键事件，一句话"}
      ],
      "cast": ["苏清鸢", "顾景琛"],
      "crowdPlan": "三人以上同框才需要：站位与分层方案；两人及以下留空",
      "beats": [
        {"type": "打脸", "weight": "minor", "setup": "铺垫是什么", "payoff": "兑现是什么"}
      ]
    }
  ]
}

要求：每集 beats 至少 1 条；${from === 1 ? '第 1 集必须有一个 major 大爆点；' : ''}第 ${to % 10 === 0 ? to : Math.ceil(to / 10) * 10} 集附近要有一个 major；scenes 每集 2–3 场。

__TASK__: epoutline
__PARAMS__: ${JSON.stringify({ title: story.title, from, to, cast: story.characters.map((c) => c.name) })}`;

export async function generateOutline({ story, from = 1, to } = {}) {
  const s = normalizeStory(story, { genre: story?.genre, episodes: story?.episodes });
  const total = s.episodes;
  const start = Math.max(1, Number(from) || 1);
  const end = Math.min(total, Number(to) || total);
  if (start > end) throw badRequest(`集数范围不对：${start}–${end}`);

  const episodes = [];
  // 题材配额与结构都从 story.genreMeta 来（normalizeStory 会把它抹掉，所以先取出来）
  const g = genreById(story?.genreMeta?.id);
  const genreRules = g ? beatBiasText(g, total) : '';
  const structure = structureBlock(total, g);
  const hooks = hookPlan(total, g);
  const pw = new Set(paywallPlan(total).marks.map((m) => m.ep));
  for (let b = start; b <= end; b += OUTLINE_BATCH) {
    const batchEnd = Math.min(end, b + OUTLINE_BATCH - 1);
    const prev = episodes.slice(-3).map((e) => `- 第${e.ep}集「${e.synopsis.slice(0, 30)}…」卡点：${e.suspense}`).join('\n');
    // 本批每集的钩子类型由代码排定，模型只负责按这个类型写卡点内容
    const hookAssign = hooks.filter((h) => h.ep >= b && h.ep <= batchEnd)
      .map((h) => `- 第${h.ep}集：${h.label ?? '无（末集收束）'}${h.paywall ? '　💰 付费卡点' : ''}`).join('\n');
    const raw = await completeJson({
      system: OUTLINE_SYSTEM,
      user: OUTLINE_USER(s, b, batchEnd, prev, { genreRules, structure, hookAssign }),
    });
    const batch = normalizeOutlineBatch(raw, { story: s, from: b, to: batchEnd });
    episodes.push(...batch);
    logger.info('scriptgen.outline.batch', { from: b, to: batchEnd, got: batch.length });
  }
  const outline = assembleOutline(s, episodes);
  const failed = outlineGates(outline).filter((g) => !g.ok);
  logger.info('scriptgen.outline', { episodes: episodes.length, gatesFailed: failed.map((g) => g.id) });
  return outline;
}

/** 一批集纲的模型输出 → 规范形状（名字、条数、必填字段） */
/** 大纲文本剥引号：no-dialogue 门要求梗概是叙述体——模型爱在梗概里塞「……」对白，这里统一剥掉 */
const stripQuotes = (s) => String(s ?? '').replace(/[「」『』“”"]/g, '');

function normalizeOutlineBatch(raw, { story, from, to }) {
  const list = Array.isArray(raw?.episodes) ? raw.episodes : [];
  const names = new Set(story.characters.map((c) => c.name));
  const out = [];
  for (let ep = from; ep <= to; ep += 1) {
    const r = list.find((x) => Number(x?.ep) === ep) ?? {};
    const scenes = (Array.isArray(r.scenes) ? r.scenes : [])
      .map((x) => ({ location: String(x?.location ?? '').trim(), event: String(x?.event ?? '').trim() }))
      .filter((x) => x.location);
    const cast = (Array.isArray(r.cast) ? r.cast : []).map((x) => String(x ?? '').trim()).filter((x) => names.has(x));
    const beats = (Array.isArray(r.beats) ? r.beats : [])
      .map((x) => ({
        type: String(x?.type ?? '').trim() || '冲突',
        weight: x?.weight === 'major' ? 'major' : 'minor',
        setup: String(x?.setup ?? '').trim(),
        payoff: String(x?.payoff ?? '').trim(),
      }))
      .filter((x) => x.setup || x.payoff);
    out.push({
      ep,
      synopsis: stripQuotes(r.synopsis).trim(),
      openHook: stripQuotes(r.openHook).trim().slice(0, 24),
      endHook: stripQuotes(r.endHook).trim().slice(0, 24),
      hookType: stripQuotes(r.hookType).trim(),
      scenes: scenes.length ? scenes : [{ location: '待定场地', event: '待定事件' }],
      cast,
      crowdPlan: stripQuotes(r.crowdPlan).trim(),
      beats: beats.length ? beats : [{ type: '冲突', weight: 'minor', setup: '阻力出现', payoff: '主角应对' }],
    });
  }
  return out;
}

/** 集纲 + 小传 → 引擎大纲契约：id 簿记全在这里确定性完成 */
function assembleOutline(story, epEntries) {
  const characters = story.characters.map((c, i) => ({
    id: `C${String(i + 1).padStart(2, '0')}`,
    name: c.name,
    role: c.role,
    tier: /女主|男主|反派|主角/.test(c.role) ? 'lead' : 'support',
    ...(c.desc ? { desc: c.desc } : {}),
  }));
  // 分层上限兜底（大纲门 lead≤5 / support≤10 / functional≤10）：
  // 模型把一堆角色都标成「反派」时，超出的主角组按顺序降级，不让门无谓地挂
  const CAP = { lead: 5, support: 10 };
  const demote = (from, to) => {
    for (const x of characters.filter((c) => c.tier === from).slice(CAP[from])) x.tier = to;
  };
  demote('lead', 'support');
  demote('support', 'functional');

  // 场景按首次出现顺序发号；主场景取前两处（与既有夹具口径一致），
  // 只用一次的场景必须带规避方案，否则 once-scene 门挂
  const sceneByName = new Map();
  const scenes = [];
  for (const e of epEntries) {
    for (const sc of e.scenes) {
      if (sceneByName.has(sc.location)) continue;
      const id = `S${String(scenes.length + 1).padStart(2, '0')}`;
      sceneByName.set(sc.location, id);
      scenes.push({ id, name: sc.location, primary: scenes.length < 2, reusePlan: '' });
    }
  }

  // 爽点表：顺序编号；每集至少 1 条（beat-gap 门要求间隔 ≤3 集）
  const beats = [];
  let bn = 0;
  for (const e of epEntries) {
    for (const b of e.beats) {
      bn += 1;
      beats.push({
        id: `B${String(bn).padStart(2, '0')}`,
        type: b.type,
        weight: b.weight,
        episode: e.ep,
        setup: b.setup,
        payoff: b.payoff,
      });
    }
  }

  const charIdByName = new Map(characters.map((c) => [c.name, c.id]));
  // 结构落契约：集尾钩子类型、是否付费卡点、属于哪一段——都由代码排定，
  // 模型填的 hookType 只作为参考（它经常漏或乱填），这里的口径才是下游唯一事实
  const hooks = hookPlan(epEntries.length ? Math.max(...epEntries.map((x) => x.ep)) : 40, genreById(story?.genreMeta?.id));
  const pwEps = new Set(paywallPlan(hooks.length).marks.map((m) => m.ep));
  // 末集不设钩子（要给圆满收束），契约里写清楚，不要留空让人以为是漏了
  const hookOf = (ep) => hooks.find((h) => h.ep === ep)?.label || (ep >= hooks.length ? '无（末集收束）' : '');
  // 生成难点预警：risk-flag 门要求「文本里提到雨/吻/人群/手部特写，就得在清单里挂着」。
  // 让模型自己填必漏——直接拿引擎那份词表扫一遍，同源同口径，这集提了就挂上。
  const risksOf = (e) => Object.entries(RISK_PATTERNS)
    .filter(([, re]) => re.test([e.synopsis, e.openHook, e.endHook].join(' ')))
    .map(([risk]) => risk);
  const episodes = epEntries.map((e) => ({
    ep: e.ep,
    synopsis: e.synopsis || '（梗概待补）',
    hook: e.openHook || '（开场钩子待补）',
    suspense: e.endHook || '（结尾卡点待补）',
    sceneIds: e.scenes.map((sc) => sceneByName.get(sc.location)).filter(Boolean),
    characterIds: e.cast.map((n) => charIdByName.get(n)).filter(Boolean),
    propIds: [],
    crowdPlan: e.crowdPlan || '',
    // 场景事件只给 Stage C 的提示词用，不是引擎契约字段——多带一个不碍事
    scenePlan: e.scenes.map((sc) => ({ location: sc.location, event: sc.event })),
    hookType: hookOf(e.ep) || e.hookType,
    paywall: pwEps.has(e.ep),
    stage: hooks.find((h) => h.ep === e.ep)?.stage ?? '',
    warnings: risksOf(e),
  }));

  // 一次性场景的规避方案（确定性文案：真实生产答案，不是糊弄门的占位）
  const useCount = new Map(scenes.map((s) => [s.id, 0]));
  for (const e of episodes) for (const id of e.sceneIds) useCount.set(id, (useCount.get(id) ?? 0) + 1);
  for (const s of scenes) {
    if (useCount.get(s.id) === 1 && !s.reusePlan) {
      s.reusePlan = '本剧仅此一场：单布景多角度拍，不出场景板';
    }
  }

  // 三人以上同框必须带拆解方案（crowd-plan 门）：模型忘了写的集，补默认方案
  for (const e of episodes) {
    if ((e.characterIds?.length ?? 0) >= 3 && !e.crowdPlan) e.crowdPlan = DEFAULT_CROWD_PLAN;
  }

  // 大爆点不能到最后一集才首次出现（major-early 门）：
  // 模型把唯一 major 压在末集时，把最早的一个 minor 提级——短剧第一集本就是钩子集
  const total = epEntries.length;
  const majors = beats.filter((b) => b.weight === 'major');
  if (total > 1 && (!majors.length || Math.min(...majors.map((b) => b.episode)) >= total)) {
    const first = beats.slice().sort((a, b) => a.episode - b.episode)[0];
    if (first) {
      first.weight = 'major';
      logger.info('scriptgen.outline.majorFix', { promoted: first.id, episode: first.episode });
    }
  }

  return {
    source: `《${story.title}》分集大纲`,
    lang: 'zh',
    title: story.title,
    genre: story.genre,
    synopsis: story.synopsis,
    logline: story.logline,
    params: { episodes: epEntries.length },
    characters,
    scenes,
    props: [],
    beats,
    episodes,
  };
}

/* ================= Stage C：单集正文（都市涅槃标准稿） ================= */

const EPISODE_SYSTEM = `你是短剧行业的金牌编剧，把分集大纲写成《都市涅槃》格式的标准稿。你写的是可拍摄的剧本，不是小说。

${CRAFT_RULES}

${FORMAT_RULES}

【写作硬规则（来自开源项目 drama-skills 的可拍摄性原则）】
1. 每一场都要改变信息、权力、关系、情绪、物理状态或风险之一；没有变化的场删掉或合并。
2. 对白必须在争取、回避、试探、逼迫或重新定义关系；每句话都要能转成演员的一个动作或表情，转不成的删掉。
3. 能演的不说：内心的算计写成画面和动作，不要写成解释性独白；OS 只在「不说观众就漏掉关键信息」时用。
4. 全集第一拍就要给出钩子的具象（一个画面或一句台词），不要铺垫。
5. 主角的每一次出手，都要有配角的反应——爽点来自反应。
6. 单句台词不超过 22 字；△ 动作一行一个；禁止在动作里用形容词写心情。
7. 结尾必须是【钩子字幕】一句话 + 【黑屏】第N集完。
8. △ 动作行是摄影机拍得到的东西：禁止用「」“”写任何对白或心理独白，也禁止写引号。
   画面上要出现的字（短信、屏幕、招牌）直接写内容，不加引号；人物要说话就另起一行写「角色名：台词」。

【参考范例（只学格式与写法，禁止抄袭剧情）】
${SAMPLE_EP1}`;

const EPISODE_USER = (story, outline, ep, prevEnding, extra = {}) => {
  const entry = outline.episodes.find((e) => e.ep === ep);
  if (!entry) throw badRequest(`大纲里没有第 ${ep} 集：先生成覆盖这一集的分集大纲`);
  const charIds = new Set(entry.characterIds);
  const cast = outline.characters.filter((c) => charIds.has(c.id));
  const scenePlan = entry.scenePlan ?? [];
  return `【本集任务】写第 ${ep} 集的完整剧本正文（从「## 第${ep}集」开始，到「【黑屏】第${ep}集完」结束）。
${extra.genreLine ? `\n【题材】${extra.genreLine}\n` : ''}
${extra.structure ? `\n【本集结构定位】${extra.structure}\n` : ''}
【本集大纲】
梗概：${entry.synopsis}
开场钩子：${entry.hook}
结尾卡点：${entry.suspense}
场景与事件：
${scenePlan.map((sc) => `- ${sc.location}：${sc.event}`).join('\n') || entry.sceneIds.map((id) => `- ${outline.scenes.find((x) => x.id === id)?.name ?? id}`).join('\n')}
爽点（本集必须兑现）：
${outline.beats.filter((b) => b.episode === ep).map((b) => `- ${b.type}：${b.setup} → ${b.payoff}`).join('\n')}

【出场人物】
${cast.map((c) => `- ${c.name}｜${c.role}：${c.desc ?? ''}`).join('\n')}

【前情】（上一集怎么结束的，这一集从那个状态接着写）
${prevEnding || '无（这是第一集，从故事开场写起）'}

【输出要求】
- 只输出这一集的 Markdown 正文，从「## 第${ep}集」开始；不要输出标题块、人物小传、故事梗概，不要任何解释。
- 单集 ${EP_SECONDS.min}–${EP_SECONDS.max} 秒：2–4 场，每场至少 2 个 △ 动作，全集 10 人次左右戏份。
- 台词全部 ≤22 字；人名必须与出场人物表完全一致。

__TASK__: epscript
__PARAMS__: ${JSON.stringify({ title: story.title, ep, cast: cast.map((c) => c.name), scenes: scenePlan.map((sc) => sc.location) })}`;
};

export async function generateEpisode({ story, outline, ep, prevEnding = '' } = {}) {
  const s = normalizeStory(story, { genre: story?.genre, episodes: story?.episodes });
  const o = outline ?? {};
  const no = Number(ep) || 1;

  let text = '';
  let parsed = null;
  let gates = [];
  // 题材只影响「怎么写」，不影响「写什么」——一句话带过，避免和本集大纲抢话
  const g = genreById(story?.genreMeta?.id);
  const genreLine = g ? `${g.name}：爽点优先 ${g.thrills.slice(0, 3).join(' > ')}，别写成别的题材的腔调` : '';
  // 结构定位：本集属于哪一段、集尾用什么钩子、是不是付费卡点
  const total = Math.max(o.episodes?.length ?? 0, Number(s.episodes) || 40);
  const structure = episodeStructure(no, total, g);
  for (let round = 0; round <= REPAIR_ROUNDS; round += 1) {
    const user = EPISODE_USER(s, o, no, prevEnding, { genreLine, structure })
      + (round === 0 ? '' : `\n\n【重修指令】上一稿没过质量门，按诊断逐条修：\n${gates.filter((g) => !g.ok).map((g) => `- ${g.label}：${g.detail}`).join('\n')}`);
    text = String(await complete({ system: EPISODE_SYSTEM, user }) ?? '');
    parsed = parseEpisode(text, s, o, no);
    if (!parsed.ok) {
      if (round === REPAIR_ROUNDS) throw upstreamError(`第 ${no} 集解析失败：${parsed.message}`);
      continue;
    }
    // 门禁必须用重映射后的 outline：群演桶、模型即兴加的场景都是在 remap 里补登记的，
    // 拿传入的旧 outline 对账会误报「角色不存在」
    gates = scriptGates(parsed.script, { outline: parsed.outline });
    if (gates.every((g) => g.ok)) break;
    logger.warn('scriptgen.episode.gates', { ep: no, round, failed: gates.filter((g) => !g.ok).map((g) => g.id) });
    if (round === REPAIR_ROUNDS) break;
  }

  const failed = gates.filter((g) => !g.ok);
  logger.info('scriptgen.episode', { ep: no, chars: text.length, gatesFailed: failed.map((g) => g.id) });
  return {
    ep: no,
    text,
    script: parsed.ok ? parsed.script : null,
    outline: parsed.ok ? parsed.outline : null,
    gates,
    passed: failed.length === 0,
  };
}

/** 单集文本 → 契约，并把角色/场景 id 对到整部剧的簿记上（对不上就补登记） */
function parseEpisode(text, story, outline, ep) {
  const parsed = parseScriptText(text);
  if (!parsed.ok) return parsed;
  const remap = remapIds(parsed, story, outline);
  const script = {
    ...remap.script,
    episodes: remap.script.episodes.map((e) => ({
      ...e,
      ep: e.ep || ep,
      // 大纲设计好的开场钩子/结尾卡点优先：那是分集阶段想清楚的，比从文本反推更准
      hook: outline.episodes?.find((x) => x.ep === (e.ep || ep))?.hook || e.hook,
      cliff: outline.episodes?.find((x) => x.ep === (e.ep || ep))?.suspense || e.cliff,
      // 爽点认领：本集就是照这些爽点写的，如实认领
      beatsClaimed: [...new Set((outline.beats ?? []).filter((b) => b.episode === (e.ep || ep)).map((b) => b.type))],
    })),
  };
  return { ok: true, script: splitLongLines(script), outline: remap.outline, stats: parsed.stats };
}

/* ------------------------------------------------------------------ */
/* 长台词拆句                                                          */
/* ------------------------------------------------------------------ */
/*
 * 短剧口径单句 ≤22 字：一口气说不完的台词，演员念不下来、口型也对不上。
 * 提示词写了，重修也压过一轮，模型偶尔还是给 28 字——再让它重写一遍不如
 * 确定性处理：按标点切成连着说的两句，语义不变、可拍性反而更好。
 * 只在生成链路生效（导入的老剧本仍按引擎默认 35 字，不强行改用户的稿）。
 */
const MAX_LINE_CHARS = 22;

function cutLine(line) {
  const parts = String(line ?? '').split(/(?<=[，。！？；、…])/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (cur && lineChars(cur + p) > MAX_LINE_CHARS) { out.push(cur); cur = p.trimStart(); }
    else cur += p;
  }
  if (cur) out.push(cur);
  // 还有超长的（一整句没标点）：硬切，别让门卡在这儿
  return out.flatMap((p) => {
    if (lineChars(p) <= MAX_LINE_CHARS) return [p];
    const chunks = [];
    const s = String(p);
    let i = 0;
    while (i < s.length) {
      let n = MAX_LINE_CHARS;
      while (i + n < s.length && lineChars(s.slice(i, i + n)) < MAX_LINE_CHARS) n += 1;
      chunks.push(s.slice(i, i + n));
      i += n;
    }
    return chunks.filter(Boolean);
  });
}

export function splitLongLines(script) {
  const episodes = (script?.episodes ?? []).map((e) => ({
    ...e,
    scenes: (e?.scenes ?? []).map((sc) => ({
      ...sc,
      flow: (sc?.flow ?? []).flatMap((b) => {
        if (typeof b?.line !== 'string' || lineChars(b.line) <= MAX_LINE_CHARS) return [b];
        return cutLine(b.line).map((line) => ({ ...b, line }));
      }),
    })),
  }));
  return { ...script, episodes };
}

/* ================= 组装：整部剧本 ================= */

export async function assemble({ story, outline, texts } = {}) {
  const s = normalizeStory(story, { genre: story?.genre, episodes: story?.episodes });
  const o = outline ?? {};
  const eps = (Array.isArray(texts) ? texts : [])
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
  if (!eps.length) throw badRequest('还没有任何一集正文：先逐集生成');

  const fullText = [
    renderTitleBlock({ title: s.title, totalEpisodes: eps.length, genre: s.genre }),
    '',
    '## 【故事梗概】',
    s.synopsis,
    '',
    renderCastBlock(s.characters),
    '',
    '---',
    '',
    '# 剧本正文',
    ...eps,
  ].join('\n');

  const parsed = parseScriptText(fullText);
  if (!parsed.ok) throw upstreamError(`整稿解析失败：${parsed.message}`);
  const remap = remapIds(parsed, s, o);

  const script = {
    ...remap.script,
    params: { ...remap.script.params, maxLineChars: 22 },
    episodes: remap.script.episodes.map((e) => {
      const entry = o.episodes?.find((x) => x.ep === e.ep);
      return {
        ...e,
        hook: entry?.hook || e.hook,
        cliff: entry?.suspense || e.cliff,
        beatsClaimed: [...new Set((o.beats ?? []).filter((b) => b.episode === e.ep).map((b) => b.type))],
      };
    }),
  };
  const scriptSplit = splitLongLines(script);

  const gates = [
    ...scriptGates(scriptSplit, { outline: remap.outline }).map((g) => ({ ...g, scope: 'script' })),
    ...outlineGates(remap.outline).map((g) => ({ ...g, scope: 'outline' })),
  ];
  const failed = gates.filter((g) => !g.ok);
  logger.info('scriptgen.assemble', {
    episodes: script.episodes.length, gates: gates.length, failed: failed.map((g) => `${g.scope}:${g.id}`),
  });
  return {
    script: scriptSplit,
    outline: remap.outline,
    text: fullText,
    gates,
    stats: parsed.stats,
    passed: failed.length === 0,
  };
}

/**
 * 把解析出来的角色/场景 id 对到整部剧的簿记上：
 *   - 角色按名字对（小传定的 id）；对不上的是群演桶之类，补登记进 outline
 *   - 场景按名字对（大纲发的 id）；模型即兴加的新场景，顺序补号并登记
 * 少了这一步，单集解析自带的 id 会和整剧大纲对不上，refs-characters 门全挂。
 */
function remapIds(parsed, story, outline) {
  const out = JSON.parse(JSON.stringify(outline ?? {}));
  out.characters = Array.isArray(out.characters) ? out.characters : [];
  out.scenes = Array.isArray(out.scenes) ? out.scenes : [];

  const charIdByName = new Map(out.characters.map((c) => [c.name, c.id]));
  const parsedChars = parsed.outline?.characters ?? [];
  const charRemap = new Map();
  for (const c of parsedChars) {
    const target = charIdByName.get(c.name);
    if (target) { charRemap.set(c.id, target); continue; }
    // 解析里有、大纲没有（群演桶）：补登记，tier 按解析结果
    const nid = `C${String(out.characters.length + 1).padStart(2, '0')}`;
    out.characters.push({ id: nid, name: c.name, role: c.role ?? '群演', tier: c.tier ?? 'functional' });
    charIdByName.set(c.name, nid);
    charRemap.set(c.id, nid);
  }

  const sceneIdByName = new Map(out.scenes.map((s) => [s.name, s.id]));
  const sceneRemap = new Map();
  for (const sc of parsed.outline?.scenes ?? []) {
    const target = sceneIdByName.get(sc.name);
    if (target) { sceneRemap.set(sc.id, target); continue; }
    const nid = `S${String(out.scenes.length + 1).padStart(2, '0')}`;
    out.scenes.push({ id: nid, name: sc.name, primary: out.scenes.length < 2, reusePlan: '' });
    sceneIdByName.set(sc.name, nid);
    sceneRemap.set(sc.id, nid);
  }

  const script = parsed.script;
  script.episodes = script.episodes.map((e) => ({
    ...e,
    scenes: e.scenes.map((sc) => ({
      ...sc,
      sceneId: sceneRemap.get(sc.sceneId) ?? sc.sceneId,
      characters: sc.characters.map((id) => charRemap.get(id) ?? id).filter(Boolean),
      flow: sc.flow.map((b) => (b.speaker ? { ...b, speaker: charRemap.get(b.speaker) ?? b.speaker } : b)),
    })),
  }));

  // 文本里即兴出现的场景/角色（模型加的新场景、群演桶）补进该集的引用：
  // 不补的话 refs 门会报「从未被用到」——它们确实被这一集用了。
  // 只加不减：大纲计划的引用是计划，文本的引用是实拍，两边并集才是这一集的真相
  for (const ep of script.episodes) {
    const planEp = out.episodes.find((e) => e.ep === ep.ep);
    if (!planEp) continue;
    planEp.sceneIds = [...new Set([...planEp.sceneIds, ...ep.scenes.map((s) => s.sceneId)])];
    planEp.characterIds = [...new Set([...planEp.characterIds, ...ep.scenes.flatMap((s) => s.characters)])];
    if (planEp.characterIds.length >= 3 && !planEp.crowdPlan) planEp.crowdPlan = DEFAULT_CROWD_PLAN;
  }

  // 小传里的人必须真的出场：整剧都没被任何一集引用到的（失业角色），
  // 补进人最少的那一集。不补 refs 门必挂，资产层也会给不出场的角色白出一张设定图
  const referenced = new Set(out.episodes.flatMap((e) => e.characterIds ?? []));
  const orphans = out.characters.filter((c) => !referenced.has(c.id));
  for (const c of orphans) {
    const target = out.episodes.reduce((a, b) => ((a.characterIds?.length ?? 0) <= (b.characterIds?.length ?? 0) ? a : b));
    if (!target) continue;
    target.characterIds = [...new Set([...(target.characterIds ?? []), c.id])];
    if ((target.characterIds.length ?? 0) >= 3 && !target.crowdPlan) target.crowdPlan = DEFAULT_CROWD_PLAN;
    logger.info('scriptgen.remap.orphan', { name: c.name, addedTo: target.ep });
  }

  // 只用一次的场景必须带规避方案（once-scene 门）：即兴注册的新场景也一视同仁
  const sceneUse = new Map(out.scenes.map((s) => [s.id, 0]));
  for (const e of out.episodes) for (const id of e.sceneIds ?? []) sceneUse.set(id, (sceneUse.get(id) ?? 0) + 1);
  for (const s of out.scenes) {
    if (sceneUse.get(s.id) === 1 && !s.reusePlan) s.reusePlan = '本剧仅此一场：单布景多角度拍，不出场景板';
  }
  return { outline: out, script };
}
