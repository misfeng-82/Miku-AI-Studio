// 剧本格式转换：同一份剧本数据，输出不同行业格式。
// 漫剧/短剧团队之间流传剧本，格式不统一是常态（有要场1-1 的、有要 INT. 的、有要 JSON 的）。

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** 场次号：S01E02 → 1-2 */
function slug(sceneId) {
  const m = /S(\d+)E(\d+)/i.exec(sceneId ?? '');
  return m ? `${Number(m[1])}-${Number(m[2])}` : (sceneId ?? '');
}

/**
 * 短剧场号格式：场1-2 夜 内 渡口·码头
 * 国内短剧组通用，一眼能读出「第几场·昼夜·内外·地点」
 */
export function toShortDrama(script, outline) {
  const scenes = new Map((outline?.scenes ?? []).map((s) => [s.id, s]));
  const out = [`《${script?.source ?? '未命名'}》`, `集数：${(script?.episodes ?? []).length}`, ''];
  for (const ep of script?.episodes ?? []) {
    out.push(`==== 第 ${ep.ep} 集 ====`);
    if (ep.hook) out.push(`【本集钩子】${ep.hook}`);
    if (ep.cliff) out.push(`【集尾悬念】${ep.cliff}`);
    out.push('');
    (ep.scenes ?? []).forEach((sc, i) => {
      const meta = scenes.get(sc.sceneId);
      const when = i === 0 ? '日' : i % 3 === 0 ? '夜' : '日';
      const inout = i % 2 === 0 ? '内' : '外';
      out.push(`场${slug(sc.sceneId)} ${when} ${inout} ${meta?.name ?? sc.sceneId}`);
      for (const b of sc.flow ?? []) {
        if (b.speaker) out.push(`${b.speaker}：${b.line ?? ''}`);
        if (b.action) out.push(`（${b.action}）`);
      }
      out.push('');
    });
  }
  return out.join('\n');
}

/** 好莱坞格式：INT./EXT. + DAY/NIGHT + 角色居中 + 对白缩进 */
export function toScreenplay(script, outline) {
  const scenes = new Map((outline?.scenes ?? []).map((s) => [s.id, s]));
  const names = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));
  const out = [`TITLE: ${script?.source ?? 'UNTITLED'}`, ''];
  for (const ep of script?.episodes ?? []) {
    out.push(`ACT ${pad(ep.ep)}`);
    (ep.scenes ?? []).forEach((sc, i) => {
      const meta = scenes.get(sc.sceneId);
      const ext = i % 2 === 0 ? 'INT' : 'EXT';
      const tod = i % 3 === 0 ? 'NIGHT' : 'DAY';
      out.push('', `${ext}. ${(meta?.name ?? sc.sceneId).toUpperCase()} - ${tod}`, '');
      for (const b of sc.flow ?? []) {
        if (b.action) out.push(`  ${b.action}`);
        if (b.speaker) {
          out.push('', `                    ${(names.get(b.speaker) ?? b.speaker).toUpperCase()}`, `          ${b.line ?? ''}`, '');
        }
      }
    });
  }
  return out.join('\n');
}

/** Fountain 简化版：纯文本标记语言，Final Draft / Highland 都能直接导入 */
export function toFountain(script, outline) {
  const scenes = new Map((outline?.scenes ?? []).map((s) => [s.id, s]));
  const out = [`Title: ${script?.source ?? 'UNTITLED'}`, 'Credit: Miku AI创作平台', ''];
  for (const ep of script?.episodes ?? []) {
    out.push(`# 第 ${ep.ep} 集`, '');
    for (const sc of ep.scenes ?? []) {
      out.push(`.${scenes.get(sc.sceneId)?.name ?? sc.sceneId}`, '');
      for (const b of sc.flow ?? []) {
        if (b.action) out.push(b.action);
        if (b.speaker) out.push(`${b.speaker.toUpperCase()}`, `${b.line ?? ''}`, '');
      }
    }
  }
  return out.join('\n');
}

/** 分集 JSON：给下游程序消费（配音 / TTS 等） */
export function toJson(script, outline) {
  const scenes = new Map((outline?.scenes ?? []).map((s) => [s.id, s]));
  const names = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));
  return JSON.stringify({
    source: script?.source ?? '',
    episodes: (script?.episodes ?? []).map((ep) => ({
      ep: ep.ep,
      hook: ep.hook ?? '',
      cliff: ep.cliff ?? '',
      targetSeconds: ep.targetSeconds ?? 0,
      scenes: (ep.scenes ?? []).map((sc) => ({
        id: sc.sceneId,
        name: scenes.get(sc.sceneId)?.name ?? sc.sceneId,
        lighting: sc.lighting ?? '',
        characters: (sc.characters ?? []).map((c) => ({ id: c, name: names.get(c) ?? c })),
        props: sc.props ?? [],
        flow: (sc.flow ?? []).map((b) => (b.speaker
          ? { kind: 'line', speaker: b.speaker, name: names.get(b.speaker) ?? b.speaker, text: b.line ?? '', delivery: b.delivery ?? '' }
          : { kind: 'action', text: b.action ?? '' })),
      })),
    })),
  }, null, 2);
}

/** 纯文本：适合直接粘贴进聊天窗口 / 邮件 */
export function toPlain(script) {
  const out = [];
  for (const ep of script?.episodes ?? []) {
    out.push(`第 ${ep.ep} 集`);
    for (const sc of ep.scenes ?? []) {
      for (const b of sc.flow ?? []) {
        if (b.speaker) out.push(`${b.speaker}：${b.line ?? ''}`);
        else if (b.action) out.push(b.action);
      }
    }
    out.push('');
  }
  return out.join('\n');
}

export const FORMATS = Object.freeze([
  { id: 'short-drama', name: '短剧场号格式', ext: 'txt', desc: '场1-2 夜 内 渡口·码头，国内短剧组通用' },
  { id: 'screenplay', name: '好莱坞格式', ext: 'txt', desc: 'INT./EXT. + 角色居中，影视工业标准' },
  { id: 'fountain', name: 'Fountain', ext: 'fountain', desc: '纯文本标记，Final Draft / Highland 可直接导入' },
  { id: 'json', name: '分集 JSON', ext: 'json', desc: '给配音 / TTS 等下游消费' },
  { id: 'plain', name: '纯文本', ext: 'txt', desc: '无标记，适合粘贴进聊天窗口' },
]);

export function convertFormat(script, outline, format) {
  switch (format) {
    case 'screenplay': return toScreenplay(script, outline);
    case 'fountain': return toFountain(script, outline);
    case 'json': return toJson(script, outline);
    case 'plain': return toPlain(script);
    default: return toShortDrama(script, outline);
  }
}
