/**
 * 编辑工具（纯函数，可单测）
 *
 * 移植自「墨笔 AI 写作台」assets/js/editor-tools.js 的六件套中的四件
 * （撤销栈交给浏览器原生 Ctrl+Z，不重复造），只保留与写作直接相关的：
 *   1. 清理 Markdown 符号
 *   2. 统一中文标点
 *   3. 智能排版（段首缩进、段间空行、行尾空格）
 *   4. 高频词透镜（看自己是不是在重复用词）
 *
 * 这些都不碰 DOM、不调模型，纯本地，改完立刻能看出区别。
 */

/* ---------------- 1. 清理 Markdown ---------------- */

/**
 * 去掉 Markdown 标记，只留纯文本。
 * 顺序有讲究：图片/链接先处理，否则 **加粗** 里的 * 会先被当斜体吃掉。
 */
export function stripMarkdown(text) {
  let t = String(text ?? '');
  t = t.replace(/^```[^\n]*$/gm, '');                     // 代码围栏
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');           // 图片整块删
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');          // 链接留文字
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');  // 加粗
  t = t.replace(/(\*|_)(?=\S)([^*_\n]*?\S)\1/g, '$2');    // 斜体
  t = t.replace(/`([^`\n]+)`/g, '$1');                    // 行内代码
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');               // 标题 #
  t = t.replace(/^\s{0,3}>\s?/gm, '');                    // 引用
  t = t.replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '');        // 列表符号
  t = t.replace(/^\s*([-*_])\1{2,}\s*$/gm, '');           // 分隔线
  return t;
}

/* ---------------- 2. 统一中文标点 ---------------- */

const PUNCT_MAP = [[',', '，'], [';', '；'], [':', '：'], ['!', '！'], ['?', '？']];

/**
 * ASCII 标点 → 中文全角。
 * 两个坑（原版踩过，这里照样避开）：
 *   ① 小数点 3.14 / 版本号 v2.0 里的点不能变句号 → 先占位保护；
 *   ② 引号不能一把梭全替换成同一个符号。
 */
export function normalizePunct(text) {
  let t = String(text ?? '');
  t = t.replace(/\.{3,}/g, '……');
  t = t.replace(/(\d)\.(?=\d)/g, '$1\u0000');   // 保护小数点
  for (const [a, b] of PUNCT_MAP) t = t.split(a).join(b);
  t = t.replace(/\./g, '。');
  t = t.replace(/\u0000/g, '.');
  t = t.replace(/\(/g, '（').replace(/\)/g, '）');
  t = t.replace(/\[/g, '【').replace(/\]/g, '】');

  /* 成对引号：按出现顺序交替替换成前后引号，避免全变同一个 */
  let open = true;
  t = t.replace(/"/g, () => {
    const mark = open ? '“' : '”';
    open = !open;
    return mark;
  });

  /* 省略号与破折号规范化 */
  t = t.replace(/。{2,}/g, '。');
  t = t.replace(/…{3,}/g, '……');
  return t;
}

/* ---------------- 3. 智能排版 ---------------- */

/**
 * 分段与缩进：一行一段（空行分隔），段首去空格、段间空一行、行尾去空格。
 * 不动字词，只动版式——排版错了读者一眼能看出来，但内容没错。
 */
export function smartTypeset(text) {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, '').replace(/^[ \t]+/g, ''))
    .filter((l) => l.length > 0);
  return lines.join('\n\n');
}

/* ---------------- 4. 高频词透镜 ---------------- */

const STOP = new Set(['的', '了', '是', '在', '我', '他', '她', '它', '们', '你', '着', '过', '就', '都',
  '而', '及', '与', '也', '很', '不', '这', '那', '有', '被', '把', '给', '对', '从', '向', '到', '和',
  '但', '却', '又', '还', '只', '会', '能', '要', '可', '以', '其', '之', '所', '将', '并', '或', '一个']);

/**
 * 高频词：2–4 字片段按出现次数排序。
 * 用途不是「统计」而是「自查」：一段里「忽然」出现 7 次，自己读不出来，统计能看出来。
 */
export function wordFreq(text, top = 20) {
  const freq = new Map();
  const cn = String(text ?? '').replace(/[^\u4e00-\u9fa5]/g, ' ').split(/\s+/).filter(Boolean);
  for (const seg of cn) {
    for (let len = 2; len <= 4; len += 1) {
      for (let i = 0; i + len <= seg.length; i += 1) {
        const w = seg.slice(i, i + len);
        if (STOP.has(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([word, count]) => ({ word, count }));
}

/* ---------------- 5. 查找替换 ---------------- */

/**
 * 纯文本查找替换。默认区分大小写、全部替换；find 为空时原样返回。
 * 用 split/join 而不是正则：用户搜的可能是 . * ( 之类，不能当正则。
 */
export function searchReplace(text, find, replaceWith, { all = true } = {}) {
  const src = String(text ?? '');
  const f = String(find ?? '');
  if (!f) return { text: src, count: 0 };
  if (all) {
    const count = src.split(f).length - 1;
    return { text: count ? src.split(f).join(String(replaceWith ?? '')) : src, count };
  }
  const at = src.indexOf(f);
  if (at < 0) return { text: src, count: 0 };
  return { text: src.slice(0, at) + String(replaceWith ?? '') + src.slice(at + f.length), count: 1 };
}

/** 一次跑完三件套（清 MD → 统一标点 → 排版），给「一键整理」用 */
export function autoTidy(text) {
  const a = stripMarkdown(text);
  const b = normalizePunct(a);
  const c = smartTypeset(b);
  return { text: c, changed: c !== String(text ?? '') };
}
