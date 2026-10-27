// 人物关系图：从大纲 + 台词共现推断角色关系网络。
// 短剧人物关系不乱，观众才追得下去。这里给三样东西：
//   1) 共现边（同场出现/有对白往来的角色对）
//   2) 台词往来次数（谁跟谁对话最多）
//   3) 孤立角色（没跟任何人同场过——通常是漏写）

/** 从大纲提取静态关系（arc / from 字段里可能带的关系描述） */
function staticEdges(outline) {
  const edges = [];
  for (const c of outline?.characters ?? []) {
    for (const other of outline?.characters ?? []) {
      if (c.id >= other.id) continue;
      const text = `${c.arc ?? ''} ${c.from ?? ''} ${other.arc ?? ''} ${other.from ?? ''}`;
      const pair = [c.name, other.name].join('');
      if (text.includes(other.name) && text.includes(c.name)) {
        edges.push({ a: c.id, b: other.id, kind: '大纲互注', weight: 1 });
      }
    }
  }
  return edges;
}

export function buildRelations(script, outline) {
  const names = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));
  const roles = new Map((outline?.characters ?? []).map((c) => [c.id, c.role ?? '配角']));

  const coScene = new Map(); // 同场
  const talk = new Map();    // 对白往来（连续两句不同 speaker 计一次）
  const appeared = new Set();

  for (const ep of script?.episodes ?? []) {
    for (const sc of ep.scenes ?? []) {
      const chars = sc.characters ?? [];
      chars.forEach((c) => appeared.add(c));
      for (let i = 0; i < chars.length; i += 1) {
        for (let j = i + 1; j < chars.length; j += 1) {
          const key = [chars[i], chars[j]].sort().join('|');
          coScene.set(key, (coScene.get(key) ?? 0) + 1);
        }
      }
      const flow = sc.flow ?? [];
      for (let i = 0; i < flow.length - 1; i += 1) {
        const a = flow[i], b = flow[i + 1];
        if (a.speaker && b.speaker && a.speaker !== b.speaker) {
          const key = [a.speaker, b.speaker].sort().join('|');
          talk.set(key, (talk.get(key) ?? 0) + 1);
          appeared.add(a.speaker); appeared.add(b.speaker);
        }
      }
    }
  }

  const nodes = [...appeared].map((id) => ({ id, name: names.get(id) ?? id, role: roles.get(id) ?? '' }));
  const edgeKey = (a, b) => [a, b].sort().join('|');

  const edges = [];
  const allKeys = new Set([...coScene.keys(), ...talk.keys()]);
  for (const key of allKeys) {
    const [a, b] = key.split('|');
    const scenes = coScene.get(key) ?? 0;
    const talks = talk.get(key) ?? 0;
    // 关系强度 = 同场数 + 对白数×2（有对话比同场更近）
    edges.push({ a, b, scenes, talks, weight: scenes + talks * 2 });
  }
  for (const e of staticEdges(outline)) {
    if (!allKeys.has(edgeKey(e.a, e.b))) { edges.push({ ...e, scenes: 0, talks: 0 }); allKeys.add(edgeKey(e.a, e.b)); }
  }
  edges.sort((x, y) => y.weight - x.weight);

  const orphans = (outline?.characters ?? [])
    .filter((c) => !appeared.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, role: c.role }));

  const degree = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) { degree.set(e.a, (degree.get(e.a) ?? 0) + 1); degree.set(e.b, (degree.get(e.b) ?? 0) + 1); }

  return {
    nodes: nodes.map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 })),
    edges,
    orphans,
    advice: orphans.length
      ? `${orphans.map((o) => o.name).join('、')} 在大纲里但没进任何一场戏，要么加戏要么删人。`
      : '所有角色都有对手戏，人物网络健康。',
  };
}
