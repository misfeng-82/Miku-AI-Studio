/* 剧本导入：把「人写的剧本文本」或「导出的 JSON」转成引擎契约（script + outline）。
 *
 * 为什么放在 public/：这一步在浏览器里做完，再交给后端已有的评估 / 优化接口 ——
 * 后端本来就支持直接传 script/outline（见 src/routes/api.js 的 resolveScript），
 * 所以不需要新增接口。本文件不碰 DOM，可以在 node 里直接单测（scripts/probe-import.mjs）。
 *
 * 支持的文本形态（按行扫，容错优先）：
 *
 *   A. 都市涅槃标准稿（AI 短剧格式，见 src/assets/scriptSpec.js）：
 *      # 标题 + > 格式说明            → 跳过（标题/题材信息进 outline）
 *      ## 【故事梗概】                → 前载：一段式梗概
 *      ## 【人物小传】**名字｜身份**   → 前载：角色表（名字/定位/小传）
 *      # 剧本正文 / ## 第N集           → 分集（## 与 # 前缀都认）
 *      场N‑M 时间 内外 场景名          → 分场（连字符认 U+2011 ‑，也认普通 -）
 *      人物：A、B、C                  → 本场出场人物（括号备注如 (通讯VO) 剥掉）
 *      △ 开头                          → 动作/画面（一个 △ 一个动作）
 *      角色名：台词 / 角色名+方式：台词  → 台词（方式进 delivery；OS/VO 是方式的一种）
 *      【闪回】【闪出】【音效】…        → 原样当动作（转场/音效标记要留给下游）
 *      【钩子字幕】xxx                 → 本集 cliff（卡点），不进 flow
 *      【黑屏】第N集完                 → 集尾标记，当动作保留
 *
 *   B. 松散格式（老口径，保持兼容）：
 *      第1集 / 第一集 / EP1 / E01        → 分集
 *      场1-2 夜 内 渡口·码头 / S01 / 场景1 → 分场（顺手抽出 夜/日 与场地名）
 *      角色名：台词  /  角色名（冷冷地）：台词 → 台词（括号里的进 delivery）
 *      其他非空行                          → 动作（叙述体）
 *
 * 目标时长不猜：按引擎的计秒口径（动作 2.5 秒 + 台词 字数/4.5）从内容反算，
 * 这样时长门（比的是这一集的估时总秒数）天然对得上。
 *
 * 角色分层是确定性规则，不靠模型：小传定位（女主/男主/反派→主角组）> 出场集数
 * （≥2 集→重要配角，只出现 1 集→群演桶）。引擎大纲门对主角组/配角/功能性角色
 * 有 5/10/10 的人数上限，一部 40 集短剧的泛泛配角全列名字会直接爆门——
 * 桶进「群演」一个功能性角色，既守门，也让资产层少生成几十张用不上的参考图。
 */

/* 格式标识：与 src/assets/scriptSpec.js 的 FORMAT_ID 保持一致（同一字符串写两遍是
 * 故意的——浏览器只能拿 public/ 下的文件，跨目录 import 会被静态服务 403 拦掉）。
 * 改这里记得同步改那边。 */
const FORMAT_ID = 'chengdu-nirvana';

const ACTION_SECONDS = 2.5;
const CHARS_PER_SECOND = 4.5;

const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 中文/阿拉伯数字（1–99），认不出返回 null */
export function toNumber(s) {
  const t = String(s ?? '').trim();
  if (/^\d+$/.test(t)) return Number(t);
  const ten = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(t);
  if (ten) return (ten[1] ? CN[ten[1]] : 1) * 10 + (ten[2] ? CN[ten[2]] : 0);
  return CN[t] ?? null;
}

// 集标题：第1集 / 第一集 / EP1 / E01，容忍 markdown 的 # 前缀与集名后缀（## 第1集 酒会决裂）
const EP_RE = /^\s*#*\s*(?:第\s*([0-9一二三四五六七八九十]+)\s*集|EP\s*0*([0-9]+)|E0*([0-9]+))\s*(?:[：:、.。\-–—]\s*)?(.*)$/i;
// 纯章节头（# 剧本正文 / ## 第二幕）：不是集也不是场，跳过
const SECTION_RE = /^\s*#{1,4}\s*\S/;
// 场号行：场1-1 夜 内 渡口·码头；连字符兼容 U+2011（都市涅槃格式用的就是它）
const SCENE_RE = /^\s*#*\s*(?:场\s*([0-9一二三四五六七八九十]+)\s*[-\u2011\u2010\u2013\u2014]\s*([0-9一二三四五六七八九十]+)?|S0*([0-9]+)|SCENE\s*0*([0-9]+)|场景\s*0*([0-9]+))/i;
// 出场人物行：人物：A、B、C（也认 出场人物：/ 角色：）
const CAST_RE = /^\s*(?:出场)?(?:人物|角色|演员)\s*[:：]\s*(.+)$/;
// 台词行：角色名：台词（前缀可带括号备注）
const DIALOGUE_RE = /^\s*([^：:（(【\[]{1,14})\s*(?:[（(]([^）)]{0,12})[）)])?\s*[：:]\s*(.+)$/;
// 说话人前缀里出现这些字，基本是叙述句而不是人名：她低声道：… / 他转身说：…
const NOT_A_NAME = /[的了着把被在，。！？、；]|说|道|喊|叫|问|答|看|望|走|来|笑|哭|怒|冷|低|轻|猛|忽|顿|沉|咬|抬|转|推|拉|抱|抓|挥|点|摇|叹|愣|怔/;
// 群演标签：这些是「在场但不用给名字」的人群称呼，不进角色表
const GROUP_RE = /(若干|众人|人群|来宾|保镖若干|侍者若干|们$|^宾客$|^客人$|^路人$)/;
// 集尾卡点：【钩子字幕】xxx → 本集 cliff
const HOOK_RE = /^【钩子字幕】\s*(.+)$/;
// 整行都是【…】标记（闪回/闪出/音效/黑屏/字幕…）：原样保留当动作，标记留给下游
const MARKER_RE = /^【[^】]{1,12}】/;
// 「字幕：xxx」「音效：xxx」这类元素行不是台词，是画面/声音标注
const ELEMENT_SPEAKERS = new Set(['字幕', '音效', '画面', '旁白', '标题', '备注']);

/**
 * 方式词表：都市涅槃格式的台词前缀是「角色名+方式」，
 * 如 宾客A小声议论 / 商界大佬A低语 / 苏清鸢OS / 顾景琛崩溃 VO。
 * 已知角色名优先整段匹配；认不出名字时，按「第一个方式词出现的位置」切分。
 * 只收「不会出现在人名里」的词。
 */
const MANNER_WORDS = [
  'OS', 'VO', '画外音', '心声', '独白', '通讯', '通话', '颤音', '气声',
  '压低声音', '压低嗓音', '提高音量', '一字一句', '轻声细语', '故作', '故意', '刻意',
  '小声', '低声', '轻声', '柔声', '冷声', '高声', '大声', '齐声', '恭敬', '沉声', '闷声', '尖声', '厉声', '粗声', '温和', '平静', '轻快', '深情', '温柔', '冷淡', '冷漠', '急切', '焦急',
  '嘲讽', '冷笑', '嗤笑', '轻笑', '苦笑', '大笑', '奸笑', '假笑', '嬉笑', '含笑', '微笑', '脸红', '含泪', '忍泪', '垂泪', '板着脸', '冷着脸',
  '哽咽', '颤抖', '喘息', '急促', '呼吸加重', '呼吸微促', '愤怒', '痛苦', '虚弱', '惊慌', '慌忙', '不安', '惶恐', '崩溃', '哭喊', '尖叫', '凄厉', '惊呼', '震惊', '惊叹', '好奇', '玩味', '迟疑', '犹豫', '坚定', '决绝', '不忍', '不屑', '不满',
  '补充', '宣布', '警告', '试探', '询问', '感慨', '叹息', '叹气', '哀求', '恳求', '吩咐', '命令', '应声', '附和', '起哄', '议论', '低语', '耳语', '暗自', '喃喃', '嘟囔', '咬牙', '含糊', '嘶哑', '大喊', '怒吼', '高声',
  '对着', '看向', '望着', '盯着', '朝向', '朝着', '搂住', '拉住', '挽住', '靠在', '站在', '转身', '转头', '回头', '走过来', '走上前', '走近', '逼近', '靠近', '凑近', '俯身', '蹲下', '跪下', '起身', '站起', '坐下', '抬手', '伸手', '挥手', '点头', '摇头', '抬眼', '抬眸', '垂眼', '挑眉', '皱眉', '眯眼', '对视', '咬牙切齿', '冷冷', '缓缓', '慢慢', '轻轻', '微微', '紧紧', '死死', '猛地', '突然', '忽然', '顿时', '瞬间', '立刻', '立即', '终于', '果然', '竟然', '居然',
];

const isSpeakerName = (s) => {
  const t = String(s ?? '').trim();
  return t.length >= 1 && t.length <= 8 && !NOT_A_NAME.test(t);
};

/** 场次头里抽时间/内外/场地名：「夜 内 渡口·码头」→ 夜景 / 渡口·码头 */
function sceneMeta(headerLine) {
  const rest = String(headerLine).replace(SCENE_RE, '').replace(/^[\s:：、.。-]+/, '').trim();
  const tokens = rest.split(/[\s　]+/).filter(Boolean);
  let lighting = '';
  const nameParts = [];
  for (const tk of tokens) {
    if (/^(夜|夜景|晚上|深夜)$/.test(tk)) { lighting = '夜景'; continue; }
    if (/^(日|白天|日景|晨|早|清晨|上午|下午|正午)$/.test(tk)) { lighting = '日景'; continue; }
    if (/^(黄昏|傍晚|暮色)$/.test(tk)) { lighting = '黄昏'; continue; }
    if (/^(内|外|内外|内景|外景)$/.test(tk)) continue;
    nameParts.push(tk);
  }
  return { name: nameParts.join(' ') || '未命名场地', lighting: lighting || '日景' };
}

/** 内容估秒：与引擎 estimateSeconds 同一口径 */
function estimateSeconds(flow) {
  let total = 0;
  for (const b of flow ?? []) {
    if (typeof b.line === 'string') total += b.line.replace(/\s+/g, '').length / CHARS_PER_SECOND;
    else if (typeof b.action === 'string') total += ACTION_SECONDS;
  }
  return Math.round(total * 10) / 10;
}

/** 已经是契约 JSON（粘贴导出的 json）就直接用 */
function tryJson(raw) {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  let data;
  try { data = JSON.parse(t); } catch { return null; }
  const script = Array.isArray(data) ? { source: '导入的剧本', episodes: data } : (data.script ?? data);
  if (!script || !Array.isArray(script.episodes)) return null;
  const outline = Array.isArray(data) ? null : (data.outline ?? null);
  return { source: script.source ?? '导入的剧本', script, outline, from: 'json' };
}

/* ------------------------------------------------------------------ */
/* 前载：故事梗概 + 人物小传                                            */
/* ------------------------------------------------------------------ */

/** 小传条目里常见的关系前缀：「苏父苏明远」→ { name:'苏明远', role:'苏父' } */
const REL_PREFIX = /^(苏父|苏母|父亲|母亲|爸爸|妈妈|助理|秘书|管家|司机|保镖|医生|律师|老师|总裁|董事长|总经理|队长|警官|师父|弟子|师兄|师姐|师弟|师妹|兄弟|姐妹|丫鬟|小厮|嬷嬷|公公|王爷|皇子|公主|皇后|皇上|太后|太傅|首领|舵主|帮主|堂主|楼主|掌门|府尹|城主|探长|少爷|小姐|夫人|老板|助手|同伴|战友|邻居|室友|同学|同事|前任|未婚妻|未婚夫|前妻|前夫)([\u4e00-\u9fa5]{2,4})$/;

/**
 * 小传一条里可能写两个人：「苏父苏明远、苏母温岚」。
 * 拆成 [{name, role, desc}]，关系前缀（苏父/助理…）当定位，没有就继承条目的 ｜定位。
 */
function expandCastEntry(entry) {
  const out = [];
  for (const part of String(entry.name ?? '').split(/[、，和]/)) {
    const p = part.trim();
    if (!p) continue;
    const m = REL_PREFIX.exec(p);
    if (m) out.push({ name: m[2], role: m[1], desc: entry.desc });
    else out.push({ name: p, role: entry.role, desc: entry.desc });
  }
  return out;
}

/**
 * 解析「# 剧本正文」之前的部分。
 * @returns {{title:string, genre:string, synopsis:string, cast:[{name,role,desc}]}}
 */
export function parsePreamble(lines) {
  const out = { title: '', genre: '', synopsis: '', cast: [] };
  let mode = ''; // '' | synopsis | cast
  let cur = null;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    // 标题只认一级标题（# AI短剧《都市涅槃》40集原创剧本），且不重复覆盖；
    // 「## 【人物小传】」这种二级节名不是标题
    if (/^#\s+\S/.test(t) && !/^#\s*【/.test(t) && !/^#\s*剧本正文/.test(t) && !out.title) {
      out.title = t.replace(/^#+\s*/, '').trim();
      continue;
    }
    if (/^>\s*题材\s*[:：]/.test(t)) { out.genre = t.replace(/^>\s*题材\s*[:：]\s*/, '').replace(/[，,。].*$/, '').trim(); continue; }
    if (t.startsWith('>')) continue;
    if (/^[-—]{3,}$/.test(t)) continue;
    if (/^#{1,3}\s*【?故事梗概】?/.test(t)) { mode = 'synopsis'; cur = null; continue; }
    if (/^#{1,3}\s*【?人物小传】?/.test(t)) { mode = 'cast'; cur = null; continue; }
    if (/^#{1,3}\s*【?(世界观|设定|主题)】?/.test(t)) { mode = ''; continue; }
    const mCast = /^\*\*(.+?)\*\*$/.exec(t);
    if (mCast) {
      const inner = mCast[1];
      const bar = inner.split(/[｜|]/);
      cur = { name: (bar[0] ?? '').trim(), role: (bar[1] ?? '').trim(), desc: '' };
      out.cast.push(cur);
      continue;
    }
    if (mode === 'synopsis') out.synopsis += (out.synopsis ? '\n' : '') + t;
    else if (mode === 'cast' && cur) cur.desc += (cur.desc ? '' : '') + t;
  }
  out.synopsis = out.synopsis.trim();
  return out;
}

/* ------------------------------------------------------------------ */
/* 台词前缀拆分：角色名 + 方式                                            */
/* ------------------------------------------------------------------ */

/**
 * 把「顾景琛对着身边宾客」拆成 { name:'顾景琛', manner:'对着身边宾客' }。
 * 顺序：① 括号备注 ② 已知角色名最长前缀 ③ 方式词切分 ④ 整段当名字（短且干净）。
 */
function splitSpeaker(prefix, knownNames) {
  const p = String(prefix ?? '').trim();
  if (!p) return null;

  // ① 括号备注：苏清鸢（生气）→ name=苏清鸢, manner=生气
  const mParen = /^(.*?)[（(]([^）)]{0,12})[）)]\s*$/.exec(p);
  if (mParen && isSpeakerName(mParen[1])) {
    return { name: mParen[1].trim(), manner: mParen[2].trim() };
  }

  // ② 已知角色名（最长优先）：顾景琛对着身边宾客 / 苏清鸢OS / 苏父苏明远
  const sorted = [...knownNames].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of sorted) {
    if (p === n) return { name: n, manner: '' };
    if (p.startsWith(n) && p.length > n.length) {
      const rest = p.slice(n.length).replace(/^[，,、\s]+/, '');
      // 剩下那段不能再是另一个名字的开头（避免「苏」吃掉「苏清鸢」的误判反向）
      if (rest && !sorted.some((m) => m !== n && rest.startsWith(m) && m.length > rest.length)) {
        return { name: n, manner: rest };
      }
    }
  }

  // ③ 方式词切分：宾客A小声议论 → 宾客A / 小声议论
  let hit = -1;
  let word = '';
  for (const w of MANNER_WORDS) {
    const i = p.indexOf(w);
    if (i > 0 && (hit === -1 || i < hit || (i === hit && w.length > word.length))) { hit = i; word = w; }
  }
  if (hit > 0) {
    const name = p.slice(0, hit).trim();
    if (isSpeakerName(name)) return { name, manner: p.slice(hit).trim() };
  }

  // ④ 兜底：整段当名字（短、干净）
  if (isSpeakerName(p)) return { name: p, manner: '' };
  return null;
}

/* ------------------------------------------------------------------ */
/* 主体解析                                                             */
/* ------------------------------------------------------------------ */

/** 预扫：把小传名字与所有「人物：」行的名字收集起来，供台词前缀匹配用 */
function prescanNames(lines, preambleCast) {
  const names = new Set();
  for (const c of preambleCast) {
    for (const x of expandCastEntry(c)) names.add(x.name);
  }
  for (const raw of lines) {
    const m = CAST_RE.exec(raw.trim());
    if (m) for (const n of cleanCastList(m[1])) names.add(n);
  }
  return names;
}

/** 「人物：」行 → 名字数组；剥掉括号备注（顾景琛(通讯VO) → 顾景琛） */
function cleanCastList(text) {
  return String(text ?? '')
    .split(/[、，,；;]/)
    .map((s) => s.replace(/[（(][^）)]{0,12}[）)]/g, '').replace(/[*#\s]/g, '').trim())
    .filter(Boolean);
}

/**
 * 主入口。
 * @returns {{ok:boolean, from:'json'|'text', script?:object, outline?:object, stats?:object, message?:string}}
 */
export function parseScriptText(text, { icon } = {}) {
  const raw = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return { ok: false, message: '先粘贴剧本，或选一个剧本文件' };

  const viaJson = tryJson(raw);
  if (viaJson?.script?.episodes?.length) {
    return finish(viaJson.script, viaJson.outline, {
      source: viaJson.source, from: 'json', icon,
    });
  }

  const allLines = raw.split('\n');
  // 前载/主体分界：遇「# 剧本正文」或第一行「## 第N集」或第一个场号行，之前算前载
  let bodyStart = allLines.findIndex((l) => /^\s*#+\s*剧本正文/.test(l));
  if (bodyStart < 0) bodyStart = allLines.findIndex((l) => EP_RE.test(l.trim()) && /^#/.test(l.trim()));
  if (bodyStart < 0) bodyStart = allLines.findIndex((l) => SCENE_RE.test(l.trim()));
  const preamble = parsePreamble(bodyStart > 0 ? allLines.slice(0, bodyStart) : []);
  const bodyLines = bodyStart >= 0 ? allLines.slice(bodyStart) : allLines;

  const knownNames = prescanNames(bodyLines, preamble.cast);
  const episodes = parseBody(bodyLines, knownNames);
  if (!episodes.length) {
    return { ok: false, message: '没解析出任何集：检查是不是写了「第1集」或「## 第1集」' };
  }
  return finishFromLines(episodes, preamble, icon);
}

/** 逐行扫主体，产出原始场次结构（说话人还是名字，finishFromLines 里再映射成 id） */
function parseBody(lines, knownNames) {
  const episodes = [];
  let ep = null;
  let scene = null;
  const sceneIds = new Map(); // 场地名 → 全局场次 id（跨集复用同一场景，和导出 JSON 的惯例一致）
  const newEp = (no) => { ep = { ep: no, scenes: [], hook: '', cliff: '' }; episodes.push(ep); scene = null; };
  const newScene = (meta) => {
    let id = sceneIds.get(meta.name);
    if (!id) { id = `S${String(sceneIds.size + 1).padStart(2, '0')}`; sceneIds.set(meta.name, id); }
    scene = { sceneId: id, name: meta.name, lighting: meta.lighting, chars: [], flow: [] };
    ep.scenes.push(scene);
  };

  // 动作块里不许留引号：引擎的 action-prose 门只认引号字符，模型爱在 △ 行里写
  // 「屏幕上弹出『已上传』」这类画面文字——内容有价值，引号没价值，剥掉两边都不得罪
  const pushAction = (text) => {
    const body = String(text ?? '').replace(/[「」『』“”‘’]/g, '').replace(/\s{2,}/g, ' ').trim();
    if (body) scene.flow.push({ action: body });
  };

  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (!t) continue;

    // 纯章节头（# 剧本正文 等）：跳过。不跳就会凭空多出「第 1 集」且把标题当动作
    if (SECTION_RE.test(t) && !EP_RE.test(t)) continue;

    // 集标题
    const mEp = EP_RE.exec(t);
    if (mEp) {
      const no = toNumber(mEp[1] ?? mEp[2] ?? mEp[3]) ?? episodes.length + 1;
      newEp(no);
      continue;
    }
    // 场号行
    const mSc = SCENE_RE.exec(t);
    if (mSc) {
      if (!ep) newEp(1);
      newScene(sceneMeta(t));
      continue;
    }
    if (!ep) newEp(1);
    if (!scene) newScene({ name: '未命名场地', lighting: '日景' });

    // 出场人物行：进本场人物，不算台词也不算动作
    const mCast = CAST_RE.exec(t);
    if (mCast) {
      for (const n of cleanCastList(mCast[1])) {
        if (!GROUP_RE.test(n) && !scene.chars.includes(n)) scene.chars.push(n);
      }
      continue;
    }

    // 集尾卡点：【钩子字幕】xxx → cliff（这是短剧的卖点，必须留给契约）
    const mHook = HOOK_RE.exec(t);
    if (mHook) { ep.cliff = mHook[1].trim(); continue; }

    // △/▲ 开头：镜头/动作/画面。整行是【…】标记的（闪回/音效/黑屏）原样保留
    if (/^[△▲]/.test(t)) {
      pushAction(t.replace(/^[△▲]\s*/, ''));
      continue;
    }
    if (MARKER_RE.test(t)) { pushAction(t); continue; }

    // 字幕/音效等元素行：不是台词
    const mElem = /^([^：:]{1,6})\s*[：:]\s*(.+)$/.exec(t);
    if (mElem && ELEMENT_SPEAKERS.has(mElem[1].trim())) {
      pushAction(`${mElem[1].trim()}：${mElem[2].trim()}`);
      continue;
    }

    // 台词行
    const mD = DIALOGUE_RE.exec(t);
    if (mD) {
      const sp = splitSpeaker(mD[1], knownNames);
      if (sp) {
        const manner = [mD[2]?.trim(), sp.manner].filter(Boolean).join(' ');
        if (!scene.chars.includes(sp.name)) scene.chars.push(sp.name);
        scene.flow.push({ speaker: sp.name, line: mD[3].trim(), delivery: manner });
        continue;
      }
    }

    // 其余非空行：动作（叙述体）。剥掉 markdown 列表符，保留【】标记内容
    pushAction(t.replace(/^[·•\-–—*]\s+/, ''));
  }

  // 集号兜底 + 丢掉空集
  return episodes
    .map((e, i) => ({ ...e, ep: Number.isInteger(e.ep) && e.ep > 0 ? e.ep : i + 1 }))
    .filter((e) => e.scenes.some((s) => s.flow.length > 0));
}

/** 文本解析结果 → 引擎契约 */
function finishFromLines(episodes, preamble, icon) {
  // ---- 角色名册：小传 > 出场集数 ----
  // 每个候选角色记「在哪几集开过口」，≥2 集算重要配角，只开过一次口的进群演桶
  const speakerEps = new Map(); // name → Set(ep)
  for (const e of episodes) {
    for (const s of e.scenes) {
      for (const b of s.flow) {
        if (!b.speaker) continue;
        if (!speakerEps.has(b.speaker)) speakerEps.set(b.speaker, new Set());
        speakerEps.get(b.speaker).add(e.ep);
      }
    }
  }
  // 小传条目展开成单人（苏父苏明远、苏母温岚 → 苏明远 / 温岚），说话人按名字对齐
  const castByName = new Map();
  for (const c of preamble.cast) {
    for (const x of expandCastEntry(c)) if (x.name && !castByName.has(x.name)) castByName.set(x.name, x);
  }

  const CAP = { lead: 5, support: 10, functional: 10 };
  const BUCKET = '群演';
  const entries = []; // { name, tier, role, desc }
  const seen = new Set();
  const push = (name, tier, role = '', desc = '') => {
    if (!name || seen.has(name) || GROUP_RE.test(name)) return;
    seen.add(name);
    entries.push({ name, tier, role, desc });
  };

  // ① 小传：定位含女主/男主/反派的进主角组，其余重要配角
  for (const c of preamble.cast) {
    for (const x of expandCastEntry(c)) {
      if (!x.name || GROUP_RE.test(x.name)) continue;
      const lead = /女主|男主|反派|主角/.test(x.role ?? '');
      push(x.name, lead ? 'lead' : 'support', x.role, x.desc);
    }
  }
  // ② 开过口的：≥2 集 → 重要配角；只开过一次 → 群演桶
  for (const [name, eps] of speakerEps) {
    if (seen.has(name)) continue;
    push(name, eps.size >= 2 ? 'support' : 'bucket', castByName.get(name)?.role ?? '', castByName.get(name)?.desc ?? '');
  }
  // ③ 只在「人物：」行出现过、没开口的：功能性角色（露脸不开口）
  for (const e of episodes) {
    for (const s of e.scenes) {
      for (const n of s.chars) {
        if (!seen.has(n) && !GROUP_RE.test(n)) push(n, 'functional', castByName.get(n)?.role ?? '', castByName.get(n)?.desc ?? '');
      }
    }
  }

  // 超桶兜底：主角组超了降配角，配角超了降功能性，群演桶和功能性超编的都并进「群演」
  const demote = (from, to) => {
    const over = entries.filter((x) => x.tier === from).slice(CAP[from]);
    for (const x of over) x.tier = to;
  };
  demote('lead', 'support');
  demote('support', 'functional');
  for (const x of entries) if (x.tier === 'bucket') x.tier = 'merged';
  const funcOver = entries.filter((x) => x.tier === 'functional').slice(CAP.functional);
  for (const x of funcOver) x.tier = 'merged';
  const merged = new Set(entries.filter((x) => x.tier === 'merged').map((x) => x.name));

  // ---- id 分配：小传/常驻角色各自拿号，群演共用一个号 ----
  const roster = entries.filter((x) => x.tier !== 'merged');
  const idOf = new Map();
  roster.forEach((x, i) => idOf.set(x.name, `C${String(i + 1).padStart(2, '0')}`));
  let bucketId = null;
  if (merged.size) {
    bucketId = `C${String(roster.length + 1).padStart(2, '0')}`;
    for (const n of merged) idOf.set(n, bucketId);
  }
  const characters = roster.map((x, i) => ({
    id: `C${String(i + 1).padStart(2, '0')}`,
    name: x.name,
    role: x.role || (x.tier === 'lead' ? '主角' : x.tier === 'support' ? '配角' : '功能性角色'),
    tier: x.tier,
    ...(x.desc ? { desc: x.desc } : {}),
  }));
  if (bucketId) {
    characters.push({
      id: bucketId, name: BUCKET, role: '群演', tier: 'functional',
      desc: '一次性出场的人物统一走这个桶：资产层只出一张松散一致的参考，台词本保留原名',
    });
  }
  const knownIds = new Set(characters.map((c) => c.id));
  const nameOf = new Map(characters.map((c) => [c.id, c.name]));

  // 钩子/卡点的确定性派生：导入文本没有显式钩子说明时，
  // 开场第一个画面就是全集第一拍，收尾最后一拍就是本集落点——
  // 派生值诚实（内容确实从这开始、到这结束），也让 hook-cliff 门对导入文本有效
  const beatText = (b) => (b ? (b.action ?? `${b.speaker}：${b.line}`) : '');
  const flatFlow = (e) => e.scenes.flatMap((s) => s.flow);
  const trunc = (s, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

  const scriptEps = episodes.map((e) => {
    const flow = flatFlow(e);
    const hook = trunc(beatText(flow[0]));
    const cliff = e.cliff || trunc(beatText(flow[flow.length - 1]));
    return {
    ep: e.ep,
    // 目标时长就是内容估出来的时长——**不要**再兜一个 30 秒下限：
    // 时长门比的是「这一集的估时总秒数 vs 目标 ±15%」，
    // 短剧本被下限顶高就直接判不达标（实测 19 秒的内容兜成 30 秒 → 该门必挂）
    targetSeconds: Math.max(1, Math.round(estimateSeconds(e.scenes.flatMap((s) => s.flow)))),
    hook,
    cliff,
    beatsClaimed: [],
    // 钩子的具象认领在第一拍：hookBeat [1,1] 恒成立且诚实（内容确实从这开始）
    hookBeat: [1, 1],
    scenes: e.scenes
      .filter((s) => s.flow.length > 0)
      .map((s) => ({
        sceneId: s.sceneId,
        // 场地名要带下去：下游提示词的 [场景设定] / [站位设定] 直接用它
        name: s.name,
        lighting: s.lighting,
        // 只留角色表里有的人：说话人+本场人物 − 群演标签 − 表外名字。
        // 先去重再映射：宾客A/宾客B 都进群演桶，按名字去重会漏出一个 id 重复
        characters: [...new Set([...s.chars, ...s.flow.filter((b) => b.speaker).map((b) => b.speaker)]
          .map((n) => idOf.get(n))
          .filter((id) => id && knownIds.has(id)))],
        props: [],
        flow: s.flow.map((b) => {
          if (!b.speaker) return { action: b.action };
          const id = idOf.get(b.speaker);
          // 群演桶里的原名写进 delivery：台词本还能看出这句原本是「宾客A」说的
          const delivery = id === bucketId && b.speaker !== BUCKET
            ? [b.speaker, b.delivery].filter(Boolean).join(' ')
            : (b.delivery ?? '');
          return { speaker: id ?? bucketId ?? 'VO', line: b.line, delivery };
        }),
      })),
    };
  });

  // 场景名取场次头里的场地名，取不到才退回「场 N」——提示词里的 [场景设定] 直接用这个名字
  const nameOfScene = new Map();
  for (const e of scriptEps) for (const s of e.scenes) if (!nameOfScene.has(s.sceneId)) nameOfScene.set(s.sceneId, s.name);
  const scenes = [...new Set(scriptEps.flatMap((e) => e.scenes.map((s) => s.sceneId)))]
    .map((id, i) => ({
      id,
      name: nameOfScene.get(id) || `场 ${i + 1}`,
      primary: i < 2,
      reusePlan: i < 2 ? '' : '按需复用',
    }));
  const outline = {
    source: preamble.title ? `《${preamble.title.replace(/^AI短剧《|》.*$/g, '')}》` : '导入的剧本',
    lang: 'zh',
    ...(preamble.title ? { title: preamble.title } : {}),
    ...(preamble.genre ? { genre: preamble.genre } : {}),
    ...(preamble.synopsis ? { synopsis: preamble.synopsis } : {}),
    characters,
    scenes,
    props: [],
    beats: [],
    episodes: scriptEps.map((e) => ({
      ep: e.ep,
      hook: e.hook,
      suspense: e.cliff,
      sceneIds: e.scenes.map((s) => s.sceneId),
      characterIds: characters.map((c) => c.id),
      propIds: [],
      warnings: [],
    })),
  };
  return finish({ source: outline.source, episodes: scriptEps }, outline, { source: outline.source, from: 'text', icon });
}

/** 统一收口：规范化 + 统计 + 自检 */
function finish(script, outline, { source, from, icon }) {
  const eps = (script.episodes ?? []).map((e, i) => ({
    ...e,
    ep: Number.isInteger(e.ep) && e.ep > 0 ? e.ep : i + 1,
    // 同上：目标时长从内容反算，不加下限
    targetSeconds: e.targetSeconds > 0 ? e.targetSeconds : Math.max(1, Math.round(estimateSeconds((e.scenes ?? []).flatMap((s) => s.flow ?? [])))),
    scenes: (e.scenes ?? []).map((s) => ({ ...s, sceneId: s.sceneId || 'S01', characters: s.characters ?? [], props: s.props ?? [], flow: s.flow ?? [] })),
  }));
  const stats = {
    episodes: eps.length,
    scenes: eps.reduce((n, e) => n + e.scenes.length, 0),
    actions: eps.reduce((n, e) => n + e.scenes.reduce((m, s) => m + s.flow.filter((b) => b.action).length, 0), 0),
    lines: eps.reduce((n, e) => n + e.scenes.reduce((m, s) => m + s.flow.filter((b) => b.line).length, 0), 0),
    seconds: Math.round(eps.reduce((n, e) => n + e.targetSeconds, 0)),
    characters: (outline?.characters ?? []).length,
  };
  if (!stats.scenes || !(stats.actions + stats.lines)) {
    return { ok: false, message: `解析到的内容不够（${stats.episodes} 集 / ${stats.scenes} 场 / 0 拍）：至少要有一集、一场，以及动作或台词` };
  }
  // 没台词就没有戏：纯动作行的文本多半是没按格式写（或粘错了内容），直接说清楚
  if (!stats.lines) {
    return { ok: false, message: `只解析到 ${stats.actions} 个动作、0 句台词。台词要写成「角色名：台词」这样的独立一行，补上再试` };
  }
  return {
    ok: true,
    from,
    format: FORMAT_ID,
    script: { source: script.source ?? source, params: { episodes: eps.length, minutesPerEpisode: Math.round(stats.seconds / eps.length / 60) || 2 }, episodes: eps },
    // JSON 输入常常只有 script 没有 outline：那就从剧本自身补一份角色/场景表，
    // 否则下游（角色名清洗、资产库、台词本）都拿不到东西
    outline: outline ?? synthesizeOutline(eps),
    stats,
    icon,
  };
}

/** 从剧本自身补一份最小大纲：角色表（id 已在 flow 里）+ 场景表 */
function synthesizeOutline(eps) {
  const ids = [];
  for (const e of eps) {
    for (const s of e.scenes) {
      for (const b of s.flow) if (b.speaker && !ids.includes(b.speaker)) ids.push(b.speaker);
    }
  }
  const sceneIds = [...new Set(eps.flatMap((e) => e.scenes.map((s) => s.sceneId)))];
  return {
    source: eps[0] ? '导入的剧本' : '',
    lang: 'zh',
    // 只有 id 没有名字：name 用 id 占位，好过完全没有角色表
    characters: ids.map((id, i) => ({ id, name: id, role: i === 0 ? '主角' : '配角', tier: i < 2 ? 'lead' : 'support' })),
    scenes: sceneIds.map((id, i) => ({ id, name: `场 ${i + 1}`, primary: i < 2, reusePlan: i < 2 ? '' : '按需复用' })),
    props: [],
    beats: [],
    episodes: eps.map((e) => ({
      ep: e.ep, hook: '', suspense: '',
      sceneIds: e.scenes.map((s) => s.sceneId), characterIds: ids, propIds: [], warnings: [],
    })),
  };
}

/** 给界面看的「解析到什么」总结 */
export function describeImport(stats) {
  const mm = Math.floor(stats.seconds / 60);
  const ss = stats.seconds % 60;
  return `${stats.episodes} 集 / ${stats.scenes} 场 / ${stats.actions} 个动作 / ${stats.lines} 句台词 / ${stats.characters} 个角色 / 约 ${mm} 分 ${ss} 秒`;
}

/* ------------------------------------------------------------------ */
/* JSON 剧本：项目导出的 .json 直接载入                                  */
/* ------------------------------------------------------------------ */
/*
 * 文本导入要「猜格式」，JSON 不用：结构已经在里面了。
 * 认三种落法（都是本项目自己产出过的形状）：
 *   {script:{episodes:[…]}, outline:{…}}   —— 项目存档
 *   {episodes:[…], characters:[…], …}      —— 裸剧本
 *   {script:{…}}                           —— 只给了一边
 * 认不出来就明确说清楚缺什么，不要拿半截数据去跑评估。
 */
export function statsOf(script) {
  const eps = script?.episodes ?? [];
  let scenes = 0;
  let actions = 0;
  let lines = 0;
  let seconds = 0;
  const cast = new Set();
  for (const ep of eps) {
    for (const sc of ep.scenes ?? []) {
      scenes += 1;
      for (const id of sc.characters ?? []) cast.add(id);
      for (const b of sc.flow ?? []) {
        if (typeof b.line === 'string') { lines += 1; seconds += b.line.replace(/\s/g, '').length / 4.2; }
        else if (typeof b.action === 'string') { actions += 1; seconds += 2.5; }
      }
    }
  }
  return { episodes: eps.length, scenes, actions, lines, seconds: Math.round(seconds), characters: cast.size };
}

export function parseScriptJson(text) {
  let data = null;
  try {
    data = JSON.parse(String(text ?? ''));
  } catch (e) {
    return { ok: false, message: `JSON 解析失败：${e.message}` };
  }
  if (!data || typeof data !== 'object') return { ok: false, message: 'JSON 顶层不是对象' };

  const script = Array.isArray(data.script?.episodes) ? data.script
    : Array.isArray(data.episodes) ? data
      : null;
  if (!script) {
    return { ok: false, message: '这个 JSON 里没有剧本：需要 episodes 数组（或 {script:{episodes:[…]}}）' };
  }
  if (!script.episodes.length) return { ok: false, message: 'episodes 是空的：至少要有第 1 集' };
  const bad = script.episodes.findIndex((e) => !e || !Array.isArray(e.scenes));
  if (bad >= 0) return { ok: false, message: `第 ${bad + 1} 个 episode 没有 scenes 数组，结构不完整` };

  return {
    ok: true,
    script,
    outline: data.outline && typeof data.outline === 'object' ? data.outline : null,
    stats: statsOf(script),
  };
}
