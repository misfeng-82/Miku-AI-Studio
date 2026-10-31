import { wordCount } from './novelGates.mjs';

/**
 * 小说引擎 · 连续性记忆（纯规则，不花额度）
 *
 * 来源：移植自「墨笔 AI 写作台」assets/js/memory.js（三级记忆：逐章 / 全书 / 事实）。
 * 为什么值得搬：长篇写到三十章以后，真正的难点不是「写不出来」，而是「记住前面写了什么」——
 * 谁出过场、在哪儿、埋了哪些没回收的伏笔、时间过了多久。这些**全是可数可抽的**，
 * 不需要再调一次模型去总结（又慢又花钱，还会漂）。
 *
 * 移植时保留了几条别人踩过坑的规则，理由写在对应位置：
 *   1. 人物抽取分「强信号 / 弱信号」两档，弱信号必须被印证才采信；
 *   2. 物件不能当说话人（录音/广播/短信…），否则会污染后续提示词；
 *   3. 弱信号门槛要按「有无结构化线索」分情况，不能一刀切。
 */

/* ============================ 停用词与动词 ============================ */

const STOP = new Set(['的', '了', '是', '在', '我', '他', '她', '它', '们', '你', '着', '过', '就', '都', '而', '及', '与', '也', '很', '不', '这', '那', '有', '被', '把', '给', '对', '从', '向', '到', '和', '但', '却', '又', '还', '只', '会', '能', '要', '可', '以', '其', '之', '所', '将', '并', '或', '一', '个', '上', '下', '中', '大', '小', '多', '少', '第', '然后', '于是', '但是', '因为', '所以', '如果', '虽然', '接着', '突然', '终于', '开始', '出现', '感到', '看着', '知道', '认为']);

const ACT_VERBS = ['发现', '决定', '前往', '返回', '揭穿', '阻止', '获得', '失去', '离开', '到达',
  '背叛', '复仇', '揭露', '承诺', '拒绝', '杀', '救', '抓', '逃', '签', '毁', '夺', '交', '带',
  '告诉', '要求', '提出', '调查', '承认', '否认', '威胁', '保护', '牺牲', '合作'];

/* ============================ 逐项抽取 ============================ */

/** 本章要点：取「含动作动词、含数字、靠前」的段落首句 */
export function extractPoints(text, maxPoints = 3) {
  if (!text) return [];
  const paras = String(text).split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.length > 12);
  const pool = paras.length ? paras : [String(text)];
  const scored = pool.map((p, i) => {
    let score = 0;
    for (const v of ACT_VERBS) if (p.includes(v)) score += 3;
    if (/[0-9一二三四五六七八九十百千万]+/.test(p)) score += 2;
    if (p.includes('因为') || p.includes('所以')) score += 1;
    // 靠前的段落通常承担本章主线
    score += Math.max(0, 3 - i * 0.3);
    return { p, score };
  }).sort((a, b) => b.score - a.score);

  return scored.slice(0, maxPoints).map((s) => {
    const first = s.p.split(/(?<=[。！？])/)[0].trim();
    return first.length > 60 ? `${first.slice(0, 58)}…` : first;
  });
}

/** 关键词：2–4 字中文片段 + 英文整词，按频次 */
export function extractKeywords(text, max = 12) {
  if (!text) return [];
  const freq = new Map();
  const cn = String(text).replace(/[^\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
  for (const seg of cn) {
    for (let len = 2; len <= 4; len += 1) {
      for (let i = 0; i + len <= seg.length; i += 1) {
        const w = seg.slice(i, i + len);
        if (STOP.has(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
  }
  for (const w of String(text).match(/[A-Za-z]{3,}/g) || []) freq.set(w, (freq.get(w) || 0) + 1);

  return [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

/**
 * 结构化人名：只认有明确格式线索的。
 *   · 场次头「人物：沈砚、马保安」
 *   · 行内 cue「沈砚[低声]：」
 *   · 英文剧本 ALLCAPS cue
 * 这些线索误报率极低，可以放心当「新人名」的证据。
 */
export function extractStructuredNames(text) {
  const t = String(text ?? '');
  const out = new Set();
  const add = (n, lo = 2, hi = 3) => {
    const s = String(n ?? '').trim();
    if (s.length >= lo && s.length <= hi) out.add(s);
  };
  const addLatin = (n) => { if (n && n.length >= 2 && n.length <= 20) out.add(n); };
  let m;

  const reScene = /人物\s*[:：]\s*([^\n。]{1,60})/g;
  while ((m = reScene.exec(t))) (m[1].match(/[\u4e00-\u9fa5]{2,3}/g) || []).forEach((x) => add(x));

  const reCue = /([\u4e00-\u9fa5]{2,3})\s*[[（(【][^\]）)】]{0,40}[\]）)】]\s*[:：]/g;
  while ((m = reCue.exec(t))) add(m[1]);

  const reEnCue = /^\s*([A-Z][A-Za-z]{1,20})\s*[:：]/gm;
  while ((m = reEnCue.exec(t))) addLatin(m[1]);

  /* 兜底：物件不能当说话人（模型会把「录音[声音微弱]：」写成角色行），字段名也不算人 */
  const NOT_NAME = /^(人物|时间|地点|场次|动作|台词|旁白|字幕|音效|镜头|画外|时间线|道具|服装|备注|说明|提示|系统|姓名|年龄|身份|职业|录音|广播|短信|手机|电视|录像|喇叭|邮件|收音机|对讲机|监控|通知|公告|标题)$/;
  return [...out].filter((n) => !NOT_NAME.test(n)).slice(0, 12);
}

/** 人物表精确匹配：书里已经有人物表，就该用它点名，而不是靠正则猜 */
export function matchCast(text, cast = []) {
  const t = String(text ?? '');
  const hits = [];
  for (const c of cast) {
    const name = String(c?.name ?? c ?? '').trim();
    if (name.length < 2) continue;
    const count = t.split(name).length - 1;
    if (count > 0) hits.push({ name, count });
  }
  return hits.sort((a, b) => b.count - a.count).map((h) => h.name);
}

/**
 * 本章出场人物。
 *
 * 为什么不像原版那样纯靠弱信号抽：中文人名的弱特征（「X说」「X的手」）在 2–3 字窗口里
 * 极不稳定——「照在沈砚的脸上」会抽出「在沈砚」、「沈砚问：」会抽出「沈砚问」，
 * 碎片频次都被拆散，最后一整批被门槛滤掉（实测人物表直接为空）。
 * 本项目每本书都有确定性的人物表，**先按人物表点名**，再用结构化线索补充新人名，
 * 既准又不会漏。没有人物表时才退回弱信号（门槛 3 次，宁缺勿滥）。
 */
export function extractCharacters(text, { cast = [] } = {}) {
  const t = String(text ?? '');
  const structured = extractStructuredNames(t);
  const known = matchCast(t, cast);

  if (cast.length) {
    return [...new Set([...known, ...structured])].slice(0, 10);
  }

  /* 无人物表：弱信号 + 高门槛（≥3 次且达到最高频的一半） */
  const weak = new Map();
  const TAIL = /[没也都就又才还在把被给让和与跟向从对正已曾刚便却的了着过说问道答想笑看走来去响冷开]$/;
  const HEAD = /^[在把被给让和与跟向从对正已曾刚便却的了着过]/;
  const clean = (n) => {
    let s = String(n ?? '');
    while (s.length > 2 && TAIL.test(s)) s = s.slice(0, -1);
    while (s.length > 2 && HEAD.test(s)) s = s.slice(1);
    return s;
  };
  const add = (n) => {
    const s = clean(n);
    if (s.length >= 2 && s.length <= 3) weak.set(s, (weak.get(s) || 0) + 1);
  };
  let m;
  for (const re of [
    /(?:叫|名叫|唤作)([\u4e00-\u9fa5]{2,3})/g,
    /([\u4e00-\u9fa5]{2,3})(?:说|道|问|答|想|笑|摇头|点头|开口|低声|大喊|回答|反问)/g,
    /([\u4e00-\u9fa5]{2,3})(?:的)(?:手|眼|脸|声音|背影|名字|母亲|父亲|师父|心里)/g,
    /^[ \t]*([\u4e00-\u9fa5]{2,3})[ \t]*[:：]/gm,
  ]) {
    while ((m = re.exec(t))) add(m[1]);
  }
  const maxW = Math.max(1, ...[...weak.values()]);
  const VAGUE = /[知觉视听说问答想笑看走来去响冷开了着过语声息]|[的了过]|[你我他她它]/;
  return [...weak.entries()]
    .filter(([n, c]) => c >= 3 && c * 2 >= maxW && !VAGUE.test(n))
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n)
    .slice(0, 8);
}

/** 地点：在/到/回/走进/来到/前往/站在 + 地名后缀 */
export function extractPlaces(text) {
  const places = new Map();
  const re = /(?:在|到|回|走进|来到|前往|站在)([\u4e00-\u9fa5]{2,6}(?:府|城|村|山|楼|宫|殿|寺|院|店|阁|巷|街|门|家|室|厅|场|园|堡|岛|镇|码头|渡口))/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) places.set(m[1], (places.get(m[1]) || 0) + 2);
  return [...places.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 6);
}

/** 伏笔：带揭示词的句子 */
export function extractForeshadow(text) {
  const cues = ['原来', '其实', '竟然', '没想到', '不曾想', '所谓', '真相', '秘密', '隐瞒', '其实是', '才是'];
  return String(text ?? '')
    .split(/(?<=[。！？])/)
    .filter((s) => cues.some((c) => s.includes(c)))
    .slice(0, 4)
    .map((s) => s.trim().slice(0, 70));
}

/** 时间线标记 */
export function extractTimeline(text) {
  const out = [];
  const re = /(?:三天|两天|一周|一个月|一年|次日|翌日|当天|半夜|凌晨|傍晚|次日清晨)[^\n。，]{0,18}/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) && out.length < 5) out.push(m[0]);
  return out;
}

/* ============================ 整章 / 全书 ============================ */

export function analyzeChapter(title, text, opts = {}) {
  const t = String(text ?? '');
  return {
    title: String(title ?? ''),
    chars: wordCount(t),   // 与章节字数同一口径：不计标点与空白
    points: extractPoints(t, 3),
    keywords: extractKeywords(t, 10),
    characters: extractCharacters(t, { cast: opts.cast ?? [] }),
    places: extractPlaces(t),
    foreshadow: extractForeshadow(t),
    timeline: extractTimeline(t),
    summary: t.replace(/\s/g, '').slice(0, 120),
    ts: new Date().toISOString(),
  };
}

/** 全书记忆：逐章要点汇成脉络 + 去重后的人物/地点 + 伏笔池 + 时间线 */
export function buildBookMemory(chapters = []) {
  const done = chapters.filter((c) => c?.memory?.chars > 0);
  return {
    arc: done.map((c) => ({ no: c.index, title: c.title, point: (c.memory.points[0] || '').slice(0, 50) })),
    characters: [...new Set(done.flatMap((c) => c.memory.characters))].slice(0, 20),
    places: [...new Set(done.flatMap((c) => c.memory.places))].slice(0, 15),
    keywords: (() => {
      const f = new Map();
      done.forEach((c) => c.memory.keywords.forEach((k) => f.set(k, (f.get(k) || 0) + 1)));
      return [...f.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k]) => k);
    })(),
    foreshadow: done.flatMap((c) => c.memory.foreshadow.map((f) => ({ no: c.index, f }))),
    timeline: done.flatMap((c) => c.memory.timeline.map((t) => ({ no: c.index, t }))),
    writtenChapters: done.length,
    totalChapters: chapters.length,
    totalChars: done.reduce((n, c) => n + c.memory.chars, 0),
  };
}

/**
 * 把记忆拼成提示词片段。
 * 这是「长篇不写飞」的关键：下一章动笔前，模型拿到的是「前面发生过什么」的结构化摘要，
 * 而不是只有上一章最后 800 字。
 */
export function memoryToPrompt(bookMemory, prevChapter, plan = {}) {
  const out = [];
  const bm = bookMemory;

  if (bm?.arc?.length) {
    out.push('【前情脉络】');
    for (const a of bm.arc.slice(-8)) if (a.point) out.push(`  第${a.no}章《${a.title}》：${a.point}`);
  }
  if (bm?.characters?.length) out.push(`【已出场人物】${bm.characters.join('、')}`);
  if (bm?.places?.length) out.push(`【已出现地点】${bm.places.join('、')}`);
  if (bm?.timeline?.length) {
    out.push('【时间线】');
    for (const t of bm.timeline.slice(-5)) out.push(`  第${t.no}章：${t.t}`);
  }

  const open = (plan.foreshadow ?? []).filter((f) => f.status !== 'paid');
  if (open.length) {
    out.push('【尚未回收的伏笔】');
    for (const f of open.slice(0, 8)) {
      const due = f.payoffAt <= (plan.current ?? 0) ? '（本章应回收）' : `（计划第${f.payoffAt}章回收）`;
      out.push(`  ${f.id}：${f.content}${due}`);
    }
  }

  if (prevChapter?.memory?.points?.length) {
    out.push('【上一章发生了什么】');
    for (const p of prevChapter.memory.points) out.push(`  ${p}`);
  }
  return out.join('\n');
}

/**
 * 伏笔回收判定（确定性）：正文里出现了伏笔内容的**任意 2–4 字片段**，就算提到过。
 * 不用「高频关键词」是因为伏笔内容通常很短（「那盏没熄的灯」），没有词能重复到 2 次，
 * 按频次筛会得到空集——于是永远判不出回收。
 * 只判「有没有提」，不判「收得好不好」：后者是编辑判断。
 */
export function foreshadowHits(text, item) {
  const content = String(item?.content ?? '');
  const STOP_CHARS = /[的了着过是在和与也都很不没一这那]/;
  const grams = new Set();
  for (let len = 2; len <= 4; len += 1) {
    for (let i = 0; i + len <= content.length; i += 1) {
      const g = content.slice(i, i + len);
      // 只有「整段都是虚字」才丢掉（如「的那」）：一片段里只要有一个实字就有辨识度。
      // 早先是「只要含虚字就丢」，结果「那盏没熄的灯」全被滤空，永远判不出回收。
      if (![...g].every((ch) => STOP_CHARS.test(ch))) grams.add(g);
    }
  }
  const t = String(text ?? '');
  const hits = [...grams].filter((g) => t.includes(g));
  return { hit: hits.length > 0, words: hits.slice(0, 4) };
}

/**
 * 更新伏笔台账状态：
 *   planted  本章是埋设章，已写出来
 *   paid     到回收章（或之后）正文提到了
 *   due      正好到回收章但没提到 —— 需要人来确认「是真没写，还是换了说法」
 *   overdue  过了回收章还没提到
 */
export function updateForeshadow(book, chapter) {
  const list = book?.outline?.foreshadow ?? [];
  if (!list.length) return [];
  const idx = chapter.index;
  const text = chapter.text ?? '';
  for (const f of list) {
    if (idx === f.plantAt) {
      f.status = 'planted';
      f.plantedAt = idx;
    }
    if (idx >= f.payoffAt && f.status !== 'paid') {
      const { hit, words } = foreshadowHits(text, f);
      if (hit) {
        f.status = 'paid';
        f.paidAt = idx;
        f.paidWords = words;
      } else if (idx > f.payoffAt) {
        f.status = 'overdue';
      } else {
        f.status = 'due';
      }
    }
  }
  book.outline.foreshadow = list;
  return list;
}

/** 人工确认回收：模型换了说法时，关键词判不出来，给人一个按钮 */
export function confirmForeshadow(book, id) {
  const list = book?.outline?.foreshadow ?? [];
  const target = list.find((f) => f.id === id);
  if (!target) return null;
  const written = (book.chapters ?? []).filter((c) => c.text).map((c) => c.index);
  target.status = 'paid';
  target.paidAt = written.length ? Math.max(...written) : target.payoffAt;
  target.confirmed = true;
  book.outline.foreshadow = list;
  return target;
}

/**
 * 连续性检查：本章冒出的「新人名」是否在设定/大纲/前文里。
 *
 * 只提示不拦，而且要排掉「身份称谓」——「守夜人」「掌柜」「护士」这类不是名字，
 * 是角色在场景里的身份，写出来完全正常。把称谓当编造报错，等于天天喊狼来了，
 * 用户很快就会无视所有提示。只对「看起来像人名」的才提醒（2–3 字、不带称谓后缀）。
 */
const IDENTITY_SUFFIX = /(人|员|手|者|师|医|警|兵|客|主|父|母|叔|婶|哥|姐|弟|妹|爷|奶|总|长|官|头|佬|婆|工|匠|兵|差)$/;

export function continuityCheck({ book, chapter }) {
  const known = new Set([
    ...(book?.bible?.characters ?? []).map((c) => c.name),
    ...(book?.outline?.chapters?.find((c) => c.index === chapter.index)?.characters ?? []),
    ...(book?.memory?.characters ?? []),
  ]);
  // 没有任何已知人物（没生成设定集、也没有前文）：无从判断，别乱报警。
  // 早先这里会把「沈砚」当成新人名报出来——空人物表时所有名字都「不在表里」。
  if (!known.size) return { newcomers: [], known: [], note: '没有人物表，暂不判断是否编造' };

  const seen = chapter?.memory?.characters ?? [];
  const newcomers = seen.filter((n) => {
    if (known.has(n)) return false;
    if (IDENTITY_SUFFIX.test(n)) return false;   // 身份称谓不算编造
    return n.length >= 2 && n.length <= 3;
  });
  return { newcomers, known: [...known].slice(0, 20) };
}
