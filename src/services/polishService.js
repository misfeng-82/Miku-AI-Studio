// 台词润色：确定性规则改写单句台词。
// 只做「机器能改且改了一定对」的事：拆长句、去口语赘词、补停顿、控制字数。
// 涉及重写的交给模型（ optimizeService 的规则改写），这里不碰语义。

const FILLERS = ['那个', '就是说', '然后呢', '怎么说呢', '反正就是', '我跟你说', '不是我说'];

/** 一句话时长估算：与引擎同口径（4.2 字/秒），单句上限 8 秒 */
const MAX_CHARS = 34;

export function polishLine(line) {
  const original = String(line ?? '').trim();
  if (!original) return { original: '', polished: '', changes: [] };
  const changes = [];
  let text = original;

  // 1) 去口语赘词（只删不影响语义的口头禅）
  for (const f of FILLERS) {
    if (text.includes(f)) { text = text.split(f).join(''); changes.push(`去口头禅「${f}」`); }
  }
  // 1.5) 删词后常留下「，，」「，。」这类残标点，先收干净再进后续规则
  const beforePunct = text;
  text = text.replace(/，{2,}/g, '，').replace(/。{2,}/g, '。').replace(/，。/g, '。').replace(/。，/g, '。').replace(/^[，。、]+/, '');
  if (text !== beforePunct) changes.push('清理删词后的残标点');
  // 2) 收尾标点统一为中文句号（台词场景下更稳）
  if (/[.。！？!?;；]$/.test(text) === false && text) { text += '。'; changes.push('补句尾标点'); }
  // 3) 长句拆分：超过 MAX_CHARS 按逗号断成两句
  if (text.length > MAX_CHARS) {
    const parts = text.replace(/，/g, '，|').replace(/、/g, '、|').split('|');
    if (parts.length > 1) {
      text = parts.map((p) => p.trim()).filter(Boolean).join('。').replace(/。。/g, '。');
      changes.push(`长句拆 ${parts.length} 句（原文 ${original.length} 字）`);
    }
  }
  // 4) 重复标点清理
  if (/，{2,}|。{2,}/.test(text)) { text = text.replace(/,{2,}/g, '，').replace(/。{2,}/g, '。'); changes.push('清理重复标点'); }

  return {
    original,
    polished: text,
    chars: text.length,
    seconds: Math.round((text.length / 4.2) * 10) / 10,
    changes,
  };
}

/** 批量润色一个角色的所有台词，返回改动统计 */
export function polishLines(lines) {
  const items = (lines ?? []).map((l) => polishLine(typeof l === 'string' ? l : l.text ?? l.line ?? ''));
  return {
    items,
    changed: items.filter((x) => x.changes.length).length,
    total: items.length,
  };
}
