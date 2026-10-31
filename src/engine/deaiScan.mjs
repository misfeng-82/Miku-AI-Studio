/**
 * 去 AI 味 · 量化扫描引擎（确定性）
 *
 * 来源与移植说明：
 *   移植自「绘梦」的工具 `tools/deai_scan.py`（v3.0，13 维实测，AI 痕迹分 0–100）。
 *   原版依赖本机 Python 3，本项目是零依赖 Node —— 所以整体重写为纯 JS，
 *   词表、权重、惩罚曲线、样本量保护、短板放大公式全部保持一致，
 *   保证「同一段文本在原版与本项目里得到同一个量级的分」。
 *
 * 为什么不交给模型自评：
 *   模型给自己的文打分没有约束力（问它几次给几个分）。这里所有维度都是用正则与
 *   统计量实测出来的：句长 cv、段长 cv、套话密度、破折号密度、对话占比、MATTR……
 *   同一段文本任何时候扫都是同一个分，才能当门禁用。
 *
 * 与小说版的差异（适配短剧剧本）：
 *   1. 对话识别：原版只认中文引号（“…”/「…」）。短剧剧本是「角色：台词」的行格式，
 *      只按引号算会把整部剧本的对话占比判成 0，直接顶满惩罚。这里两种格式都认。
 *   2. 正文抽取：剧本没有「## 正文」小节，抽不到就整篇扫，不硬套小说模板。
 */

/* ============================ 词表（12 组） ============================ */

/** 1. 高频套话 / 剥夺主动性的短语 */
const CLICHE_GENERIC = [
  '不禁', '仿佛', '宛如', '宛若', '映入眼帘', '心中暗道', '暗自思忖',
  '不由得', '一时间', '与此同时', '值得注意的是', '毫无疑问', '事实上',
  '总的来说', '令人印象深刻', '不知不觉', '情不自禁', '下意识地',
  '鬼使神差', '油然而生', '难以言喻', '挥之不去', '不言而喻', '五味杂陈',
];

/** 2. 弱化副词（模糊不确定） */
const WEAKENING_ADVERBS = [
  '似乎', '好像', '大概', '或许', '也许', '几乎', '稍微', '略微',
  '隐约', '隐隐', '有些许', '某种程度上', '近乎',
];

/** 3. 意义膨胀（论文腔） */
const INFLATION = [
  '在某种程度上', '从某种意义上说', '需要指出的是', '众所周知',
  '在这个过程中', '不难看出', '由此可见', '可以说', '就整体而言',
  '基于这样的考虑', '总而言之', '换言之',
];

/** 4. 通用套话（抽象评价，无具体信息） */
const GENERIC_PLATITUDE = [
  '关键时刻', '一切都变了', '气氛变得紧张', '场面十分壮观',
  '时间仿佛静止', '命运的转折点', '内心深处', '这一刻', '那一瞬间',
  '空气仿佛凝固', '说不出话', '一片死寂', '气氛一下子',
];

/** 5. 论文结构过渡词 */
const ESSAY_TRANSITIONS = [
  '首先', '其次', '再次', '综上所述', '一方面', '另一方面',
  '不仅如此', '更重要的是',
];

/** 6. 情绪 choreography（同一批身体反应被反复调用） */
const EMOTION_CHOREO = [
  '屏住呼吸', '屏息', '咬紧牙关', '咬紧嘴唇', '心跳加速', '心脏狂跳',
  '胃里一沉', '后背发凉', '头皮发麻', '冷汗直流', '倒吸一口凉气',
  '瞳孔骤缩', '瞳孔一缩', '嘴角勾起', '眉头紧锁', '深吸一口气',
  '叹了口气', '心头一紧', '心里一沉', '浑身一震', '僵在原地',
];

/** 7. 中文特有 AI 腔 */
const ZH_AI_TICS = [
  '不知为何', '莫名地', '莫名', '无法形容', '难以形容',
  '仿佛有什么', '似乎有什么', '像是有什么', '某种东西', '某种感觉',
  '不知过了多久', '一切都是那么', '一种说不清',
];

/** 8. 被 AI 滥用的四字格 */
const IDIOM_BANK = [
  '不堪设想', '不寒而栗', '不知所措', '目瞪口呆', '面不改色', '心如死灰',
  '千钧一发', '千头万绪', '心乱如麻', '悲痛欲绝', '欣喜若狂', '恍然大悟',
  '不由自主', '心照不宣', '意味深长', '若有所思', '显而易见', '尽收眼底',
  '一览无余', '焕然一新', '翻天覆地', '悄无声息', '风平浪静', '波涛汹涌',
  '光芒万丈', '不假思索', '无动于衷', '刻骨铭心', '无法自拔', '如释重负',
  '毛骨悚然', '触目惊心', '小心翼翼', '屏气凝神', '不屑一顾', '怅然若失',
];

/** 9. 感官词（正向指标：人味往往有更多具体感官，用字根扩充召回） */
const SENSORY = {
  视觉: ['看', '见', '望', '盯', '瞟', '瞥', '扫', '光', '亮', '暗', '影',
    '色', '红', '白', '黑', '蓝', '灰', '绿', '黄', '闪', '晃', '灯',
    '朦胧', '模糊', '轮廓', '猩红', '惨白', '漆黑'],
  听觉: ['听', '声', '响', '静', '嗡', '咔', '咚', '嗤', '咳', '喊', '叫',
    '低语', '嘶', '轰', '沙沙', '哗啦', '吱呀', '嗥', '噪'],
  触觉体感: ['凉', '烫', '热', '冷', '湿', '黏', '痛', '麻', '酸', '痒',
    '抖', '颤', '汗', '风', '硬', '软', '粗糙', '灼热', '刺痛'],
  嗅觉: ['闻', '气味', '味道', '腥', '香', '臭', '霉', '焦味', '烟味', '潮气'],
  味觉: ['苦', '甜', '咸', '涩', '辣', '腥甜'],
};

/** 10. 抽象名词（负向：抽象堆砌越多越像 AI） */
const ABSTRACT_NOUNS = [
  '意义', '存在', '命运', '宿命', '力量', '意志', '灵魂', '内心',
  '情感', '信念', '希望', '绝望', '孤独', '痛苦', '真理', '自由',
  '选择', '代价', '责任', '价值', '本质', '真相',
];

/** 11. 对话标签 */
const DIALOG_TAGS = [
  '说道', '问道', '答道', '笑道', '喊道', '叫道', '低声道', '沉声道',
  '轻声道', '开口道', '开口', '出声', '喃喃', '嘟囔', '冷笑',
];

/** 12. 章末总结式结尾的信号 */
const SUMMARY_ENDING = [
  '终于明白', '终于懂了', '第一次', '从这一刻起', '他知道', '她明白',
  '此刻他', '此刻她', '原来', '从此', '一切都会',
];

/** 套话分组（分组名即报告里的分类，权重按总量算） */
const CLICHE_GROUPS = {
  高频套话: CLICHE_GENERIC,
  弱化副词: WEAKENING_ADVERBS,
  意义膨胀: INFLATION,
  通用套话: GENERIC_PLATITUDE,
  论文结构: ESSAY_TRANSITIONS,
  情绪套路: EMOTION_CHOREO,
  中文AI腔: ZH_AI_TICS,
};

/* ============================ 基础工具 ============================ */

const SENT_SPLIT_RE = /[。！？!?…]+/;
const DIALOG_QUOTE_RE = /[“"]([^”"]*)[”"]|「([^」]*)」/g;
/**
 * 剧本行格式的对话：行首 1–8 个字的名字 + 冒号（排除「场1-1 日 内 …」这类场号行）。
 * 注意不能带 g 标志：这里是一行一行 match 的，带 g 时 match() 只返回整段匹配、
 * 拿不到捕获组，m[2] 会是 undefined。
 */
const DIALOG_LINE_RE = /^[ \t]*([\u4e00-\u9fffA-Za-z0-9·]{1,8})[：:][ \t]*(.+)$/;
/** 场号行 / 集标题行：这些不是对话，别算进对话占比 */
const HEADING_LINE_RE = /^[ \t]*(?:#|##|###|【|场\s*\d|第\s*\d+\s*[集场])/;

/** 只保留中文汉字的字符流（对应原版 re.sub(r"[^\u4e00-\u9fff]", "", text)） */
function cjkOnly(s) {
  return String(s ?? '').replace(/[^\u4e00-\u9fff]/g, '');
}

/** 词汇统计 token：中文单字 + 英文词 + 数字 */
function tokens(text) {
  return String(text ?? '').match(/[\u4e00-\u9fff]|[A-Za-z]+|\d+/g) ?? [];
}

/** 移动平均类符标记比：对文本长度不敏感，比原始 TTR 可靠 */
function mattr(tok, window = 100) {
  const n = tok.length;
  if (!n) return 0;
  if (n <= window) return new Set(tok).size / n;
  const step = Math.max(1, Math.floor(window / 4));
  const ratios = [];
  for (let i = 0; i + window <= n; i += step) {
    ratios.push(new Set(tok.slice(i, i + window)).size / window);
  }
  return ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
}

/** 非重叠出现次数（等价于 Python 的 str.count） */
function countOcc(text, word) {
  if (!word) return 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const at = text.indexOf(word, i);
    if (at < 0) break;
    n += 1;
    i = at + word.length;
  }
  return n;
}

/** 命中词表：返回 [{word,count,samples}]，按次数降序 */
function findHits(text, words, sampleLimit = 2) {
  const hits = [];
  for (const w of words) {
    const count = countOcc(text, w);
    if (!count) continue;
    const samples = [];
    let i = 0;
    while (samples.length < sampleLimit) {
      const at = text.indexOf(w, i);
      if (at < 0) break;
      const s = Math.max(0, at - 12);
      const e = Math.min(text.length, at + w.length + 12);
      samples.push(`${s > 0 ? '…' : ''}${text.slice(s, e).replace(/\n/g, ' ')}${e < text.length ? '…' : ''}`);
      i = at + w.length;
    }
    hits.push({ word: w, count, samples });
  }
  hits.sort((a, b) => b.count - a.count);
  return hits;
}

/**
 * 惩罚曲线：good 处 0 分，bad 处 1 分，中间线性。
 * good < bad 表示「值越大越差」；good > bad 表示「值越小越差」（如 cv、对话占比）。
 */
function penalty(value, good, bad) {
  if (good === bad) return 0;
  if (good < bad) {
    if (value <= good) return 0;
    if (value >= bad) return 1;
    return (value - good) / (bad - good);
  }
  if (value >= good) return 0;
  if (value <= bad) return 1;
  return (good - value) / (good - bad);
}

const per1000 = (count, chars) => (chars ? (count / chars) * 1000 : 0);
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
function pstdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * 只取「正文」那一段。
 * 技能输出常见结构是「### 一、修改后全文 / ### 二、修改记录」，
 * 只扫正文才算得准：把修改记录里的表格和说明一起扫，分数会被抬上去。
 * 剧本没有这套小节，抽不到就整篇返回（不硬套小说模板）。
 */
export function extractBody(text) {
  const t = String(text ?? '');
  const bodyHeads = '(?:修改后全文|定稿全文|最终全文|最终定稿|修改全文|正文|定稿)';
  const recordHeads = '(?:修改记录|修订记录|修改说明|改动记录|修改清单)';

  const m = t.match(new RegExp(`^#{1,4}\\s*[一二三四五六七八九十\\d]*\\s*[、.．)）]?\\s*${bodyHeads}\\s*$`, 'm'))
    ?? t.match(new RegExp(`^#{1,4}\\s*[一二三四五六七八九十\\d]*\\s*[、.．)）]?\\s*${bodyHeads}`, 'm'));
  if (!m) {
    const cut = t.search(new RegExp(`^#{1,4}\\s*[一二三四五六七八九十\\d]*\\s*[、.．)）]?\\s*${recordHeads}`, 'm'));
    if (cut > 0) return { text: t.slice(0, cut).trim(), extracted: true };
    return { text: t, extracted: false };
  }
  const start = m.index + m[0].length;
  const rest = t.slice(start);
  const nxt = rest.match(/^#{1,4}\s+\S/m);
  const end = nxt ? start + nxt.index : t.length;
  return { text: t.slice(start, end).trim(), extracted: true };
}

/**
 * 对话切分：引号内的 + 「角色：台词」行。
 * 两者都算，是因为同一份稿子里两种写法都可能出现（小说段落里用引号，
 * 剧本格式里用角色冒号），只认一种会把另一部分对话当成叙述，把占比算低。
 */
function collectDialogues(text, lines) {
  const segs = [];
  for (const m of text.matchAll(DIALOG_QUOTE_RE)) {
    const seg = m[1] ?? m[2] ?? '';
    if (cjkOnly(seg).length >= 1) segs.push(seg);
  }
  for (const line of lines) {
    if (HEADING_LINE_RE.test(line)) continue;
    const m = line.match(DIALOG_LINE_RE);
    if (!m) continue;
    const name = m[1];
    // 排掉「注：」「旁白：」这类元信息行，它们不是人物对话
    if (/^(注|说明|备注|旁白|字幕|画外音|音效|注音)$/.test(name)) continue;
    const seg = m[2].trim();
    if (cjkOnly(seg).length >= 1) segs.push(seg);
  }
  return segs;
}

/* ============================ 主分析 ============================ */

const DIMENSIONS = [
  { key: 'cliche', label: '套话密度', weight: 0.17 },
  { key: 'sentence', label: '句长变化', weight: 0.14 },
  { key: 'adverb', label: '弱化副词', weight: 0.09 },
  { key: 'de', label: '“的”字密度', weight: 0.09 },
  { key: 'paragraph', label: '段落长短', weight: 0.08 },
  { key: 'dialog', label: '对话占比', weight: 0.08 },
  { key: 'idiom', label: '四字格密度', weight: 0.07 },
  { key: 'sensory', label: '感官具体度', weight: 0.06 },
  { key: 'le', label: '“了”字密度', weight: 0.06 },
  { key: 'dash', label: '破折号密度', weight: 0.05 },
  { key: 'ending', label: '结尾质量', weight: 0.05 },
  { key: 'triad', label: '三连排比', weight: 0.03 },
  { key: 'opening', label: '段首重复', weight: 0.03 },
];

/**
 * 扫描一段文本。
 * @param {string} raw 原文
 * @param {{bodyOnly?: boolean}} [opts] bodyOnly 默认 true（只扫正文小节）
 * @returns {object} 报告；文本为空时返回 {ok:false, error}
 */
export function analyzeText(raw, opts = {}) {
  const bodyOnly = opts.bodyOnly !== false;
  const rawText = String(raw ?? '');
  if (!rawText.trim()) return { ok: false, error: '没有可扫描的文本' };

  const body = bodyOnly ? extractBody(rawText) : { text: rawText, extracted: false };
  const text = body.text;
  const chars = cjkOnly(text);
  const charCount = chars.length;
  if (!charCount) return { ok: false, error: '正文里没有中文字符（可能粘的是空模板）' };

  /* --- 句 / 段 --- */
  const sentences = text.split(SENT_SPLIT_RE).map((s) => s.trim()).filter((s) => cjkOnly(s));
  const sentLens = sentences.map((s) => cjkOnly(s).length);
  const lines = text.split(/\n/);
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => cjkOnly(p));
  const paraLens = paragraphs.map((p) => cjkOnly(p).length);

  /* --- 对话 --- */
  const dlgSegs = collectDialogues(text, lines);
  const dlgChars = dlgSegs.reduce((n, s) => n + cjkOnly(s).length, 0);
  const dialogRatio = charCount ? dlgChars / charCount : 0;
  const tagCounter = {};
  let tagTotal = 0;
  for (const t of DIALOG_TAGS) {
    const c = countOcc(text, t);
    if (c) { tagCounter[t] = c; tagTotal += c; }
  }
  const untaggedRatio = dlgSegs.length ? Math.max(0, dlgSegs.length - tagTotal) / dlgSegs.length : 0;

  /* --- 词汇与中文密度 --- */
  const tok = tokens(text);
  const mttr = mattr(tok, Math.min(100, Math.max(20, tok.length)));
  const deCnt = countOcc(chars, '的');
  const leCnt = countOcc(chars, '了');
  const diCnt = countOcc(text, '地');
  const dashCnt = countOcc(text, '——') + countOcc(text, '—');
  const ellipsisCnt = (text.match(/…{2,}|\.{3,}/g) ?? []).length;
  const idiomCnt = IDIOM_BANK.reduce((n, w) => n + countOcc(text, w), 0);
  const abstractCnt = ABSTRACT_NOUNS.reduce((n, w) => n + countOcc(text, w), 0);

  /* --- 套话分项 --- */
  const cliches = {};
  let clicheTotal = 0;
  for (const [name, words] of Object.entries(CLICHE_GROUPS)) {
    const hits = findHits(text, words);
    cliches[name] = hits;
    clicheTotal += hits.reduce((n, h) => n + h.count, 0);
  }

  /* --- 感官 --- */
  const sensory = {};
  let sensoryTotal = 0;
  for (const [kind, words] of Object.entries(SENSORY)) {
    const c = words.reduce((n, w) => n + countOcc(text, w), 0);
    sensory[kind] = c;
    sensoryTotal += c;
  }

  /* --- 三连排比：连续三句长度接近且开头雷同 --- */
  const triads = [];
  for (let i = 0; i + 2 < sentences.length;) {
    const a = sentLens[i]; const b = sentLens[i + 1]; const c = sentLens[i + 2];
    if (a >= 6 && b >= 6 && c >= 6) {
      const mx = Math.max(a, b, c); const mn = Math.min(a, b, c);
      const spread = mx ? (mx - mn) / mx : 1;
      if (spread <= 0.18) {
        const lead = [sentences[i], sentences[i + 1], sentences[i + 2]].map((s) => cjkOnly(s).slice(0, 2));
        if (new Set(lead).size < 3 || spread <= 0.08) {
          triads.push({ at: i + 1, lens: [a, b, c], lead, sample: [sentences[i], sentences[i + 1], sentences[i + 2]].map((s) => s.slice(0, 24)).join(' / ') });
          i += 3;
          continue;
        }
      }
    }
    i += 1;
  }

  /* --- 段首重复 --- */
  const openingRepeats = [];
  for (let j = 0; j + 1 < paragraphs.length; j += 1) {
    const p1 = cjkOnly(paragraphs[j]); const p2 = cjkOnly(paragraphs[j + 1]);
    if (p1.length >= 2 && p2.length >= 2 && p1.slice(0, 2) === p2.slice(0, 2)) {
      openingRepeats.push({ at: j + 1, opening: p1.slice(0, 4) });
    }
  }

  /* --- 结构标志 --- */
  const flags = [];
  const lastPara = paragraphs.length ? cjkOnly(paragraphs[paragraphs.length - 1]) : '';
  for (const sig of SUMMARY_ENDING) {
    if (lastPara.includes(sig)) { flags.push({ type: '章末总结式结尾', signal: sig }); break; }
  }
  for (const [re, label] of [
    [/感到|感觉到|涌起|泛起|升起/g, '情绪命名外化'],
    [/一种.{0,6}的感觉/g, '抽象感受包装'],
    [/像是.{0,10}一般|像.{0,10}一样/g, '比喻模板句式'],
  ]) {
    const c = (text.match(re) ?? []).length;
    if (c) flags.push({ type: label, count: c });
  }

  /* --- 综合分 --- */
  const sentCv = sentLens.length > 1 && mean(sentLens) ? pstdev(sentLens) / mean(sentLens) : 0;
  const paraCv = paraLens.length > 1 && mean(paraLens) ? pstdev(paraLens) / mean(paraLens) : 0;

  const dCliche = per1000(clicheTotal, charCount);
  const dAdverb = per1000(cliches['弱化副词'].reduce((n, h) => n + h.count, 0), charCount);
  const dIdiom = per1000(idiomCnt, charCount);
  const dDash = per1000(dashCnt, charCount);
  const dDe = (deCnt / charCount) * 100;
  const dLe = (leCnt / charCount) * 100;
  const dSensory = per1000(sensoryTotal, charCount);
  const triadRate = per1000(triads.length, charCount);
  const openRate = (openingRepeats.length / Math.max(1, paragraphs.length)) * 100;
  const endingPenalty = flags.some((f) => f.type === '章末总结式结尾') ? 1 : 0;

  /** key → {penalty, weight, detail}；样本不足的维度把 weight 置 0（不计分但保留展示） */
  const dims = {
    cliche: { penalty: penalty(dCliche, 0, 20), weight: 0.17, detail: `${round(dCliche, 1)}/千字` },
    sentence: { penalty: penalty(sentCv, 0.55, 0.25), weight: 0.14, detail: `cv=${round(sentCv, 2)}` },
    adverb: { penalty: penalty(dAdverb, 0, 12), weight: 0.09, detail: `${round(dAdverb, 1)}/千字` },
    de: { penalty: penalty(dDe, 2.5, 6.0), weight: 0.09, detail: `${round(dDe, 1)}/百字` },
    paragraph: { penalty: penalty(paraCv, 0.60, 0.25), weight: 0.08, detail: `cv=${round(paraCv, 2)}` },
    dialog: { penalty: penalty(dialogRatio, 0.30, 0.08), weight: 0.08, detail: `${round(dialogRatio * 100, 1)}%` },
    idiom: { penalty: penalty(dIdiom, 1, 10), weight: 0.07, detail: `${round(dIdiom, 1)}/千字` },
    sensory: { penalty: penalty(dSensory, 40, 12), weight: 0.06, detail: `${round(dSensory, 1)}/千字` },
    le: { penalty: penalty(dLe, 1.5, 6.0), weight: 0.06, detail: `${round(dLe, 1)}/百字` },
    dash: { penalty: penalty(dDash, 0.5, 6), weight: 0.05, detail: `${round(dDash, 1)}/千字` },
    ending: { penalty: endingPenalty, weight: 0.05, detail: endingPenalty ? '总结式结尾' : '正常' },
    triad: { penalty: penalty(triadRate, 0, 3), weight: 0.03, detail: `${triads.length}处` },
    opening: { penalty: penalty(openRate, 0, 8), weight: 0.03, detail: `${openingRepeats.length}处` },
  };

  /* --- 样本量保护：统计类指标在样本太小时不可靠，降权而不是硬判 --- */
  const advisory = [];
  if (charCount < 1200) {
    dims.dialog.weight = 0;
    dims.dialog.detail += '（样本短，仅供参考）';
    advisory.push('正文不足 1200 字，对话占比不参与计分，建议以整集/整章为准');
  }
  if (sentLens.length < 5) {
    dims.sentence.weight = 0;
    dims.sentence.detail += '（句数<5，不计分）';
    advisory.push('句子少于 5 句，节奏类指标不参与评分');
  }
  if (paraLens.length < 4) {
    dims.paragraph.weight = 0;
    dims.paragraph.detail += '（段数<4，不计分）';
    advisory.push('段落少于 4 段，段落节奏不参与评分');
  }
  if (charCount < 300) {
    advisory.push('正文不足 300 字，AI 痕迹分仅供参考，不足以判定整集');
  }

  /* --- 短板放大：纯加权平均会把致命缺陷稀释掉，混入「最差单项」做近距离一票否决 --- */
  const weighted = Object.values(dims).reduce((n, d) => n + d.penalty * d.weight, 0);
  const active = Object.values(dims).filter((d) => d.weight > 0).map((d) => d.penalty);
  const worst = active.length ? Math.max(...active) : 0;
  const score = round(100 * (0.62 * weighted + 0.38 * worst), 1);

  const grade = score <= 20 ? '优秀' : score <= 35 ? '良好' : score <= 55 ? '及格' : '不合格';

  /** 维度数组（按惩罚降序），给界面直接渲染 */
  const dimensions = DIMENSIONS.map(({ key, label, weight }) => ({
    key,
    label,
    weight,
    penalty: round(dims[key].penalty, 3),
    effectiveWeight: dims[key].weight,
    detail: dims[key].detail,
  })).sort((a, b) => b.penalty - a.penalty);

  /** 命中明细（给「改写指令」用：把最该改的词直接列给模型） */
  const issues = Object.entries(cliches)
    .flatMap(([group, hits]) => hits.map((h) => ({ group, word: h.word, count: h.count, samples: h.samples })))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return {
    ok: true,
    bodyExtracted: body.extracted,
    charCount,
    score,
    grade,
    pass: score <= 40,
    basic: {
      chars: charCount,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      dialogChars: dlgChars,
      dialogRatio: round(dialogRatio, 4),
    },
    sentence: {
      mean: round(mean(sentLens), 1),
      stdev: round(pstdev(sentLens), 1),
      cv: round(sentCv, 3),
      min: sentLens.length ? Math.min(...sentLens) : 0,
      max: sentLens.length ? Math.max(...sentLens) : 0,
    },
    paragraph: {
      mean: round(mean(paraLens), 1),
      cv: round(paraCv, 3),
      max: paraLens.length ? Math.max(...paraLens) : 0,
    },
    vocabulary: { mattr: round(mttr, 3), distinct: new Set(tok).size },
    zhDensity: {
      de: round(dDe, 2),
      le: round(dLe, 2),
      di: diCnt,
      dash: dashCnt,
      ellipsis: ellipsisCnt,
      idiom: idiomCnt,
      abstract: abstractCnt,
    },
    cliches,
    clicheTotal,
    sensory,
    dialogueTags: tagCounter,
    untaggedRatio: round(untaggedRatio, 3),
    triads: triads.slice(0, 5),
    openingRepeats: openingRepeats.slice(0, 5),
    structureFlags: flags,
    advisory,
    dimensions,
    issues,
    /** 最该先修的三项 */
    topProblems: dimensions.filter((d) => d.effectiveWeight > 0 && d.penalty > 0).slice(0, 3),
  };
}

/**
 * 门禁：把扫描结果变成项目统一的 gate 结构（{id,label,ok,detail}）。
 * 与本项目其他引擎的门禁同形，前端/服务层可以直接混用。
 */
export function deaiGate(report, opts = {}) {
  if (!report?.ok) {
    return [{ id: 'deai', label: 'AI 痕迹量化', ok: false, detail: report?.error ?? '无法扫描' }];
  }
  const maxScore = Number(opts.maxScore) > 0 ? Number(opts.maxScore) : 40;
  const soft = report.charCount < 300;
  const ok = report.score <= maxScore;
  return [{
    id: 'deai',
    label: maxScore <= 20 ? '定稿门禁（AI 痕迹）' : 'AI 痕迹门禁',
    ok: soft ? true : ok,
    soft: soft && !ok,
    detail: soft
      ? `AI 痕迹分 ${report.score}（全文不足 300 字，样本太短，仅供参考不判门禁）`
      : `AI 痕迹分 ${report.score} ${ok ? '≤' : '>'} ${maxScore}${ok ? '' : '，需改写后重扫'}`,
  }];
}

export const DEAI_GRADE_BANDS = [
  { max: 20, label: '优秀' },
  { max: 35, label: '良好' },
  { max: 55, label: '及格' },
  { max: 100, label: '不合格' },
];

/** 供测试与规则展示用：导出词表规模，避免词表被误删成空 */
export function bankStats() {
  return {
    groups: Object.keys(CLICHE_GROUPS).length,
    words: Object.values(CLICHE_GROUPS).reduce((n, w) => n + w.length, 0)
      + IDIOM_BANK.length + ABSTRACT_NOUNS.length + DIALOG_TAGS.length + SUMMARY_ENDING.length,
    sensory: Object.values(SENSORY).reduce((n, w) => n + w.length, 0),
  };
}
