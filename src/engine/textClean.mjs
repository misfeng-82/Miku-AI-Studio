/**
 * 文本清理（确定性）
 *
 * 只处理「机器一定能改对」的排版问题，不碰语义、不改词。
 * 来源：小说正文里最常见的两类脏东西——
 *   1. 引号里的句末标点：「急事。」 → 「急事」
 *      「」本身就是句界，里面再塞一个句号，排版上是重复的；但 ！？… 表语气，要保留。
 *   2. 叠标点：「……」写成「。。。」、「！！」堆一串。
 *     这些是模型采样时的抖动，删掉不影响任何表达。
 */

/** 引号对：中文直角引号与弯引号都处理 */
const QUOTE_PAIRS = [
  ['「', '」'],
  ['“', '”'],
];

/** 句末标点：引号内保留这些（表语气），只去掉句号 */
const KEEP_INSIDE = /[！？!?…—]$/;

/**
 * 清理引号内的多余标点 + 叠标点。
 * @param {string} raw
 * @returns {{text: string, changes: string[]}}
 */
export function tidyDialogue(raw) {
  let text = String(raw ?? '');
  const changes = [];

  /* 1. 引号内首尾的多余标点 */
  for (const [open, close] of QUOTE_PAIRS) {
    const re = new RegExp(`${open}([^${close}]*)${close}`, 'g');
    text = text.replace(re, (whole, inner) => {
      let body = inner;
      // 开头是逗号/顿号/句号这类「接续标点」：引号已经断了，没必要留
      const strippedHead = body.replace(/^[，、；：。,]+/, '');
      if (strippedHead !== body) {
        changes.push(`去掉引号内开头标点：${whole.slice(0, 12)}`);
        body = strippedHead;
      }
      // 结尾的句号：引号本身即句界；但保留 ！？…（语气）
      if (body.endsWith('。') || body.endsWith('.')) {
        body = body.slice(0, -1);
        changes.push(`去掉引号内句末句号：${whole.slice(0, 12)}`);
      } else if (!KEEP_INSIDE.test(body) && /[，、；：,]$/.test(body)) {
        body = body.slice(0, -1);
        changes.push(`去掉引号内陆续标点：${whole.slice(0, 12)}`);
      }
      // 引号内首尾的空白
      body = body.replace(/^\s+|\s+$/g, '');
      return `${open}${body}${close}`;
    });
  }

  /* 2. 叠标点：句号/逗号/叹号/问号/分号叠成一串的，留一个。
     省略号「……」与破折号「——」是有意义的长标点，不能合并成一个。 */
  const beforeDup = text;
  text = text
    .replace(/。{2,}/g, '。')
    .replace(/，{2,}/g, '，')
    .replace(/、{2,}/g, '、')
    .replace(/；{2,}/g, '；')
    .replace(/：{2,}/g, '：')
    .replace(/！{2,}/g, '！')
    .replace(/？{2,}/g, '？')
    .replace(/[。，、；：]\s*[。，、；：]+/g, (m) => m.trim().slice(0, 1));
  if (text !== beforeDup) changes.push('合并了重复标点');

  /* 3. 引号紧贴的空格：「 急事 」 → 「急事」 */
  text = text.replace(/([「“])\s+/g, '$1').replace(/\s+([」”])/g, '$1');

  return { text, changes };
}

/**
 * 章节正文的收尾清理：去掉首尾空行、把 3 个以上连续空行压成一个空行。
 * 不含语义修改，可以放心在每次生成后跑。
 */
export function tidyChapterBody(raw) {
  const { text, changes } = tidyDialogue(raw);
  const collapsed = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (collapsed !== text.trim()) changes.push('整理空行');
  return { text: collapsed, changes };
}
