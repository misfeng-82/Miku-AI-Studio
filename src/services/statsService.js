// 剧本统计报表：把剧本拆成可视图表——场次时长、角色出场、台词密度、节奏曲线。
// 确定性计算，给「剧本健康度」一个可核对的数字底子。

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** 全集报表 */
export function buildStats(script, outline) {
  const episodes = script?.episodes ?? [];
  const charNames = new Map((outline?.characters ?? []).map((c) => [c.id, c.name]));

  const perEpisode = episodes.map((ep) => {
    const scenes = ep.scenes ?? [];
    const beats = scenes.flatMap((sc) => sc.flow ?? []);
    const lines = beats.filter((b) => b.speaker);
    const actions = beats.filter((b) => b.action);
    return {
      ep: ep.ep,
      targetSeconds: ep.targetSeconds ?? 0,
      scenes: scenes.length,
      beats: beats.length,
      lines: lines.length,
      actions: actions.length,
      hasHook: Boolean((ep.hook ?? '').trim()),
      hasCliff: Boolean((ep.cliff ?? '').trim()),
      // 本集台词字数，用于对白曲线
      spoken: lines.reduce((n, b) => n + (b.line ?? '').length, 0),
    };
  });

  // 角色出场：按台词句数 + 出场场次
  const charStat = new Map();
  episodes.forEach((ep, ei) => {
    const seen = new Map();
    for (const sc of ep.scenes ?? []) {
      for (const c of sc.characters ?? []) seen.set(c, (seen.get(c) ?? 0) + 1);
      for (const b of sc.flow ?? []) {
        if (!b.speaker) continue;
        if (!charStat.has(b.speaker)) charStat.set(b.speaker, { id: b.speaker, name: charNames.get(b.speaker) ?? b.speaker, lines: 0, chars: 0, scenes: 0, episodes: new Set() });
        const st = charStat.get(b.speaker);
        st.lines += 1;
        st.chars += (b.line ?? '').length;
        st.episodes.add(ep.ep);
      }
    }
    for (const [c, n] of seen) {
      if (!charStat.has(c)) charStat.set(c, { id: c, name: charNames.get(c) ?? c, lines: 0, chars: 0, scenes: 0, episodes: new Set() });
      charStat.get(c).scenes += n;
      charStat.get(c).episodes.add(ep.ep);
    }
  });
  const characters = [...charStat.values()]
    .map((c) => ({ ...c, episodes: [...c.episodes].sort((a, b) => a - b) }))
    .sort((a, b) => b.lines - a.lines);

  const totalSeconds = perEpisode.reduce((n, e) => n + e.targetSeconds, 0);
  const totalLines = perEpisode.reduce((n, e) => n + e.lines, 0);
  const totalScenes = perEpisode.reduce((n, e) => n + e.scenes, 0);

  // 节奏曲线：每集「爽点词命中数」，用于折线
  const payoffWords = ['揭穿', '曝光', '跪下', '道歉', '反转', '认出', '亮出', '碾压', '拿下', '赢了'];
  const rhythm = perEpisode.map((e) => {
    const ep = episodes[e.ep - 1];
    const text = (ep.hook ?? '') + (ep.cliff ?? '') + (ep.scenes ?? []).flatMap((sc) => (sc.flow ?? []).map((b) => (b.line ?? '') + (b.action ?? ''))).join('');
    return { ep: e.ep, payoffs: payoffWords.filter((w) => text.includes(w)).length, lines: e.lines };
  });

  const warnings = [];
  if (totalScenes && totalLines / totalScenes < 5) warnings.push(`平均每场仅 ${(totalLines / totalScenes).toFixed(1)} 句台词，信息密度偏低。`);
  const silentChars = characters.filter((c) => c.lines === 0);
  if (silentChars.length) warnings.push(`${silentChars.map((c) => c.name).join('、')} 有出场无台词，检查是否工具人。`);
  const oneHit = characters.filter((c) => c.lines > 0 && c.episodes.length === 1);
  if (oneHit.length) warnings.push(`${oneHit.map((c) => c.name).join('、')} 只在单集出现，注意人物是否用足。`);
  const noCliff = perEpisode.filter((e) => !e.hasCliff).map((e) => `第${e.ep}集`);
  if (noCliff.length) warnings.push(`${noCliff.join('、')} 缺集尾悬念。`);

  return {
    totals: {
      episodes: episodes.length,
      scenes: totalScenes,
      seconds: totalSeconds,
      time: fmt(totalSeconds),
      lines: totalLines,
      spoken: characters.reduce((n, c) => n + c.chars, 0),
      characters: characters.length,
    },
    perEpisode,
    characters,
    rhythm,
    warnings,
  };
}
