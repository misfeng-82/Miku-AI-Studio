/* 视图域：资产中心 —— 资产库 / 台词本 / 人物关系
 * 2026-10-19：分镜拆解功能整体下线，这里只保留三张资产侧页面。
 */
import { curInput,  state, api, esc, ICONS, ctx, needScript, busyBtn, pageHead, statStrip, toast, fmtTime } from '../core.js';
import { importCard } from './script.js';

export function viewAssets() {
  const r = state.data.assets;
  const tags = `<span class="tag purple">角色一致性</span><span class="tag blue">场景无人图</span><span class="tag amber">参考图禁串联</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>资产库</h2><div class="sub">角色一致性提示词 / 场景设定图（必须无人）/ 参考图策略——跨镜头不换脸的根基</div></div>
      <div class="actions">${curInput() ? busyBtn('assets', '生成资产提示词', 'box') : `<button class="btn btn-primary" disabled>${ICONS.box}生成资产提示词</button>`}</div></div>
    ${!curInput() ? `<div class="notice notice-warn">${ICONS.alert}<div>角色与场景来自大纲，请先载入剧本。</div></div>` : ''}
  </div>`;

  if (!curInput()) return pageHead('资产中心', '资产库', '每个角色一套锁定提示词，每个场景一张无人设定图，参考图只认已确认锚点——这是漫剧跨镜头一致的三件套。', tags) + importCard({ previewOpen: false }) + form + `<div style="margin-top:16px">${needScript()}</div>`;
  if (!r) return pageHead('资产中心', '资产库', '每个角色一套锁定提示词，每个场景一张无人设定图，参考图只认已确认锚点——这是漫剧跨镜头一致的三件套。', tags) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.box}</div><h3>等待生成</h3><p>点「生成资产提示词」。</p></div></div>`;

  const policy = r.referencePolicy ?? {};
  return pageHead('资产中心', '资产库', '每个角色一套锁定提示词，每个场景一张无人设定图，参考图只认已确认锚点——这是漫剧跨镜头一致的三件套。', tags) + form + `
  <div class="card">
    <div class="card-head"><div><h2>参考图策略</h2><div class="sub">取图顺序：${esc((policy.order ?? []).join(' → '))}</div></div><span class="tag amber">核心约束</span></div>
    <div class="gate-list">${(policy.rules ?? []).map((x) => `<div class="gate gate-ok"><span class="gate-icon">${ICONS.check}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(x)}</span><span></span></div>`).join('')}</div>
  </div>
  <div class="card">
    <div class="card-head"><div><h2>角色资产</h2><div class="sub">${r.characters.length} 个角色</div></div></div>
    <div class="grid-2">${r.characters.map((c) => `<div class="card card-tight asset-card">
      <div class="asset-head"><div><h3>${esc(c.name)}</h3><div class="sub">${esc(c.importance ?? '')}${c.variants?.length ? ` · ${c.variants.length} 变体` : ''}</div></div>
        <button class="btn btn-sm" data-copy="${esc(c.consistencyPrompt)}">${ICONS.copy}复制</button></div>
      <div class="pblock"><div class="pblock-head"><span class="ph-name">consistency · 跨镜头锁定</span></div><div class="pblock-body">${esc(c.consistencyPrompt)}</div></div>
      <div class="kv-grid">
        <div class="kv"><dt>设定图提示词</dt><dd class="mono" style="font-size:10px;color:var(--text-2)">${esc(c.sheetPrompt)}</dd></div>
        <div class="kv"><dt>反向词</dt><dd class="mono" style="font-size:10px;color:var(--rose)">${esc(c.negativePrompt)}</dd></div>
        <div class="kv"><dt>音色提示词</dt><dd style="font-size:11px">${esc(c.voicePrompt)}</dd></div>
      </div>
    </div>`).join('')}</div>
  </div>
  <div class="card">
    <div class="card-head"><div><h2>场景资产</h2><div class="sub">${r.scenes.length} 个场景 · 场景图必须无人</div></div></div>
    <div class="grid-2">${r.scenes.map((s) => `<div class="card card-tight asset-card">
      <div class="asset-head"><div><h3>${esc(s.name)}</h3><div class="sub">${s.primary ? '主场景' : '复用场景'} · 出现于 ${(s.usedInEpisodes ?? []).join('、') || '—'} 集</div></div>
        <button class="btn btn-sm" data-copy="${esc(s.imagePrompt)}">${ICONS.copy}复制</button></div>
      <div class="pblock"><div class="pblock-head"><span class="ph-name">scene plate · no people</span><span class="tag amber">必须无人</span></div><div class="pblock-body">${esc(s.imagePrompt)}</div></div>
      <div class="notice notice-warn">${ICONS.alert}<div>${esc(s.noPeopleGuard ?? '场景图必须无人：角色单独出图，合成时再放进场景，避免换装穿帮。')}</div></div>
      <div class="kv-grid">
        <div class="kv"><dt>空间锚点</dt><dd style="font-size:11px">${(s.anchors ?? []).map(esc).join('；') || '—'}</dd></div>
        <div class="kv"><dt>复用计划</dt><dd style="font-size:11px">${esc(s.reusePlan ?? '—')}</dd></div>
      </div>
    </div>`).join('')}</div>
  </div>`;
}

/* ================= 台词本 ================= */
export function viewLinebook() {
  const r = state.data.linebook;
  const tags = `<span class="tag purple">按角色汇总</span><span class="tag teal">音色 + 语速</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>台词本</h2><div class="sub">所有台词按角色归拢，标出超长句与语速，方便配音与节奏校准</div></div>
      <div class="actions">${curInput() ? busyBtn('lines', '生成台词本', 'message') : `<button class="btn btn-primary" disabled>${ICONS.message}生成台词本</button>`}
      ${r ? `<button class="btn" data-act="dlcsv">${ICONS.download}CSV</button><button class="btn" data-act="dlperformers">${ICONS.download}分角色台本</button>` : ''}</div></div>
    ${!curInput() ? `<div class="notice notice-warn">${ICONS.alert}<div>请先载入剧本。</div></div>` : ''}
  </div>`;

  if (!curInput()) return pageHead('资产中心', '台词本', '把剧本里所有台词按角色归拢：谁说了多少、说多久、音色怎么定，一眼看清。', tags) + importCard({ previewOpen: false }) + form + `<div style="margin-top:16px">${needScript()}</div>`;
  if (!r) return pageHead('资产中心', '台词本', '把剧本里所有台词按角色归拢：谁说了多少、说多久、音色怎么定，一眼看清。', tags) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.message}</div><h3>等待汇总</h3><p>点「生成台词本」。</p></div></div>`;

  const cur = r.characters.find((c) => c.id === state.sel.lineChar) ?? r.characters[0];
  return pageHead('资产中心', '台词本', '把剧本里所有台词按角色归拢：谁说了多少、说多久、音色怎么定，一眼看清。', tags) + form + `
  <div class="card">
    <div class="card-head"><div><h2>角色分布</h2><div class="sub">${r.characters.length} 个角色 · ${r.totals.lines} 句 · ${fmtTime(r.totals.seconds)}</div></div>
      <span class="tag purple">主导：${esc(r.dominant ?? '—')}</span></div>
    <div class="view-switcher" style="margin-bottom:16px">
      ${r.characters.map((c) => `<button class="${c.id === cur?.id ? 'active' : ''}" data-linechar="${c.id}">${esc(c.name)}<span class="vs-count">${c.count}</span></button>`).join('')}
    </div>
    ${cur ? `
    ${statStrip([
      { label: '句数 / 字数', value: `${cur.count} / ${cur.chars}`, cls: 'hl' },
      { label: '预计时长', value: fmtTime(cur.seconds) },
      { label: '均句字数', value: cur.avgChars },
      { label: '出场集数', value: (cur.episodes ?? []).join(',') || '—' },
    ])}
    <div class="kv-grid" style="margin-top:16px">
      <div class="kv"><dt>音色提示词</dt><dd>${esc(cur.voicePrompt ?? '—')}</dd></div>
    </div>
    ${r.warnings?.length ? `<div class="notice notice-warn" style="margin-top:14px">${ICONS.alert}<div>${esc(r.warnings.slice(0, 2).join('；'))}${r.warnings.length > 2 ? `（共 ${r.warnings.length} 条）` : ''}</div></div>` : ''}
    <div class="rows" style="margin-top:14px">${(cur.lines ?? []).map((l, i) => `<div class="row" style="grid-template-columns:40px 1fr auto">
      <div class="row-idx">${String(i + 1).padStart(2, '0')}</div>
      <div><div style="font-size:12.5px;line-height:1.7">${esc(l.text ?? '')}</div><div class="row-sub">${esc(l.delivery ?? '')}</div></div>
      <div class="row-side mono" style="font-size:10px;color:var(--text-4)">E${l.ep ?? ''}${l.scene ? ` · ${esc(l.scene)}` : ''}${l.seconds ? ` · ${l.seconds}s` : ''}</div>
    </div>`).join('') || '<div class="empty"><p>该角色没有台词</p></div>'}</div>` : ''}
  </div>`;
}

/* ================= 人物关系 ================= */
export function viewRelations() {
  const r = state.data.relations;
  const tags = `<span class="tag purple">共现推断</span><span class="tag blue">孤立角色检测</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>人物关系图</h2><div class="sub">从同场共现与对白往来推断关系网络，找出「没跟任何人同过场」的孤立角色</div></div>
      <div class="actions">${curInput() ? busyBtn('relations', '生成关系图', 'network') : `<button class="btn btn-primary" disabled>${ICONS.network}生成关系图</button>`}</div></div>
    ${!curInput() ? `<div class="notice notice-warn">${ICONS.alert}<div>请先载入剧本。</div></div>` : ''}
  </div>`;

  if (!curInput()) return pageHead('资产中心', '人物关系', '短剧人物关系不乱，观众才追得下去。这张图帮你确认：谁跟谁有戏、谁被写丢了。', tags) + importCard({ previewOpen: false }) + form + `<div style="margin-top:16px">${needScript()}</div>`;
  if (!r) return pageHead('资产中心', '人物关系', '短剧人物关系不乱，观众才追得下去。这张图帮你确认：谁跟谁有戏、谁被写丢了。', tags) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.network}</div><h3>等待生成</h3><p>点「生成关系图」。</p></div></div>`;

  return pageHead('资产中心', '人物关系', '短剧人物关系不乱，观众才追得下去。这张图帮你确认：谁跟谁有戏、谁被写丢了。', tags) + form + `
  <div class="card">
    <div class="card-head"><div><h2>关系网络</h2><div class="sub">${r.nodes.length} 个角色 · ${r.edges.length} 条关系</div></div>
      <span class="tag ${r.orphans.length ? 'rose' : 'teal'}">${r.orphans.length ? `${r.orphans.length} 个孤立` : '网络健康'}</span></div>
    <div class="notice ${r.orphans.length ? 'notice-warn' : 'notice-ok'}" style="margin-bottom:18px">${r.orphans.length ? ICONS.alert : ICONS.check}<div>${esc(r.advice)}</div></div>
    ${relGraph(r)}
  </div>
  <div class="card">
    <div class="card-head"><div><h2>关系强度排行</h2><div class="sub">权重 = 同场数 + 对白往来 × 2</div></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:40px">#</th><th>角色对</th><th>同场</th><th>对白</th><th style="width:120px">权重</th></tr></thead><tbody>
      ${r.edges.slice(0, 14).map((e, i) => { const a = r.nodes.find((n) => n.id === e.a); const b = r.nodes.find((n) => n.id === e.b);
        const max = r.edges[0]?.weight || 1;
        return `<tr><td class="row-idx">${i + 1}</td><td class="row-title">${esc(a?.name ?? e.a)} ↔ ${esc(b?.name ?? e.b)}</td>
          <td class="mono">${e.scenes}</td><td class="mono">${e.talks}</td>
          <td><div style="display:flex;align-items:center;gap:8px"><div class="bar-track" style="flex:1"><span class="bar-fill" style="width:${(e.weight / max) * 100}%"></span></div><span class="mono" style="font-size:10.5px">${e.weight}</span></div></td></tr>`; }).join('')}
    </tbody></table></div>
  </div>`;
}

/* 关系图：圆形布局 + 力导向式的简单环绕 */
function relGraph(r) {
  const nodes = r.nodes;
  const w = 560, h = 300, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 56;
  const pos = new Map(nodes.map((n, i) => {
    const ang = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return [n.id, { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }];
  }));
  const nameOf = (id) => nodes.find((n) => n.id === id)?.name ?? id;
  const maxW = r.edges[0]?.weight || 1;
  const edges = r.edges.map((e) => {
    const a = pos.get(e.a), b = pos.get(e.b);
    if (!a || !b) return '';
    return `<line class="edge ${e.weight >= maxW * 0.6 ? 'strong' : ''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"></line>`;
  }).join('');
  const circles = nodes.map((n) => {
    const p = pos.get(n.id);
    const main = (n.degree ?? 0) >= Math.max(...nodes.map((x) => x.degree ?? 0)) * 0.7;
    return `<g><circle class="node-circle ${main ? 'main' : ''}" cx="${p.x}" cy="${p.y}" r="${main ? 22 : 17}"></circle>
      <text class="node-label" x="${p.x}" y="${p.y + 4}" text-anchor="middle">${esc(n.name.slice(0, 3))}</text>
      <text class="node-sub" x="${p.x}" y="${p.y + (main ? 38 : 32)}" text-anchor="middle">${esc(n.role ?? '')}${n.degree ? ` · ${n.degree}关系` : ''}</text></g>`;
  }).join('');
  return `<svg class="rel-graph" viewBox="0 0 ${w} ${h}">${edges}${circles}</svg>`;
}

/* ================= 运行器 ================= */
export const runners = {
  async assets() {
    if (!curInput()) return toast('请先载入剧本（角色场景来自大纲）', 'warn');
    state.data.assets = await api.assets(ctx());
    toast(`资产提示词完成：${state.data.assets.characters.length} 角色 / ${state.data.assets.scenes.length} 场景`);
  },
  async lines() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    state.data.linebook = await api.linebook(ctx());
    state.sel.lineChar = state.sel.lineChar ?? state.data.linebook.characters[0]?.id ?? null;
    toast(`台词本完成：${state.data.linebook.totals.lines} 句 / ${fmtTime(state.data.linebook.totals.seconds)}`);
  },
  async relations() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    state.data.relations = await api.relations(ctx());
    toast('关系图已生成');
  },
};
