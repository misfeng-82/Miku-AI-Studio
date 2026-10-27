/* 视图域：效率工具 —— 提示词模板 / 台词润色 / 爆款标题 */
import { state, api, esc, ICONS, busyBtn, pageHead, toast, copyText } from '../core.js';

/* ================= 提示词模板 ================= */
export function viewTemplates() {
  const tpls = state.meta?.templates ?? [];
  const dims = state.meta?.dimensions ?? [];
  const cur = tpls.find((t) => t.id === state.cfg.tplId) ?? tpls[0];
  const filled = state.data.tpl;
  const tags = `<span class="tag purple">${tpls.length} 个模板</span><span class="tag blue">5 组描述维度</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>提示词模板库</h2><div class="sub">填变量即用；配合画风后缀与反向词，别散落字符串</div></div></div>
    <div class="view-switcher" style="margin-bottom:16px">
      ${tpls.map((t) => `<button class="${cur?.id === t.id ? 'active' : ''}" data-tpl="${t.id}">${esc(t.name)}</button>`).join('')}
    </div>
    ${cur ? `
    <div class="notice notice-ai">${ICONS.book}<div>${esc(cur.description ?? '')}　<span class="muted">目标：${esc(cur.target ?? '')}</span></div></div>
    <div class="form-2" style="margin-top:14px">${(cur.variables ?? []).map((v) => `
      <label class="field"><span class="fl">${esc(v)}</span><input type="text" data-tplvar="${esc(v)}" value="${esc(state.cfg.tplVars[v] ?? '')}" placeholder="${esc(v)}" /></label>`).join('') || '<div class="notice">这个模板没有变量，直接填充即可。</div>'}</div>
    <div class="actions" style="margin-top:14px">
      ${busyBtn('tpl', '填充模板', 'play')}
      ${filled ? `<button class="btn" data-copy="${esc(filled.text)}">${ICONS.copy}复制结果</button>` : ''}
    </div>
    ${filled ? `<div class="pblock" style="margin-top:14px"><div class="pblock-head"><span class="ph-name">filled prompt</span><span class="tag outline">${esc(filled.text.length)} 字</span></div><div class="pblock-body">${esc(filled.text)}</div></div>` : ''}
    ` : ''}
  </div>
  <div class="card">
    <div class="card-head"><div><h2>描述维度词典</h2><div class="sub">写提示词时按维度逐项过，避免漏项</div></div></div>
    <div class="grid-2">${dims.map((d) => `<div><div class="fl" style="margin-bottom:7px">${esc(d.name)}</div><div class="chip-row">${(d.items ?? []).map((x) => `<span class="chip static">${esc(x)}</span>`).join('')}</div></div>`).join('')}</div>
  </div>`;

  return pageHead('效率工具', '提示词模板', '角色三视图、场景模型图、片段构图、视频连续性约束——成体系的模板，填变量就出活。', tags) + form;
}

/* ================= 台词润色 ================= */
export function viewPolish() {
  const r = state.data.polish;
  const tags = `<span class="tag purple">确定性规则</span><span class="tag teal">可核对改动</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>台词润色</h2><div class="sub">只做机器一定能改对的事：去口头禅、拆长句、补标点、清残标点</div></div></div>
    <label class="field"><span class="fl">单句台词</span>
      <textarea rows="3" data-cfg="polishLine" placeholder="那个，我跟你说，反正就是我今天就是说不太想去，然后呢就算了">${esc(state.cfg.polishLine)}</textarea></label>
    <div class="actions" style="margin-top:12px">${busyBtn('polish', '润色这句', 'wand')}
      <span class="muted" style="font-size:10.5px">涉及重写的交给「剧本优化 → 规则改写」，这里不碰语义</span></div>
  </div>`;

  if (!r) return pageHead('效率工具', '台词润色', '一句台词粘贴进来，机器按规则改：口头禅清掉、超长句拆开、标点收尾。每处改动都列出来，可核对。', tags) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.wand}</div><h3>等待润色</h3><p>粘贴一句台词，点「润色这句」。</p></div></div>`;

  return pageHead('效率工具', '台词润色', '一句台词粘贴进来，机器按规则改：口头禅清掉、超长句拆开、标点收尾。每处改动都列出来，可核对。', tags) + form + `
  <div class="card">
    <div class="card-head"><div><h2>润色结果</h2><div class="sub">${r.changes.length} 处改动</div></div>
      <span class="tag ${r.chars > 34 ? 'amber' : 'teal'}">${r.chars} 字 · 约 ${r.seconds}s</span></div>
    <div class="grid-2">
      <div class="card card-tight card-quiet"><div class="fl" style="margin-bottom:8px">原文</div><div style="font-size:12.5px;line-height:1.8;color:var(--text-3)">${esc(r.original)}</div></div>
      <div class="card card-tight" style="border-color:rgba(83,74,183,.3)"><div class="fl" style="margin-bottom:8px;color:var(--violet)">润色后</div><div style="font-size:12.5px;line-height:1.8">${esc(r.polished)}</div>
        <div class="actions" style="margin-top:10px"><button class="btn btn-sm" data-copy="${esc(r.polished)}">${ICONS.copy}复制</button></div></div>
    </div>
    ${r.changes.length ? `<div class="gate-list" style="margin-top:14px">${r.changes.map((c) => `<div class="gate gate-ok"><span class="gate-icon">${ICONS.check}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(c)}</span><span></span></div>`).join('')}</div>` : '<div class="notice notice-ok" style="margin-top:14px">' + ICONS.check + '<div>这句已经很干净，没有可机器修复的点。</div></div>'}
  </div>`;
}

/* ================= 爆款标题 ================= */
export function viewTitles() {
  const r = state.data.titles;
  const genres = ['女频逆袭', '悬疑', '都市', '古风'];
  const tags = `<span class="tag purple">组合矩阵</span><span class="tag amber">不玄学</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>爆款标题生成</h2><div class="sub">爆款标题有强结构：题材词 × 钩子词 × 情绪反应。把骨架列出来让人挑，比模型瞎编可控</div></div></div>
    <div class="form-2">
      <div class="field"><span class="fl">题材</span><div class="chip-row">${genres.map((g) => `<button class="chip ${state.cfg.titleGenre === g ? 'active' : ''}" data-titlegenre="${g}">${g}</button>`).join('')}</div></div>
      <label class="field"><span class="fl">候选数量</span><input type="number" min="4" max="40" data-cfg="titleCount" value="${esc(state.cfg.titleCount)}" /></label>
    </div>
    <div class="form-2" style="margin-top:12px">
      <label class="field"><span class="fl">关键词（可空）</span><input type="text" data-cfg="titleKw" value="${esc(state.cfg.titleKw)}" placeholder="如：渡口" /></label>
      <label class="field"><span class="fl">你的钩子（可空）</span><input type="text" data-cfg="titleHook" value="${esc(state.cfg.titleHook)}" placeholder="如：被当众退婚" /></label>
    </div>
    <div class="actions" style="margin-top:14px">${busyBtn('titles', '生成候选', 'type')}</div>
  </div>`;

  if (!r) return pageHead('效率工具', '爆款标题', '标题是短剧的第一钩子。用结构化组合批量出候选，每条标注用了什么句式，方便复盘哪种结构最能打。', tags) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.type}</div><h3>等待生成</h3><p>选题材、填关键词，点「生成候选」。</p></div></div>`;

  return pageHead('效率工具', '爆款标题', '标题是短剧的第一钩子。用结构化组合批量出候选，每条标注用了什么句式，方便复盘哪种结构最能打。', tags) + form + `
  <div class="card">
    <div class="card-head"><div><h2>候选标题</h2><div class="sub">${r.items.length} 条 · 候选池 ${r.total} 条 · 题材「${esc(r.genre)}」</div></div></div>
    <div class="grid-2">${r.items.map((t) => `<div class="card card-tight" style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;line-height:1.5">${esc(t.text)}</div>
        <div style="margin-top:4px"><span class="tag outline">${esc(t.formula)}</span> <span class="muted mono" style="font-size:10px">${t.chars} 字</span></div></div>
      <button class="btn btn-sm" data-copy="${esc(t.text)}">${ICONS.copy}</button>
    </div>`).join('')}</div>
  </div>`;
}

/* ================= 运行器 ================= */
export const runners = {
  async tpl() {
    const id = state.cfg.tplId;
    if (!id) return toast('先选一个模板', 'warn');
    state.data.tpl = await api.fillTemplate(id, state.cfg.tplVars);
    toast('模板填充完成');
  },
  async polish() {
    const line = state.cfg.polishLine;
    if (!line.trim()) return toast('先粘贴一句台词', 'warn');
    state.data.polish = await api.polish({ line });
    toast('润色完成');
  },
  async titles() {
    state.data.titles = await api.titles({
      genre: state.cfg.titleGenre, keyword: state.cfg.titleKw,
      hook: state.cfg.titleHook, count: Number(state.cfg.titleCount) || 12,
    });
    toast(`生成 ${state.data.titles.items.length} 条候选`);
  },
};
