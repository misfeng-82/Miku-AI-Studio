// 爆款标题生成：确定性组合矩阵。
// 爆款标题有强结构：题材词 × 钩子词 × 情绪/身份词 × 数字/疑问收尾。
// 不做玄学，把骨架列出来让人挑，比模型瞎编更可控。

const GENRE_HEADS = {
  '女频逆袭': ['退婚', '下堂', '庶女', '前妻', '赘婿'],
  '悬疑': ['渡口', '夜航', '失踪', '旧案', '第三个人'],
  '都市': '外卖,保姆,代驾,保洁,程序员'.split(','),
  '古风': ['公主', '将军', '书生', '戏班', '镖局'],
  default: ['她', '他', '那个', '这一夜'],
};

const HOOK_CORES = [
  '被当众退婚', '发现丈夫的秘密', '重生回到退婚那日', '在灵堂上笑了', '把休书拍在桌上',
  '认出了杀父凶手', '亮出隐藏十年的底牌', '当众揭穿假千金', '拒绝跪着活', '一刀斩断旧约',
];

const EMOTION_TAILS = ['全场寂静', '众人反了', '他红了眼', '她笑了', '满座皆惊', '无人敢应'];

const OPENERS = ['开局', '那一夜', '三个月后', '直到那天', '谁也没想到'];

/** 生成候选标题：结构化组合，不重复 */
export function generateTitles({ genre = '女频逆袭', keyword = '', count = 12, hook = '' } = {}) {
  const heads = GENRE_HEADS[genre] ?? GENRE_HEADS.default;
  const kw = keyword.trim();
  const out = [];
  const seen = new Set();

  const push = (text, formula) => {
    const t = text.replace(/\s+/g, '');
    if (t.length < 6 || t.length > 30 || seen.has(t)) return;
    seen.add(t);
    out.push({ text: t, formula, chars: t.length });
  };

  // 句式 1：题材头 + 钩子核
  for (const h of heads) for (const c of HOOK_CORES) {
    // kw 已含题材头时不再重复拼（避免「渡口渡口…」）
    const head = kw && kw.includes(h) ? '' : h;
    push(kw ? `${kw}${head}${c}` : `${head}${c}`, '题材 + 钩子');
  }
  // 句式 2：开场词 + 钩子核 + 情绪尾
  for (const o of OPENERS) for (const c of HOOK_CORES.slice(0, 5)) for (const e of EMOTION_TAILS.slice(0, 3)) {
    push(`${o}${c}，${e}`, '开场 + 钩子 + 反应');
  }
  // 句式 3：关键词优先（用户给了词就以它开头）
  if (kw) {
    for (const c of HOOK_CORES) for (const e of EMOTION_TAILS.slice(0, 4)) {
      push(`${kw}${c}，${e}`, '关键词 + 钩子 + 反应');
      push(`${kw}：${c}`, '关键词 + 冒号 + 钩子');
    }
  }
  // 句式 4：钩子词直给（用户自己写的钩子）
  if (hook.trim()) {
    const hk = hook.trim().slice(0, 16);
    for (const o of OPENERS.slice(0, 3)) for (const e of EMOTION_TAILS.slice(0, 3)) {
      push(`${o}${hk}，${e}`, '开场 + 你的钩子 + 反应');
      push(`${hk}，${e}`, '你的钩子 + 反应');
    }
  }

  // 打散：交替取不同句式，避免前 12 条全是同一个模板
  const byFormula = new Map();
  for (const t of out) {
    if (!byFormula.has(t.formula)) byFormula.set(t.formula, []);
    byFormula.get(t.formula).push(t);
  }
  const mixed = [];
  const lists = [...byFormula.values()];
  let i = 0;
  while (mixed.length < Math.min(count, out.length) && lists.some((l) => l.length)) {
    const l = lists[i % lists.length];
    if (l.length) mixed.push(l.shift());
    i += 1;
    if (i > 500) break;
  }
  return { items: mixed, total: out.length, genre };
}
