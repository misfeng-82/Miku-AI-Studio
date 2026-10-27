import { speechSeconds } from './analyzeService.js';

// 台词本：把散在各场的台词按角色汇总，直接可喂 TTS。
// 上游 shuohao-skills 的 novel-script 也有这一层（per-character line book with voice prompts）。

const VOICE_DIMENSIONS = ['音色', '音高', '语速', '口音', '情绪基调', '参考'];

export function buildLineBook(script, outline, cast) {
  const names = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));
  const voices = new Map((cast?.characters ?? []).map((c) => [c.name, c.voice]));
  const groups = new Map();

  for (const ep of script?.episodes ?? []) {
    for (const sc of ep.scenes ?? []) {
      for (const beat of sc.flow ?? []) {
        if (!beat.line) continue;
        const key = beat.speaker ?? 'VO';
        if (!groups.has(key)) {
          groups.set(key, { id: key, name: names.get(key) ?? key, lines: [] });
        }
        groups.get(key).lines.push({
          ep: ep.ep,
          scene: sc.sceneId,
          text: beat.line,
          delivery: beat.delivery ?? '',
          chars: beat.line.replace(/\s/g, '').length,
          seconds: speechSeconds(beat.line),
        });
      }
    }
  }

  const characters = [...groups.values()].map((g) => {
    const chars = g.lines.reduce((s, l) => s + l.chars, 0);
    const secs = g.lines.reduce((s, l) => s + l.seconds, 0);
    const voice = voices.get(g.name);
    return {
      ...g,
      count: g.lines.length,
      chars,
      seconds: Math.round(secs * 10) / 10,
      avgChars: g.lines.length ? Math.round(chars / g.lines.length) : 0,
      longest: g.lines.reduce((m, l) => (l.chars > m.chars ? l : m), { chars: 0, text: '' }),
      // 音色提示词：喂 TTS 用，写不全就会导致同一角色前后音色不一致
      voicePrompt: voice?.prompt ?? '',
      voiceSpec: voice
        ? VOICE_DIMENSIONS.map((d) => `${d}：${{ 音色: voice.timbre, 音高: voice.pitch, 语速: voice.pace, 口音: voice.accent, 情绪基调: voice.emotion, 参考: voice.referenceHint }[d] ?? '—'}`).join('；')
        : '',
      episodes: [...new Set(g.lines.map((l) => l.ep))].sort((a, b) => a - b),
    };
  }).sort((a, b) => b.chars - a.chars);

  const totalSeconds = characters.reduce((s, c) => s + c.seconds, 0);
  return {
    characters,
    totals: {
      speakers: characters.length,
      lines: characters.reduce((s, c) => s + c.count, 0),
      chars: characters.reduce((s, c) => s + c.chars, 0),
      seconds: Math.round(totalSeconds * 10) / 10,
    },
    // 话最多的角色：如果占比过高，说明其他人物被弱化了
    dominant: characters[0]
      ? { name: characters[0].name, share: totalSeconds ? Math.round((characters[0].seconds / totalSeconds) * 100) : 0 }
      : null,
    warnings: buildWarnings(characters),
  };
}

function buildWarnings(characters) {
  const w = [];
  for (const c of characters) {
    if (c.longest.chars > 35) w.push(`${c.name} 有 ${c.longest.chars} 字的超长台词：「${c.longest.text.slice(0, 20)}…」`);
    if (c.count > 0 && c.avgChars > 30) w.push(`${c.name} 平均句长 ${c.avgChars} 字，偏长`);
    if (!c.voicePrompt) w.push(`${c.name} 缺少音色提示词，TTS 时音色可能前后不一`);
  }
  return w;
}

/** 导出为 CSV：直接给配音表用 */
export function toCsv(book) {
  const rows = [['角色', '集', '场次', '台词', '语气', '字数', '预计秒数']];
  for (const c of book.characters) {
    for (const l of c.lines) {
      rows.push([c.name, l.ep, l.scene ?? '', l.text, l.delivery, l.chars, l.seconds]);
    }
  }
  return rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/** 导出为分角色文本：配音演员一人一份 */
export function toPerformerScript(book) {
  return book.characters.map((c) => [
    `# ${c.name}（${c.count} 句 / ${c.seconds} 秒）`,
    c.voiceSpec ? `音色：${c.voiceSpec}` : '音色：（待补充）',
    ...c.lines.map((l) => `第${l.ep}集 ${l.scene ?? ''}｜${l.text}${l.delivery ? `（${l.delivery}）` : ''}`),
    '',
  ].join('\n')).join('\n');
}
