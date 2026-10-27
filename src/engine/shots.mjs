/* 分镜引擎 v2：15 秒段 + 段内子镜头。
 *
 * 结构：一集 → 多个 15 秒分镜段（segment）→ 每段 3–6 个子镜头（shot，约 3 秒一个）
 *      → 每段输出**一条**可直接喂 15 秒视频模型的提示词（时间轴格式）。
 *
 * 为什么要两级：视频模型单次生成上限 10–15 秒，一镜到底的短提示词管不住 15 秒里
 * 的节奏；按 15 秒一段写时间轴（0-3s / 3-6s …）能让模型按拍子走，段内子镜头
 * 则给人看、给剪辑对、给 I2V 首尾帧用。
 *
 * 模型负责创意（这场戏怎么切、每镜像什么），结构（段号、时长、词表、台词归位、
 * 时间轴完整）全部由这里确定性兜住。
 */
import { lineChars } from './script.mjs';

export const SEG_SECONDS = 15;
export const MAX_SEGMENTS = 12;

/* ---------------- 受控词表 ---------------- */
export const SHOT_SIZES = Object.freeze({
  'extreme-wide': '大远景',
  wide: '远景',
  medium: '中景',
  'medium-close': '中近景',
  'close-up': '特写',
  'extreme-close': '大特写',
  'over-shoulder': '过肩',
  pov: '主观',
});

export const CAMERA_MOVES = Object.freeze({
  static: '固定机位',
  'push-in': '推近',
  'pull-back': '拉远',
  'pan-left': '左摇',
  'pan-right': '右摇',
  'tilt-up': '上摇',
  'tilt-down': '下摇',
  tracking: '跟拍',
  orbit: '环绕',
  crane: '升降',
  handheld: '手持',
  zoom: '变焦',
});

const SIZE_ALIAS = {
  大远景: 'extreme-wide', 远景: 'wide', 全景: 'wide', 中景: 'medium',
  中近景: 'medium-close', 近景: 'medium-close', 特写: 'close-up', 大特写: 'extreme-close',
  过肩: 'over-shoulder', 主观: 'pov', 航拍: 'extreme-wide',
};
const MOVE_ALIAS = {
  固定: 'static', 固定机位: 'static', 静止: 'static', 推: 'push-in', 推近: 'push-in', 缓慢推近: 'push-in',
  拉: 'pull-back', 拉远: 'pull-back', 拉镜头: 'pull-back', 左摇: 'pan-left', 右摇: 'pan-right',
  摇: 'pan-right', 上摇: 'tilt-up', 下摇: 'tilt-down', 跟拍: 'tracking', 跟随: 'tracking',
  环绕: 'orbit', 升降: 'crane', 手持: 'handheld', 手持跟随: 'handheld', 变焦: 'zoom',
};

export const QUALITY_TAIL = '4K 超高清，面部清晰，五官稳定无畸形，人体结构正常比例自然，画面稳定无闪烁无重影';
const MOVE_SPLIT = /[+＋/、,，&]|\band\b/;

export const sizeLabel = (id) => SHOT_SIZES[id] ?? id;
export const moveLabel = (id) => CAMERA_MOVES[id] ?? id;

export function normSize(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'medium';
  const key = s.toLowerCase().replace(/\s+/g, '-');
  if (SHOT_SIZES[key]) return key;
  if (SIZE_ALIAS[s]) return SIZE_ALIAS[s];
  const hit = Object.keys(SHOT_SIZES).find((k) => SHOT_SIZES[k] === s);
  return hit ?? 'medium';
}

export function normMove(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'static';
  const first = s.split(MOVE_SPLIT)[0].trim();
  const key = first.toLowerCase().replace(/\s+/g, '-');
  if (CAMERA_MOVES[key]) return key;
  if (MOVE_ALIAS[first]) return MOVE_ALIAS[first];
  const hit = Object.keys(CAMERA_MOVES).find((k) => CAMERA_MOVES[k] === first);
  return hit ?? 'static';
}

/* ---------------- 归一化 ---------------- */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const asText = (v) => (typeof v === 'string' ? v.trim() : '');
const r1 = (n) => Math.round(n * 10) / 10;

export function buildAnchors(outline) {
  const anchors = new Map();
  for (const c of outline?.characters ?? []) {
    // look 里不能带名字：群演桶的 desc 以「群演」开头，会把 no-name 门顶掉；
    // 桶的 desc 是资产层写死的说明，对分镜没有信息量，直接换成「群演/宾客」
    const bucket = c.name === '群演';
    const desc = bucket ? '' : (c.desc ?? '').split(/[。；;]/)[0]?.slice(0, 24) ?? '';
    const look = bucket
      ? '（群演/宾客）'
      : [c.role ? `（${c.role}）` : '', desc].filter(Boolean).join('').split(c.name ?? '\u0000').join('').replace('（）', '');
    anchors.set(c.id, { name: c.name, anchor: `${c.name}${look}`, look });
  }
  return anchors;
}

/** 从识别结果建 anchors：名字 + 未命名/身份短语（提示词里只出现编号） */
export function anchorsFromCast(cast) {
  const m = new Map();
  for (const c of cast?.characters ?? []) {
    const look = c.unnamed ? `（${c.name}）` : `（${c.role || '角色'}）`;
    m.set(c.id, { name: c.name, anchor: `${c.name}${look}`, look });
  }
  return m;
}

const nameToId = (outline) => {
  const m = new Map();
  for (const c of outline?.characters ?? []) if (c?.name) m.set(c.name, c.id);
  return m;
};
const idOf = (v) => {
  const s = String(v ?? '').trim();
  return /^C\d{2,}$/.test(s) ? s : '';
};

/** 子镜头：一镜一个主动作、一个运镜、2–5 秒 */
function normalizeShot(r, { segIndex, k, ep, names, defaultSec }) {
  const castIn = Array.isArray(r?.cast) ? r.cast : [r?.speaker];
  const cast = [...new Set(castIn.map((x) => idOf(x) || names.get(String(x ?? '').trim()) || '').filter(Boolean))];
  const speaker = idOf(r?.speaker) || names.get(String(r?.speaker ?? '').trim()) || cast[0] || '';
  const motion = (Array.isArray(r?.motion) ? r.motion : String(r?.motion ?? '').split(/[,，、]/))
    .map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 5);
  return {
    id: `E${String(ep).padStart(2, '0')}-G${String(segIndex).padStart(2, '0')}-${String(k).padStart(2, '0')}`,
    index: k,
    sec: r1(clamp(Number(r?.sec) || defaultSec, 1, 8)),
    size: normSize(r?.size),
    move: normMove(r?.move ?? r?.camera),
    visual: asText(r?.visual ?? r?.description ?? r?.frame),
    speaker,
    cast,
    line: asText(r?.line ?? r?.dialogue),
    tone: asText(r?.tone),
    motion,
    lighting: asText(r?.lighting ?? r?.light),
    env: asText(r?.env ?? r?.environment),
    props: Array.isArray(r?.props) ? r.props.map(String).filter(Boolean) : [],
  };
}

/**
 * 模型返回 → 合法段数组。兼容三种形状：
 *   {segments:[{shots:[...]}]} / {shots:[...]}（按 5 个一组合并）/ 直接数组
 */
export function normalizeSegments(raw, { ep = 1, episode = null, outline = null, anchors = null, cast = null } = {}) {
  const names = cast?.characters?.length
    ? new Map(cast.characters.flatMap((c) => [[c.name, c.id], ...(c.aliases ?? []).map((a) => [a, c.id])]))
    : nameToId(outline);
  const anchorMap = anchors ?? buildAnchors(outline);
  const sceneCount = Math.max(1, episode?.scenes?.length ?? 1);

  let groups = [];
  if (Array.isArray(raw?.segments)) groups = raw.segments;
  else if (Array.isArray(raw)) groups = raw;
  else if (Array.isArray(raw?.shots)) {
    // 模型只给了平铺镜头：每 5 个合成一个 15 秒段
    groups = [];
    for (let i = 0; i < raw.shots.length; i += 5) groups.push({ shots: raw.shots.slice(i, i + 5) });
  }

  return groups.slice(0, MAX_SEGMENTS).map((g, gi) => {
    const segIndex = gi + 1;
    const rawScene = Number(g?.sceneIndex ?? g?.scene ?? 1);
    const sceneIndex = clamp(Number.isFinite(rawScene) ? Math.round(rawScene) : 1, 1, sceneCount);
    const rawShots = Array.isArray(g?.shots) ? g.shots : Array.isArray(g?.cuts) ? g.cuts : [];
    const sec = r1(clamp(Number(g?.sec) || SEG_SECONDS, 10, 16));
    const defaultSec = r1(Math.min(5, Math.max(2, sec / Math.max(1, rawShots.length))));
    const shots = rawShots.slice(0, 6).map((s, si) => normalizeShot(s, { segIndex, k: si + 1, ep, names, defaultSec }));
    const cast = [...new Set(shots.flatMap((s) => s.cast))];
    const seg = {
      id: `E${String(ep).padStart(2, '0')}-G${String(segIndex).padStart(2, '0')}`,
      index: segIndex,
      sceneIndex,
      sec,
      beat: asText(g?.beat),
      env: asText(g?.env ?? g?.environment ?? shots.find((s) => s.env)?.env),
      lighting: asText(g?.lighting ?? g?.light ?? shots.find((s) => s.lighting)?.lighting),
      cast,
      shots,
      blocking: asText(g?.blocking),
      refs: { C: cast, S: [`S${String(sceneIndex).padStart(2, '0')}`], P: [] },
      prompt: asText(g?.prompt),
    };
    if (!seg.prompt) seg.prompt = renderSegmentPrompt(seg, { anchors: anchorMap, sceneName: episode?.scenes?.[sceneIndex - 1]?.name });
    return seg;
  });
}

/** 段提示词：按「视频约束 / 场景 / 人物 / 道具 / 站位 / 镜头1-N」的摄制单结构输出 */
export function renderSegmentPrompt(seg, { anchors = new Map(), sceneName = '', prevSeg = null } = {}) {
  const shots = seg.shots ?? [];
  const n = shots.length;
  const castIds = seg.cast ?? [];
  const nameOf = (id) => anchors.get(id)?.name ?? id;
  const castRows = castIds.map((id) => {
    const a = anchors.get(id);
    const look = a?.look ? a.look.replace(/^（|）$/g, '') : '角色';
    return `@[${id}_${nameOf(id)}-初始版] 是 ${nameOf(id)}（${look}）`;
  });
  const unnamedIds = castIds.filter((id) => /群演|保姆|护士|医生|助理|秘书|保安|司机|宾客|路人|管家|警察/.test(nameOf(id)));
  const outIds = [...new Set([...anchors.keys()].filter((id) => !castIds.includes(id)))].slice(0, 6);

  // 站位：模型给了就用，没给按出场顺序左右分
  const [lead, rival] = castIds;
  const blocking = seg.blocking
    || (castIds.length >= 2
      ? `${nameOf(lead)} 在画面左侧（面朝右）；${nameOf(rival)} 在画面右侧（面朝左）；两人相距约一臂，轴线不越、不镜像翻转。`
      : `${nameOf(lead) ?? '主体'} 居于画面中央偏左，面朝画面右侧。`);

  const prevLine = prevSeg
    ? `紧接上一段末 —— ${(prevSeg.shots ?? []).slice(-1)[0]?.visual ?? '上一段收尾动作'}；本段从该状态延续。`
    : '本段为本集开段，从场景建立镜起。';

  const propLine = (shots.flatMap((x) => x.props ?? []).filter(Boolean).length)
    ? `关键道具：${[...new Set(shots.flatMap((x) => x.props ?? []))].join('、')}；位置与光泽全程不变，只在指定镜头发生一次接触。`
    : '本段无关键道具；人物手部状态按各镜说明保持，不凭空出现物件。';

  // env 只保留「地点 + 环境」，人物动作/站位交给镜头，避免「构图」里重复整句
  const envClean = String(seg.env || '室内场景').split('；')[0].split(/[，,]/)[0];
  const lightClean = String(seg.lighting || '自然光').split('，')[0];

  const lines = [
    '[视频约束]',
    '1. 画面中禁止出现任何形式的字幕、文字与水印',
    '2. 禁止生成背景音乐、BGM、配乐与氛围音乐',
    `3. 画质：${'4K 超高清，面部清晰，五官稳定无畸形，人体结构正常，画面稳定无闪烁无重影'}`,
    '',
    '[场景设定]',
    `@<图1> ${envClean}；${lightClean}`,
    `@<图2> ${sceneName || `第 ${seg.sceneIndex} 场`}`,
    '',
    '[人物设定]',
    ...(castRows.length ? castRows : ['@[主体-初始版] 是 主体']),
    ...(unnamedIds.length ? [`（未命名角色：${unnamedIds.map(nameOf).join('、')}，按身份设定外观，不编造姓名）`] : []),
    '',
    '[道具设定]',
    propLine,
    '',
    `## 第${seg.index ?? 1}段・站位设定（镜头 1-${n} 共用锚点）`,
    `- **衔接说明**：${prevLine}`,
    `- **构图**：${blocking}`,
    `- **背景**：${envClean}；段内全程不换景。`,
    `- **位置锚点**：${sceneName || `第 ${seg.sceneIndex} 场`}；机位在本段全程一致，禁止左右镜像翻转。`,
    `- **前景**：画面下缘虚化的地面或桌面。`,
    `- **道具锚点**：${propLine}`,
    `- **角色范围**：镜头内只出现 ${castIds.map(nameOf).join('、') || '主体'}${outIds.length ? `；${outIds.map(nameOf).join('、')} 不入画` : ''}。`,
    `- **光线连续性**：${lightClean} 全程一致，受光面与阴影位置不跳变。`,
    '',
  ];

  shots.forEach((s, i) => {
    const who = (s.cast ?? []).map(nameOf).join('、') || nameOf(castIds[0]) || '主体';
    const dialogue = s.line
      ? `${nameOf(s.speaker) || who}（${s.tone || '按原文语气'}）：「${s.line}」`
      : '[无台词]';
    const guard = [
      s.line ? '台词原文照读、口型同步' : '',
      '服装与配饰全程一致，不出现第二套',
      '画面内不出现拍摄设备、工作人员与多余人物',
    ].filter(Boolean).join('；');
    lines.push(
      `## 第${seg.index ?? 1}段・镜头 ${i + 1} 【${sizeLabel(s.size)}・${moveLabel(s.move)}】`,
      `- **时长**：${s.sec}s（本段合计 ${seg.sec}s）`,
      `- **运镜角度**：${moveLabel(s.move)}，${sizeLabel(s.size)}${i === 0 ? '，承接上一段尾帧' : `，与镜头 ${i} 同向、不越轴`}`,
      `- **动作表情**：${s.visual || '按剧本动作'}${s.motion?.length ? `；运动：${s.motion.join('、')}` : ''}`,
      `- **台词**：${dialogue}`,
      `- **防穿帮**：${guard}。`,
      '',
    );
  });

  return lines.join('\n').trim();
}

/* ---------------- 结构门（11 条） ---------------- */
export function gateReport(segments, { episode = null, outline = null, cast = null } = {}) {
  const gates = [];
  const add = (id, label, ok, detail = '') => gates.push({ id, label, ok, detail });
  const segs = Array.isArray(segments) ? segments : [];
  const shots = segs.flatMap((s) => s.shots ?? []);
  // 「群演」是桶标签不是人名：提示词里写它不算违规
  // 只拦"人名"：护士/保姆这类未命名角色写身份词是正常的，不算违规
  const names = (cast?.characters?.length
    ? cast.characters.filter((c) => !c.unnamed).map((c) => c.name)
    : (outline?.characters ?? []).map((c) => c?.name))
    .filter((n) => n && n.length >= 2 && n !== '群演');
  const sceneCount = Math.max(1, episode?.scenes?.length ?? 1);

  add('seg-count', `段数 1–${MAX_SEGMENTS}`, segs.length >= 1 && segs.length <= MAX_SEGMENTS, `${segs.length} 段`);

  const badSegLen = segs.filter((s) => !(s.sec >= 14 && s.sec <= 16));
  add('seg-sec', '每段 14–16 秒（目标 15s）', badSegLen.length === 0, badSegLen.slice(0, 3).map((s) => `${s.id} ${s.sec}s`).join('；'));

  const badCount = segs.filter((s) => (s.shots ?? []).length < 3 || (s.shots ?? []).length > 6);
  add('sub-count', '每段 3–6 个子镜头', badCount.length === 0, badCount.slice(0, 3).map((s) => `${s.id} ${(s.shots ?? []).length}镜`).join('；'));

  const badSum = segs.filter((s) => Math.abs((s.shots ?? []).reduce((n, x) => n + (Number(x.sec) || 0), 0) - s.sec) > 1.5);
  add('sub-sec', '子镜头时长合计 = 段时长（±1.5s）', badSum.length === 0,
    badSum.slice(0, 3).map((s) => `${s.id} 子镜合计 ${r1((s.shots ?? []).reduce((n, x) => n + (Number(x.sec) || 0), 0))}s / 段 ${s.sec}s`).join('；'));

  const badSize = shots.filter((s) => !SHOT_SIZES[s.size]);
  add('size', '景别在受控词表内', badSize.length === 0, badSize.slice(0, 3).map((s) => s.id).join('、'));

  const badMove = shots.filter((s) => !CAMERA_MOVES[s.move]);
  add('camera', '运镜在受控词表内且单值', badMove.length === 0, badMove.slice(0, 3).map((s) => s.id).join('、'));

  const covered = new Set(segs.map((s) => s.sceneIndex));
  const missing = [];
  for (let i = 1; i <= sceneCount; i += 1) if (!covered.has(i)) missing.push(i);
  add('coverage', '每场至少 1 段', missing.length === 0, missing.length ? `第 ${missing.join('、')} 场没有镜头` : '');

  // 台词归位：缺句按「归一化文本」查，重复按「说话人 + 台词」查。
  // 长独白常被模型拆成两三句说，所以按「前 12 字是否出现」判在不在，而不是逐字全等。
  const norm = (t) => String(t ?? '').replace(/[\s，。！？；：、,.!?;:"“”「」『』—…]/g, '');
  const keyOf = (speaker, line) => `${speaker ?? ''}|${norm(line)}`;
  const wantLines = new Map(); // norm → 原句
  const wantPairs = new Map();
  for (const sc of episode?.scenes ?? []) {
    for (const b of sc.flow ?? []) {
      const text = typeof b?.line === 'string' ? b.line.trim() : '';
      if (!text) continue;
      wantLines.set(norm(text), text);
      const k = keyOf(b.speaker, text);
      wantPairs.set(k, (wantPairs.get(k) ?? 0) + 1);
    }
  }
  const gotLines = new Set();
  const gotPairs = new Map();
  for (const s of shots) {
    if (!s.line) continue;
    gotLines.add(norm(s.line));
    if (!s.speaker) continue;
    const k = keyOf(s.speaker, s.line);
    gotPairs.set(k, (gotPairs.get(k) ?? 0) + 1);
  }
  const allNorm = [...gotLines].join('\n');
  const lost = [...wantLines.entries()]
    .filter(([n, raw]) => !gotLines.has(n) && !(n.length >= 12 && allNorm.includes(n.slice(0, 12))))
    .map(([, raw]) => raw);
  const dup = [...gotPairs.entries()]
    .filter(([k, n]) => n > (wantPairs.get(k) ?? 0) && n > 1)
    .map(([k]) => k.split('|')[1].slice(0, 16));
  add('line-once', '每句台词都落进镜头且不重复', lost.length === 0 && dup.length === 0,
    [lost.length ? `缺 ${lost.length} 句（${lost.slice(0, 2).join(' / ')}）` : '', dup.length ? `多出 ${dup.length} 句（${dup.slice(0, 2).join(' / ')}）` : ''].filter(Boolean).join('；'));

  // 子镜头字段：画面 / 动作 / 光线 缺一个，这一镜就拍不出来
  const thin = shots.filter((s) => lineChars(s.visual) < 4 || (s.motion ?? []).length === 0 || !s.lighting);
  add('sub-fields', '子镜头有画面/动作/光线', thin.length === 0, thin.slice(0, 3).map((s) => s.id).join('、'));

  // no-name 只查子镜头的 visual（画面描述）：
  // 视频模型只会照 visual 编脸，prompt 里的「人物设定」「站位设定」写名字是合法引用。
  // 台词是剧情，不算违规（引号内人名不查）。
  const nameHits = [];
  for (const s of segs) {
    for (const x of s.shots ?? []) {
      const visual = String(x.visual ?? '').replace(/「[^」]*」/g, '').replace(/“[^”]*”/g, '');
      for (const n of names) if (visual.includes(n)) nameHits.push(`${x.id} 含「${n}」`);
    }
  }
  add('no-name', '画面描述不出现角色名', nameHits.length === 0, nameHits.slice(0, 3).join('；'));

  // 段提示词必须是摄制单结构：视频约束 / 站位 / 逐镜四件套
  const badStruct = segs.filter((s) => {
    const t = String(s.prompt);
    return !t.includes('[视频约束]') || !t.includes('站位设定')
      || (t.match(/## 第\d+段・镜头 \d+/g) ?? []).length !== (s.shots ?? []).length
      || (t.match(/\*\*防穿帮\*\*/g) ?? []).length < (s.shots ?? []).length;
  });
  add('structure', '段提示词含视频约束/站位/逐镜四件套', badStruct.length === 0, badStruct.slice(0, 3).map((s) => s.id).join('、'));

  const badLen = segs.filter((s) => lineChars(s.prompt) < 120 || lineChars(s.prompt) > 2600);
  const noQuality = segs.filter((s) => !/4K|超清|稳定|无变形|无闪烁/.test(s.prompt));
  add('prompt-len', '段提示词 120–2600 字且带质量约束', badLen.length === 0 && noQuality.length === 0,
    [...badLen.slice(0, 2).map((s) => `${s.id} ${lineChars(s.prompt)}字`), ...noQuality.slice(0, 2).map((s) => `${s.id} 缺质量约束`)].join('；'));

  return gates;
}

/* ---------------- 确定性降级：模型挂了也要有 15 秒段 ---------------- */
/**
 * 一拍一镜 → 每 5 镜（或满 15s）合成一段。台词一句不丢，段/子镜编号合法，
 * 段提示词按时间轴拼出来，保证下游能继续用。
 */
export function deterministicSegments(episode, outline, { ep = 1, cast = null } = {}) {
  const anchors = cast?.characters?.length ? anchorsFromCast(cast) : buildAnchors(outline);
  const castByName = new Map((cast?.characters ?? []).map((c) => [c.name, c.id]));
  const castIdOf = (beat, fallbackId) => {
    const raw = String(beat?.delivery ?? '').replace(/（[^）]*）/g, '').trim().split(/[\s　]+/)[0] ?? '';
    return castByName.get(raw) || fallbackId || '';
  };
  const atomic = [];
  const sceneOf = (si) => si + 1;

  (episode?.scenes ?? []).forEach((sc, si) => {
    let pending = null;
    const flush = () => { if (pending) { atomic.push(pending); pending = null; } };
    for (const b of sc.flow ?? []) {
      if (typeof b?.line === 'string' && b.line.trim()) {
        flush();
        const speaker = castIdOf(b, b.speaker) || '';
        atomic.push({
          sceneIndex: sceneOf(si), sec: clamp(Math.max(2, lineChars(b.line) / 4.2), 2, 6),
          size: 'medium-close', move: 'static', visual: `${anchors.get(speaker)?.name ?? '人物'}开口说话`,
          speaker, cast: speaker ? [speaker] : [], line: b.line.trim(), motion: ['mouth moves', 'slight head movement'],
          lighting: sc.lighting ?? '室内柔光', env: sc.name ?? '',
        });
        continue;
      }
      if (typeof b?.action === 'string' && b.action.trim() && !/^【黑屏】|^【钩子字幕】/.test(b.action)) {
        const text = b.action.trim();
        if (pending && (pending.visual + text).length < 48) {
          pending.visual += `，${text}`;
          pending.sec = clamp(pending.sec + 2.5, 1, 6);
        } else {
          flush();
          pending = {
            sceneIndex: sceneOf(si), sec: 2.5, size: 'medium', move: 'static', visual: text,
            speaker: '', cast: [], line: '', motion: ['subject moves slightly'],
            lighting: sc.lighting ?? '室内柔光', env: sc.name ?? '',
          };
        }
      }
    }
    flush();
  });

  const segments = [];
  let bucket = [];
  let sum = 0;
  const flushSeg = () => {
    if (!bucket.length) return;
    const idx = segments.length + 1;
    const shots = bucket.map((s, k) => ({
      ...s,
      id: `E${String(ep).padStart(2, '0')}-G${String(idx).padStart(2, '0')}-${String(k + 1).padStart(2, '0')}`,
      index: k + 1,
    }));
    const seg = {
      id: `E${String(ep).padStart(2, '0')}-G${String(idx).padStart(2, '0')}`,
      index: idx,
      sceneIndex: shots[0]?.sceneIndex ?? 1,
      sec: r1(shots.reduce((n, s) => n + s.sec, 0)),
      beat: '',
      env: shots.find((s) => s.env)?.env ?? '',
      lighting: shots.find((s) => s.lighting)?.lighting ?? '',
      cast: [...new Set(shots.flatMap((s) => s.cast))],
      shots,
      refs: { C: [...new Set(shots.flatMap((s) => s.cast))], S: [`S${String(shots[0]?.sceneIndex ?? 1).padStart(2, '0')}`], P: [] },
      prompt: '',
    };
    seg.prompt = renderSegmentPrompt(seg, { anchors });
    segments.push(seg);
    bucket = [];
    sum = 0;
  };

  for (const a of atomic) {
    if (bucket.length >= 5 || (sum + a.sec > SEG_SECONDS + 1 && bucket.length >= 3)) flushSeg();
    bucket.push(a);
    sum += a.sec;
  }
  flushSeg();
  return segments;
}

/** 统计：给页面与导出用 */
export function boardStats(segments) {
  const segs = segments ?? [];
  const shots = segs.flatMap((s) => s.shots ?? []);
  return {
    segments: segs.length,
    shots: shots.length,
    seconds: Math.round(segs.reduce((n, s) => n + (Number(s.sec) || 0), 0) * 10) / 10,
    scenes: new Set(segs.map((s) => s.sceneIndex)).size,
  };
}

/** 平铺子镜头（导出 JSON / 下游按镜消费时用） */
export function flattenShots(segments) {
  return (segments ?? []).flatMap((s) => (s.shots ?? []).map((x) => ({ ...x, segId: s.id, segSec: s.sec })));
}
