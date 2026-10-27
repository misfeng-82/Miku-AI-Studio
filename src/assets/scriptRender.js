/* 结构 → 标准稿文本（生成链路的反方向）。
 *
 * 评估要把「整部剧」喂给模型看，优化要把「单集」喂给模型改，两处都需要反序列化。
 * 放一个文件里共用，免得两边各写一套、慢慢漂成两种格式。
 *
 * 往返契约：这里渲染出来的文本，public/parseScriptText.js 必须能原样读回去
 * （selftest 里有回环用例）。所以只写解析器认识的东西，不发明新语法。
 */
import { lineChars } from '../engine/script.mjs';

const nameMap = (outline) => new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));

/** 灯光字段是解析器给的（夜景/日景…），标准稿只认 日/夜/晨/昏 */
function timeOf(lighting) {
  const s = String(lighting ?? '');
  if (/晨|早/.test(s)) return '晨';
  if (/昏|黄|傍晚/.test(s)) return '昏';
  if (/日|白/.test(s)) return '日';
  return '夜';
}

const placeOf = (scene, index) => String(scene?.name ?? '').trim() || `场景${index + 1}`;

/** 解析器会把【黑屏】这类结构标记当成动作节拍收进 flow，渲染时要剔掉，否则会画成 △ */
const STRUCT_MARK = /^【黑屏】|^【钩子字幕】/;
/** 卡点可能被解析成「【钩子字幕】…【黑屏】第N集完」，渲染时只留那句钩子 */
const cleanCliff = (s) => String(s ?? '').replace(/【黑屏】[\s\S]*$/, '').replace(/^【钩子字幕】/, '').trim();

/**
 * 单集 → 标准稿正文。
 * 只做「还原」，不补内容：原文没有的动作不编，没有的台词不写。
 */
export function episodeText(ep, outline) {
  const names = nameMap(outline);
  const out = [`## 第${ep?.ep ?? 1}集`];
  const scenes = ep?.scenes ?? [];
  scenes.forEach((sc, i) => {
    out.push(`场${ep?.ep ?? 1}-${i + 1} ${timeOf(sc.lighting)} 内 ${placeOf(sc, i)}`);
    // 人物行取本场实际开口的人：解析器按 flow 认人，写多了会多出没戏的角色
    const cast = [...new Set((sc.flow ?? []).filter((b) => b.speaker).map((b) => names.get(b.speaker) ?? b.speaker))];
    if (cast.length) out.push(`人物：${cast.join('、')}`);
    out.push('');
    for (const b of sc.flow ?? []) {
      if (typeof b?.line === 'string' && b.line.trim()) out.push(`${names.get(b.speaker) ?? b.speaker ?? '旁白'}：${b.line.trim()}`);
      else if (typeof b?.action === 'string' && b.action.trim() && !STRUCT_MARK.test(b.action.trim())) out.push(`△${b.action.trim()}`);
    }
    out.push('');
  });
  const cliff = cleanCliff(ep?.cliff);
  if (cliff) out.push(`【钩子字幕】${cliff}`);
  out.push(`【黑屏】第${ep?.ep ?? 1}集完`);
  return out.join('\n');
}

/**
 * 整部剧本 → 喂模型的长文本。
 * 超长必须截：60 集的剧本原样进去能吃掉几万 token，而模型看到前 20 集
 * 就足以判断钩子、人物、台词的水准——截断要明写，别让模型以为后面没有。
 */
export function scriptText(script, outline, { maxChars = 14000 } = {}) {
  const episodes = script?.episodes ?? [];
  const cast = (outline?.characters ?? []).map((c) => `${c.name}｜${c.role ?? ''}`.replace(/｜$/, '')).join('、');
  const head = [
    `《${script?.source ?? '未命名'}》共 ${episodes.length} 集`,
    cast ? `人物：${cast}` : '',
    outline?.synopsis ? `梗概：${outline.synopsis}` : '',
  ].filter(Boolean).join('\n');

  const parts = [head];
  let used = head.length;
  let cutAt = episodes.length;
  for (let i = 0; i < episodes.length; i += 1) {
    const t = episodeText(episodes[i], outline);
    if (used + t.length > maxChars) { cutAt = i; break; }
    parts.push(t);
    used += t.length;
  }
  if (cutAt < episodes.length) parts.push(`……（后略：共 ${episodes.length} 集，这里只给到第 ${cutAt} 集）`);
  return parts.join('\n\n');
}

/** 台词超长的句子：优化前的自查，也给前端「为什么这一集被挑出来」一个理由 */
export function longLines(ep, max = 22) {
  const rows = [];
  for (const sc of ep?.scenes ?? []) {
    for (const b of sc.flow ?? []) {
      if (typeof b?.line === 'string' && lineChars(b.line) > max) rows.push({ speaker: b.speaker, line: b.line, chars: lineChars(b.line) });
    }
  }
  return rows;
}
