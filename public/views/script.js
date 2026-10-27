/* 视图域：剧本创作 —— AI 生成（都市涅槃标准稿）+ 格式转换
 *
 * 2026-10-17：剧本生成以「三段式 + 引擎门」重建（git 8e39427 曾整体下线旧生成框）。
 * 方法论来自 honolulu0/llm-script-factory（MIT）与 zenstory-ai/drama-skills（MIT），
 * 格式契约见 src/assets/scriptSpec.js，后端在 src/services/scriptGenService.js。
 *
 * 流程与「先预览、确认，再生产」一致：每一步的产物都落在这里给人看，
 * 人点了下一步才继续；组装出来的整稿和「载入剧本」走同一条下游。
 */
import { curInput, setCurInput, clearOwnResult,  state, api, esc, ICONS, ctx, busyBtn, pageHead, toast, download, gateList, isLiveLLM, llmLabel, save, statStrip, render, llmModeLabel } from '../core.js';
import { parseScriptText, parseScriptJson, statsOf, describeImport } from '../parseScriptText.js';

/* ================= 载入剧本 ================= */
/** 剧本从哪来之二：用户直接给（粘贴 / 上传），不经任何生成链路
 *
 * 这张卡有三个状态，各自要说人话：
 *   ① 还没载入 —— 入口要显眼，格式要求写在旁边
 *   ② 载入成功 —— 立刻给出「载入到了什么」（集数/场数/台词/人物）+ 正文预览
 *   ③ 载入失败 —— 不要只弹个 2.6 秒就消失的 toast，把原因和改法留在页面上
 */

/** 说话人：优先用原文写的名字（delivery），解析器把只开口一集的人并进群演桶时不至于全变成「群演」 */
function writtenName(beat, names) {
  const raw = String(beat?.delivery ?? '').split(/\s+/)[0].trim();
  return raw || names.get(beat?.speaker) || beat?.speaker || '旁白';
}

/** 单集 → 给人看的正文（和导出的标准稿同构，只是前端轻量版） */
function epPreviewText(ep, names) {
  const out = [];
  (ep?.scenes ?? []).forEach((sc, i) => {
    out.push(`场${ep.ep}-${i + 1} ${sc.lighting ?? '夜'} ${sc.name ?? ''}`.trim());
    for (const b of sc.flow ?? []) {
      if (typeof b.line === 'string' && b.line.trim()) out.push(`${writtenName(b, names)}：${b.line.trim()}`);
      else if (typeof b.action === 'string' && b.action.trim() && !/^【黑屏】|^【钩子字幕】/.test(b.action)) out.push(`△${b.action.trim()}`);
    }
    out.push('');
  });
  return out.join('\n').trim();
}

const FMT_SAMPLE = `## 第1集
场1-1 夜 内 渡口·码头
人物：阿莲、船客
△阿莲推门进来，手里拎着一只旧木箱。
阿莲：这箱子上了船，就下不去了。
船客：谁的箱子，谁心里清楚。
【钩子字幕】箱子里有东西。
【黑屏】第1集完`;

function importErrorBox(err) {
  return `<div class="notice notice-warn">${ICONS.alert}<div>
    <b>没能读成剧本：${esc(err.message)}</b>
    <div class="muted" style="margin-top:6px;font-size:11px">
      常见原因：① 少了「## 第1集」这样的集标题；② 场号行不是「场1-1 夜 内 地点」；
      ③ 台词没写「角色名：」；④ 文件不是 UTF-8；⑤ JSON 里没有 episodes 数组。
    </div>
    <details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px">看一份最简可用格式</summary>
      <div class="pblock" style="margin-top:6px"><div class="pblock-head"><span class="ph-name">最简示例</span><span class="tag outline">可直接粘贴</span></div>
        <div class="pblock-body" style="white-space:pre-wrap">${esc(FMT_SAMPLE)}</div></div>
    </details>
  </div></div>`;
}

/** 载入后到底载进了什么：统计条 + 人物 + 第一集正文 + 分集清单 */
function importedPreview(previewOpen = true) {
  const g = curInput();
  const s = g.script;
  const o = g.outline ?? {};
  const st = g.importedStats ?? statsOf(s);
  const names = new Map((o.characters ?? []).map((c) => [c.id, c.name]));
  const eps = s.episodes ?? [];
  const first = eps[0];
  // 人物数按「台词前面写的名字」算：解析器的群演桶会把单集里的人都并成 1 个 id，
  // 用它报「1 个角色」会让人以为剧本只写了一个人
  const cast = [...new Set(eps.flatMap((e) => (e.scenes ?? []).flatMap((sc) => (sc.flow ?? []).filter((b) => b.line).map((b) => writtenName(b, names)))))].filter((n) => n !== '旁白');
  return `
  <div class="notice notice-ok">${ICONS.check}<div>已载入${g.importedFrom ? `「${esc(g.importedFrom)}」` : ''}：${st.episodes} 集 / ${st.scenes} 场 / ${st.lines} 句台词 / ${cast.length || st.characters} 个人物 / 约 ${Math.floor(st.seconds / 60)} 分 ${st.seconds % 60} 秒${g.imported ? '' : '（来自生成结果）'}</div></div>
  ${statStrip([
    { label: '集数', value: st.episodes, cls: 'hl' },
    { label: '场次', value: st.scenes },
    { label: '台词', value: st.lines },
    { label: '人物', value: cast.length || st.characters },
    { label: '时长', value: `${Math.floor(st.seconds / 60)}分${st.seconds % 60}秒` },
  ])}
  <details style="margin-top:12px"${previewOpen ? ' open' : ''}>
    <summary style="cursor:pointer;font-size:11.5px;color:var(--text-3)">查看剧本内容（第 1 集正文 + 分集清单）</summary>
  ${cast.length ? `<div class="chip-row" style="margin-top:10px">${cast.slice(0, 16).map((n) => `<span class="chip">${esc(n)}</span>`).join('')}${cast.length > 16 ? `<span class="chip muted">+${cast.length - 16}</span>` : ''}</div>` : ''}
  ${first ? `<div class="pblock" style="margin-top:12px">
    <div class="pblock-head"><span class="ph-name">第 ${first.ep} 集预览（共 ${eps.length} 集）</span><span class="tag outline">${first.scenes?.length ?? 0} 场</span></div>
    <div class="pblock-body" style="max-height:240px">${esc(epPreviewText(first, names))}</div>
  </div>` : ''}
  <div class="rows" style="margin-top:12px">${eps.slice(0, 40).map((e) => {
    const lines = (e.scenes ?? []).reduce((n, sc) => n + (sc.flow ?? []).filter((b) => b.line).length, 0);
    const hook = String(e.cliff || e.hook || '').replace(/【黑屏】[\s\S]*$/, '').trim();
    return `<div class="row" style="grid-template-columns:1fr">
      <div><div class="row-title" style="font-size:11.5px">第 ${e.ep} 集 · ${e.scenes?.length ?? 0} 场 · ${lines} 句</div>
        <div class="row-sub">${esc(hook || '（这集没写集尾钩子）')}</div></div>
    </div>`;
  }).join('')}${eps.length > 40 ? `<div class="muted" style="padding:8px;font-size:11px">……还有 ${eps.length - 40} 集，完整内容去「格式转换」导出查看</div>` : ''}</div>
  </details>`;
}

function importEditor() {
  return `<label class="field"><span class="fl">剧本内容（粘贴，或点下面的「选剧本文件」）</span>
      <textarea rows="7" data-cfg="importText" placeholder="## 第1集&#10;场1-1 夜 内 渡口·码头&#10;人物：阿莲、船客&#10;△阿莲推门进来，手里拎着一只旧木箱。&#10;阿莲：这箱子上了船，就下不去了。&#10;【钩子字幕】箱子里有东西。&#10;【黑屏】第1集完">${esc(state.cfg.importText ?? '')}</textarea></label>
    <div class="actions" style="margin-top:10px">
      <label class="btn" style="cursor:pointer">${ICONS.download}选剧本文件<input type="file" id="importFile" accept=".txt,.md,.json,.fountain,text/plain,application/json" hidden /></label>
      <button class="btn btn-primary" data-run="load">${ICONS.film}载入并预览</button>
      <span class="muted" style="font-size:10.5px">认两种文本格式：短剧场号（第1集／场1-2 夜 内 地点／角色名：台词）与《都市涅槃》标准稿（## 第N集／△动作／【钩子字幕】）；.json 直接读结构</span>
    </div>`;
}

export function importCard({ previewOpen = true } = {}) {
  const g = curInput();
  const loaded = Boolean(g?.script);
  const st = loaded ? (g.importedStats ?? statsOf(g.script)) : null;
  // 报错也只属于当前工具：别的工具留下的错误不该在这里显示
  const err = state.data.importError?.view === state.view ? state.data.importError : null;

  return `<div class="card">
    <div class="card-head"><div><h2>载入剧本</h2><div class="sub">本地文件（.txt / .md / .json / .fountain）或直接粘贴。原样载入、不改写，载完就能评估和优化</div></div>
      <span class="tag ${loaded ? 'teal' : 'outline'}">${loaded ? `已载入 · ${st.episodes} 集` : '未载入'}</span></div>
    ${err ? importErrorBox(err) : ''}
    ${loaded ? importedPreview(previewOpen) : ''}
    ${loaded
      ? `<details style="margin-top:12px"${err ? ' open' : ''}><summary style="cursor:pointer;font-size:11.5px;color:var(--text-3)">换一份剧本</summary>
          <div style="margin-top:10px">${importEditor()}</div></details>`
      : `<div style="margin-top:2px">${importEditor()}</div>`}
  </div>`;
}

async function loadScript() {
  return loadFromText(state.cfg.importText ?? '', '粘贴内容');
}

/** 文件/粘贴/JSON 共用一条入口：认格式、给状态、失败留在页面上 */
export async function loadFromText(text, sourceName = '') {
  const raw = String(text ?? '');
  state.data.importError = null;

  if (!raw.trim()) {
    state.data.importError = { view: state.view, message: '内容是空的：先把剧本贴进来，或选一个文件' };
    return toast('内容是空的：先贴剧本或选文件', 'warn');
  }
  if (raw.length > 400000) {
    state.data.importError = { view: state.view, message: `内容太长（${Math.round(raw.length / 1000)}k 字符），一次最多 400k` };
    return toast('内容过长，超过 400k 字符', 'warn');
  }

  // 看着像 JSON 就先按结构读；读不出来再退回文本解析（有人把 JSON 贴错成文本）
  let parsed;
  if (/^\s*[[{]/.test(raw)) {
    const asJson = parseScriptJson(raw);
    parsed = asJson.ok ? asJson : parseScriptText(raw);
    if (!asJson.ok && !parsed.ok) parsed = asJson; // 两个都失败时，JSON 的错更能说明问题
  } else {
    parsed = parseScriptText(raw);
  }

  if (!parsed.ok) {
    state.data.importError = { view: state.view, message: parsed.message || '格式没认出来' };
    return toast(`没能载入：${parsed.message ?? '格式没认出来'}`, 'warn');
  }

  const stats = parsed.stats ?? statsOf(parsed.script);
  // 写进「本工具自己的输入槽」——不是全局共享，别的工具看不到
  setCurInput({
    script: parsed.script,
    outline: parsed.outline,
    llm: null,
    imported: true,
    importedStats: stats,
    importedSummary: describeImport(stats),
    importedFrom: sourceName,
  });
  // 只清本工具自己的结果，不动别的工具（它们各自独立）
  clearOwnResult();
  // 不再写入项目：这份剧本只做为「本工具」的输入。要用到别的工具，请下载成文件再在那边载入。
  toast(`已载入剧本：${describeImport(stats)}`);
}

/* ================= AI 生成（都市涅槃标准稿 · 四段式） ================= */

/** 题材库由后端 /api/meta 下发（32 个题材 + 大类/频道/时代/篇幅维度），前端不再抄一份中文表 */
const G = () => state.meta?.genres ?? { categories: [], channels: [], eras: [], formats: [], items: [] };
const genreItem = (id) => G().items.find((x) => x.id === id) ?? null;
const selectedGenres = () => (state.cfg.genGenreIds ?? []).map(genreItem).filter(Boolean);

/** 维度筛选条：时代 / 频道 / 篇幅 */
function genreFilters() {
  const g = G();
  const row = (label, key, list, cur) => `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
    <span class="muted" style="font-size:11px;min-width:34px">${label}</span>
    <button class="chip ${!cur ? 'active' : ''}" data-gfilter="${key}">全部</button>
    ${list.map((x) => `<button class="chip ${cur === x.id ? 'active' : ''}" data-gfilter="${key}:${x.id}" title="${esc(x.hint ?? '')}">${esc(x.label)}</button>`).join('')}
  </div>`;
  return row('时代', 'era', g.eras ?? [], state.cfg.genEra)
    + row('频道', 'channel', g.channels ?? [], state.cfg.genChannel)
    + row('篇幅', 'format', g.formats ?? [], state.cfg.genFormat);
}

/** 类型网格：按大类分组，多选（第 1 个是主题材，最多 3 个） */
function genreGrid() {
  const g = G();
  const era = state.cfg.genEra;
  const ch = state.cfg.genChannel;
  const picked = state.cfg.genGenreIds ?? [];
  const items = (g.items ?? []).filter((x) => (!era || x.era === era) && (!ch || x.channel === ch || x.channel === 'all'));
  if (!items.length) return `<div class="notice notice-warn" style="margin:10px 0">${ICONS.alert}<div>这个筛选组合下没有题材，换个时代或频道试试。</div></div>`;
  const order = picked.map((id) => items.find((x) => x.id === id)).filter(Boolean);
  const groups = (g.categories ?? [])
    .map((c) => ({ ...c, list: items.filter((x) => x.category === c.id) }))
    .filter((c) => c.list.length);

  return `<div style="margin-top:6px;max-height:260px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-sm);padding:10px">
    ${groups.map((c) => `<div style="margin-bottom:10px">
      <div class="muted" style="font-size:10.5px;margin-bottom:5px">${esc(c.name)} · ${esc(c.hint)}</div>
      <div class="chip-row">
        ${c.list.map((x) => {
          const i = picked.indexOf(x.id);
          return `<button class="chip ${i >= 0 ? 'active' : ''}" data-genre="${x.id}" title="${esc(x.tagline)}｜${esc(x.keywords.join(' / '))}">
            ${i >= 0 ? `<b style="margin-right:4px">${i + 1}</b>` : ''}${esc(x.name)}${x.legacy ? '' : '<span class="tag outline" style="margin-left:5px">新</span>'}
          </button>`;
        }).join('')}
      </div>
    </div>`).join('')}
  </div>
  ${order.length ? `<div style="margin-top:10px">
    <div class="muted" style="font-size:10.5px">已选（第 1 个是主题材，其余作为融合参考）：</div>
    <div class="chip-row" style="margin-top:6px">
      ${order.map((x, i) => `<span class="chip active">${i + 1}. ${esc(x.name)}<span data-genre="${x.id}" style="margin-left:6px;cursor:pointer;opacity:.7">×</span></span>`).join('')}
    </div>
    <div style="margin-top:6px;font-size:11px" class="muted">${esc(order[0].tagline)}</div>
  </div>` : ''}`;
}

/** 步骤 ①：题材 + 创意 */
function genStepConcept() {
  const g = G();
  const fmt = (g.formats ?? []).find((f) => f.id === state.cfg.genFormat);
  const picked = selectedGenres();
  const custom = (state.cfg.genCustom ?? '').trim();
  return `<div class="card">
    <div class="card-head"><div><h2>① 题材与创意</h2><div class="sub">先定题材坐标，再写一句创意。题材决定爽点优先序、人物配比与集尾钩子类型</div></div>
      <span class="tag outline">${(g.items ?? []).length} 个题材</span></div>
    ${genreFilters()}
    ${genreGrid()}
    <label class="field" style="margin-top:12px"><span class="fl">自定义题材（写了就覆盖上面的主题材）</span>
      <input class="editable" type="text" data-cfg="genCustom" value="${esc(state.cfg.genCustom ?? '')}" placeholder="例：都市玄学+古董鉴定，主角能看见物件上的旧事"></label>
    <label class="field" style="margin-top:10px"><span class="fl">创意描述</span>
      <textarea rows="4" data-cfg="genConcept" placeholder="例：都市重生复仇。女主被闺蜜与未婚夫联手夺走公司，重生回到他们密谋窃取项目的酒会当晚。这一世她收起柔软，步步为营。">${esc(state.cfg.genConcept ?? '')}</textarea></label>
    <div class="form-2" style="margin-top:10px">
      <label class="field"><span class="fl">集数${fmt ? `（${esc(fmt.label)}建议 ${fmt.episodes} 集）` : ''}</span>
        <input class="editable" type="number" min="1" max="100" value="${esc(state.cfg.genEpisodes ?? 40)}" data-cfg="genEpisodes"></label>
      <label class="field"><span class="fl">当前组合</span>
        <div class="muted" style="font-size:11px;padding-top:6px">${esc(custom || picked[0]?.name || '未选题材（走默认：都市重生复仇）')}${picked.length > 1 ? ` ＋${esc(picked.slice(1).map((x) => x.name).join('、'))}` : ''}</div></label>
    </div>
    <div class="actions" style="margin-top:10px">
      ${busyBtn('genStory', '生成梗概与人设', 'spark')}
      <span class="muted" style="font-size:10.5px">一次模型调用；未接入模型时会明确报错并引导你配置，不返回样本稿</span>
    </div>
  </div>`;
}

/** 步骤 ②：梗概与人物小传 */
function genStepStory(f) {
  const s = f.story;
  return `<div class="card">
    <div class="card-head"><div><h2>② 梗概与人物小传</h2><div class="sub">《${esc(s.title)}》· ${esc(s.genre)} · 共 ${esc(s.episodes)} 集${s.genreMeta?.variant ? ` · 本次设定：${esc(Object.values(s.genreMeta.variant).join(' / '))}` : ''}</div></div>
      <button class="btn" data-run="genStory">${ICONS.refresh}换个开局重写</button></div>
    <div class="pblock"><div class="pblock-head"><span class="ph-name">故事梗概</span></div>
      <div class="pblock-body">${esc(s.synopsis)}</div></div>
    <div class="chip-row" style="margin-top:10px">
      ${s.characters.map((c) => `<span class="chip" title="${esc(c.desc)}">${esc(c.name)}｜${esc(c.role)}</span>`).join('')}
    </div>
    <div class="actions" style="margin-top:12px">
      ${busyBtn('genOutline', '生成分集大纲', 'list')}
      <span class="muted" style="font-size:10.5px">一次一批 10 集，带前情串联；过大纲 14 门</span>
    </div>
  </div>`;
}

/** 段落名：后端下发，取不到就原样显示 id */
const stageLabel = (id) => (state.meta?.structure?.rhythmStages ?? []).find((s) => s.id === id)?.label ?? id;

/** 反派分层卡：谁在第几集被解决——四层递进是短剧对抗感的骨架 */
function villainCard(f) {
  const tiers = state.meta?.structure?.villainTiers ?? [];
  const rows = tiers
    .map((t) => ({ ...t, names: (f.story?.characters ?? []).filter((c) => c.villain === t.id).map((c) => `${c.name}｜${c.role}`) }))
    .filter((t) => t.names.length);
  if (!rows.length) return '';
  const eps = f.outline?.episodes ?? [];
  return `<div class="card">
    <div class="card-head"><div><h2>反派分层</h2><div class="sub">递进式对抗：每层被解决后要有「更大的威胁出现」的过渡</div></div>
      <span class="tag outline">${rows.length} 层</span></div>
    ${rows.map((t) => {
      const range = eps.filter((e) => (e.characterIds ?? []).length && (f.outline.characters ?? []).some((c) => (e.characterIds ?? []).includes(c.id) && (f.story?.characters ?? []).some((x) => x.name === c.name && x.villain === t.id)));
      const at = range.length ? `活跃：第 ${range[0].ep}–${range[range.length - 1].ep} 集` : '尚未出场';
      return `<div style="margin-bottom:8px">
        <div style="font-size:12px"><b>${esc(t.label)}</b> <span class="muted" style="font-size:10.5px">${esc(at)}</span></div>
        <div class="chip-row" style="margin-top:4px">${t.names.map((n) => `<span class="chip">${esc(n)}</span>`).join('')}</div>
        <div class="muted" style="font-size:10.5px;margin-top:3px">${esc(t.role)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/** 步骤 ③：分集大纲 + 逐集正文 */
function genStepOutline(f) {
  const o = f.outline;
  const eps = f.eps ?? {};
  const done = Object.keys(eps).length;
  const total = o.episodes.length;
  const run = f.run ?? null;
  const running = Boolean(run?.running);
  const pct = total ? Math.round((done / total) * 100) : 0;

  // 增量生成控制条：一段一集，写完立刻上屏，全部完成后自动组装
  const runner = `<div class="card card-tight" style="margin-top:12px;padding:12px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      ${running
        ? `<button class="btn btn-sm btn-danger" data-run="genStop">${ICONS.x}停止</button>`
        : busyBtn('genRun', done ? (done < total ? '继续增量生成' : '重新增量生成') : '开始增量生成', 'play')}
      <span class="tag ${done === total ? 'teal' : 'outline'}">${done} / ${total} 段</span>
      ${running ? `<span class="tag amber">正在写第 ${run.currentEp} 集…</span>` : ''}
      ${!running && run?.failedEp ? `<span class="tag rose">第 ${run.failedEp} 集失败，可续跑</span>` : ''}
      <span class="muted" style="font-size:10.5px;flex:1;min-width:200px">每段 = 一集（3–5 场）。写完一段立刻出现在下面，全部完成后自动组装整稿交付</span>
    </div>
    <div class="bar-track"><span class="bar-fill ${done === total ? 'teal' : 'blue'}" style="width:${pct}%"></span></div>
  </div>`;

  return `<div class="card">
    <div class="card-head"><div><h2>③ 分集大纲与逐集正文</h2><div class="sub">${total} 集大纲 · 已写 ${done} 集 · 每段单独调用、单独过门</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="copyallep"${done ? '' : ' disabled'} title="${done ? `把已写好的 ${done} 集正文按集序拼成一份复制` : '还没有写好的集：先点某一集的「写第 N 集」'}">${ICONS.copy}复制全集</button>
        <button class="btn" data-run="genOutline">${ICONS.refresh}重写大纲</button>
      </div></div>
    ${runner}
    <div class="pblock"><div class="pblock-head"><span class="ph-name">爽点分布</span><span class="tag outline">${o.beats.length} 个</span></div>
      <div class="pblock-body" style="max-height:180px;overflow:auto">${o.beats.map((b) => `<div style="margin-bottom:4px"><b>第${b.episode}集</b> ${b.weight === 'major' ? '<span class="tag rose">大爆点</span>' : ''} ${esc(b.type)}：${esc(b.setup)} → ${esc(b.payoff)}</div>`).join('')}</div></div>
    <div style="margin-top:12px">
      ${o.episodes.map((e) => {
        const r = eps[e.ep];
        const ok = r?.passed;
        const isCurrent = running && run.currentEp === e.ep;
        return `<div class="card" style="margin-bottom:8px;padding:12px${isCurrent ? ';border-color:rgba(59,110,246,.45)' : ''}">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <b style="min-width:44px">第${e.ep}集</b>
            ${e.paywall ? '<span class="tag rose" title="付费卡点：必须停在情绪最高点">💰 卡点</span>' : ''}
            ${e.hookType ? `<span class="tag outline" title="集尾钩子类型">${esc(e.hookType)}</span>` : ''}
            ${e.stage ? `<span class="muted" style="font-size:10.5px" title="所属节奏段落">${esc(stageLabel(e.stage))}</span>` : ''}
            <span class="muted" style="flex:1;min-width:200px;font-size:11.5px">${esc((e.synopsis ?? '').slice(0, 60))}${e.synopsis?.length > 60 ? '…' : ''}</span>
            ${isCurrent ? '<span class="tag amber"><span class="spin"></span> 生成中…</span>' : ''}
            ${r ? (ok
              ? `<span class="tag teal">门 ${r.gates.filter((g) => g.ok).length}/${r.gates.length}</span>`
              : `<span class="tag amber">门 ${r.gates.filter((g) => g.ok).length}/${r.gates.length}</span>`)
              : ''}
            ${r ? `<span class="muted" style="font-size:10.5px">${r.text.length} 字</span>` : ''}
            ${r ? `<button class="btn" data-genepview="${e.ep}">${r.open ? '收起' : '看正文'}</button>`
              : (running || state.busy?.genEp
                ? `<button class="btn" disabled>${isCurrent ? '处理中…' : '排队中'}</button>`
                : `<button class="btn btn-primary" data-genep="${e.ep}">${ICONS.film}写第${e.ep}集</button>`)}
          </div>
          ${r?.open ? `<div class="pblock" style="margin-top:8px">
            <div class="pblock-head">
              <span class="ph-name">第 ${e.ep} 集正文 · ${r.text.length} 字</span>
              <span style="display:flex;gap:6px;align-items:center">
                ${r.passed ? '' : '<span class="tag amber">有门未过</span>'}
                <button class="btn btn-sm" data-act="copyep:${e.ep}" title="把第 ${e.ep} 集正文整段复制走">${ICONS.copy}复制</button>
              </span>
            </div>
            <div class="pblock-body" style="white-space:pre-wrap;max-height:320px;overflow:auto">${esc(r.text)}</div>
          </div>
            ${r.gates.filter((g) => !g.ok).length ? `<div class="notice notice-warn" style="margin-top:6px">${ICONS.alert}<div>${r.gates.filter((g) => !g.ok).map((g) => `${esc(g.label)}：${esc(g.detail)}`).join('<br>')}</div></div>` : ''}` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

/** 步骤 ④：组装整稿 */
function genStepAssemble(f) {
  const r = f.assembled;
  const done = Object.keys(f.eps ?? {}).length;
  if (!r) {
    return `<div class="card">
      <div class="card-head"><div><h2>④ 组装整稿</h2><div class="sub">把已写的 ${done} 集拼成整稿，过大纲门 + 剧本门双体检</div></div></div>
      <div class="actions">
        ${done ? busyBtn('genAssemble', '组装整稿', 'type') : `<button class="btn btn-primary" disabled>${ICONS.type}组装整稿</button>`}
        <span class="muted" style="font-size:10.5px">组装后可存入项目，或直接送去评估 / 优化</span>
      </div>
    </div>`;
  }
  const scriptGates = r.gates.filter((g) => g.scope === 'script');
  const outlineGates = r.gates.filter((g) => g.scope === 'outline');
  return `<div class="card">
    <div class="card-head"><div><h2>④ 整稿体检</h2><div class="sub">《${esc(f.story.title)}》· ${r.script.episodes.length} 集 · ${r.stats.scenes} 场 · ${r.stats.lines} 句台词 · 约 ${Math.round(r.stats.seconds / 60)} 分 ${r.stats.seconds % 60} 秒</div></div>
      <button class="btn" data-run="genAssemble">${ICONS.refresh}重新组装</button></div>
    <div class="chip-row">
      <span class="tag ${r.passed ? 'teal' : 'amber'}">剧本门 ${scriptGates.filter((g) => g.ok).length}/${scriptGates.length}</span>
      <span class="tag ${outlineGates.every((g) => g.ok) ? 'teal' : 'amber'}">大纲门 ${outlineGates.filter((g) => g.ok).length}/${outlineGates.length}</span>
    </div>
    ${r.gates.some((g) => !g.ok) ? `<div style="margin-top:10px">${gateList(r.gates.filter((g) => !g.ok))}</div>` : ''}
    <div class="actions" style="margin-top:12px">
      <button class="btn btn-primary" data-run="useGen">${ICONS.check}用这部剧本</button>
      <button class="btn" data-act="dlgen">${ICONS.download}下载 .md</button>
      <button class="btn" data-act="copygen">${ICONS.copy}复制全文</button>
    </div>
  </div>`;
}

/** AI 生成总卡：四步流程，做到哪步显示到哪步。
 *  head=false 用于独立页面（页面头已经有标题了，再来一张标题卡是重复） */
export function genCard({ head = true } = {}) {
  const f = state.data.genflow;
  const headCard = `<div class="card">
    <div class="card-head"><div><h2>AI 剧本生成</h2><div class="sub">题材 → 梗概人设 → 分集大纲 → 逐集正文 → 组装整稿。产出《都市涅槃》标准稿，每步过引擎质量门</div></div>
      <span class="tag purple">四段式</span><span class="tag blue">引擎门禁</span></div>
  </div>`;
  const top = head ? headCard : '';
  if (!f?.story) return top + genStepConcept();
  if (!f.outline) return top + genStepConcept() + genStepStory(f);
  return top + genStepConcept() + genStepStory(f) + villainCard(f) + genStepOutline(f) + genStepAssemble(f);
}

/* ================= 生成页（独立入口） ================= */
/** 本页结果怎么出去：只有「下载成文件」这一条——工具之间不共享数据 */
function genWhereToGo() {
  const has = Boolean(state.data.genflow?.assembled?.script);
  return `<div class="card card-quiet">
    <div class="card-head"><div><h2>生成完之后</h2><div class="sub">${has ? '整稿已就绪：可以下载成文件，再拿去任意工具里载入' : '整稿组装完成后才能下载'}</div></div></div>
    <div class="notice notice-info">${ICONS.alert}<div>本页的生成结果只属于本页，不会自动出现在其他工具里——每个工具都是独立的，请在目标工具里自行「载入剧本」。</div></div>
  </div>`;
}

/** 格式转换页只做格式转换：剧本由本页自己载入，不再引导去别的工具 */

export function viewGen() {
  const live = isLiveLLM();
  const tags = `<span class="tag purple">四段式</span><span class="tag ${live ? 'teal' : 'amber'}">${esc(llmModeLabel())}</span><span class="tag blue">引擎门禁</span>`;
  const notice = live ? '' : `<div class="notice notice-warn">${ICONS.alert}<div>还没接入模型：生成、评审、逐集精修都需要真实模型。点右上角「接 API」填 Key 与 Base URL 后即可使用（本项目不返回样本稿）。</div></div>`;
  return pageHead(
    '剧本创作',
    'AI 剧本生成',
    '一句话创意 → 梗概人设 → 分集大纲 → 逐集正文 → 整稿体检。每步都过引擎质量门，未过的门列出来给人看。',
    tags,
  ) + notice + genCard({ head: false }) + genWhereToGo();
}

/* ================= 格式转换 ================= */
export function viewFormat() {
  const r = state.data.fmt;
  const formats = state.meta?.formats ?? [];
  const tags = `<span class="tag purple">5 种行业格式</span><span class="tag blue">下游直接消费</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>剧本格式转换</h2><div class="sub">同一份剧本，输出不同行业格式——组与组之间传剧本不再手动改</div></div></div>
    <div class="chip-row">
      ${formats.map((f) => `<button class="chip ${state.cfg.fmt === f.id ? 'active' : ''}" data-fmt="${f.id}" title="${esc(f.desc)}">${esc(f.name)}</button>`).join('')}
    </div>
    <div class="actions" style="margin-top:14px">
      ${curInput() ? busyBtn('fmt', '转换格式', 'type') : `<button class="btn btn-primary" disabled>${ICONS.type}转换格式</button>`}
      ${r ? `<button class="btn" data-act="dlfmt">${ICONS.download}下载 .${esc(r.ext)}</button><button class="btn" data-act="copyfmt">${ICONS.copy}复制</button>` : ''}
    </div>
  </div>`;

  const desc = formats.find((f) => f.id === state.cfg.fmt)?.desc ?? '';

  if (!curInput()) return pageHead('剧本创作', '格式转换', '短剧场号、好莱坞格式、Fountain、分集 JSON、纯文本——选一个目标格式，一键转好。', tags) + importCard() + form;

  return pageHead('剧本创作', '格式转换', desc || '选一个目标格式，一键转好。', tags) + form + `
  ${r ? `<div class="card">
    <div class="card-head"><div><h2>${esc(formats.find((f) => f.id === r.format)?.name ?? r.format)}</h2><div class="sub">${r.text.length} 字符</div></div></div>
    <div class="pblock"><div class="pblock-head"><span class="ph-name">${esc(r.ext)} output</span><span class="tag outline">${r.text.split('\n').length} 行</span></div>
      <div class="pblock-body">${esc(r.text.slice(0, 6000))}${r.text.length > 6000 ? '\n……（预览截断，下载看全文）' : ''}</div></div>
  </div>` : `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.type}</div><h3>选择格式并转换</h3><p>上面 5 种格式覆盖了剧组传剧本的常见场景。</p></div></div>`}
  <div style="margin-top:16px">${importCard()}</div>`;
}
/* ================= 运行器 ================= */

/* 增量生成的停止标记。用模块级变量而不是 state：
 * 它是一次交互的临时开关，不该进任何持久化结构，刷新即失效。 */
let genStopRequested = false;

/** 把已写的集拼成整稿并过双体检。抽出来是因为「手动组装」和「增量跑完自动交付」都要用 */
async function doAssemble({ auto = false } = {}) {
  const f = state.data.genflow;
  if (!f?.story || !f.outline) return toast('先生成大纲', 'warn');
  const texts = Object.keys(f.eps ?? {}).sort((a, b) => a - b).map((k) => f.eps[k].text);
  if (!texts.length) return toast('还没写任何一集', 'warn');
  const r = await api.genAssemble({ story: f.story, outline: f.outline, texts });
  state.data.genflow = { ...state.data.genflow, assembled: r };
  const okN = r.gates.filter((g) => g.ok).length;
  toast(
    `${auto ? '增量生成完成，已自动整体交付' : '整稿组装完成'}：${r.script.episodes.length} 集 · ${okN}/${r.gates.length} 门通过`,
    r.passed ? 'ok' : 'warn',
  );
  return r;
}

export const runners = {
  load: loadScript,

  /** Ctrl+Enter 的「下一步」：按当前进度自己判断该跑哪一步，省得记四个按钮 */
  async gen() {
    const f = state.data.genflow;
    if (!f?.story) return runners.genStory();
    if (!f.outline) return runners.genOutline();
    if (!Object.keys(f.eps ?? {}).length) return runners.genEp(1);
    if (!f.assembled) return runners.genAssemble();
    // 最后一步不自动跑：它会把当前剧本换掉，Ctrl+Enter 误触代价太大
    return toast('整稿已就绪：点「用这部剧本」把它设为当前剧本', 'warn');
  },
  async fmt() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    state.data.fmt = await api.format(ctx({ format: state.cfg.fmt }));
    toast('格式转换完成');
  },

  /* ---- AI 生成四步 ---- */
  async genStory() {
    const concept = (state.cfg.genConcept ?? '').trim();
    if (concept.length < 4) return toast('先把创意写具体点：主角是谁、要什么、谁拦着', 'warn');
    const picked = selectedGenres();
    const custom = (state.cfg.genCustom ?? '').trim();
    const main = picked[0];
    const extra = picked.slice(1);
    const genreName = custom || main?.name || state.cfg.genGenre || '都市重生复仇';
    // 后端一个请求只认一个题材：多选的第 2、3 个作为「融合参考」写进创意，
    // 比硬塞给模型两个 genreId 更可控——主次分明，才不会混成四不像
    const withTags = extra.length
      ? `${concept}\n（融合参考：${extra.map((g) => `${g.name}——${g.tagline}`).join('；')}。以主题材为主，只借它们的桥段气质，不要改主线）`
      : concept;
    const seed = Number(state.cfg.genVariantSeed) || 0;
    const { story } = await api.genStory({
      concept: withTags,
      genreId: custom ? undefined : main?.id,
      genre: genreName,
      episodes: Number(state.cfg.genEpisodes) || 40,
      variantSeed: seed,
    });
    // 先把结果放进 state 再落盘：万一 save() 出问题，也不至于把刚生成（花过钱）的梗概丢掉
    state.data.genflow = { story, outline: null, eps: {}, assembled: null };
    // 同题材连点两次不能给同一个开局：变体序号自增，服务端据此取下一组
    state.cfg.genVariantSeed = seed + 1;
    save();
    const variantTag = story.genreMeta ? `（${story.genreMeta.name} · 第 ${seed + 1} 组设定）` : '';
    toast(`已生成《${story.title}》：${story.characters.length} 个角色${variantTag}`);
  },

  async genOutline() {
    const f = state.data.genflow;
    if (!f?.story) return toast('先生成梗概与人设', 'warn');
    const { outline } = await api.genOutline({ story: f.story });
    // 重写大纲：已写的集与组装稿全部作废
    state.data.genflow = { ...f, outline, eps: {}, assembled: null };
    toast(`分集大纲好了：${outline.episodes.length} 集`);
  },

  /** 写某一集：按钮带 data-genep，app.js 分发时把集数闭包进来 */
  async genEp(ep) {
    const f = state.data.genflow;
    if (!f?.story || !f.outline) return toast('先生成梗概与分集大纲', 'warn');
    const prev = f.eps?.[ep - 1]?.text?.slice(-100) ?? '';
    const r = await api.genEpisode({ story: f.story, outline: f.outline, ep, prevEnding: prev });
    state.data.genflow = {
      ...f,
      eps: { ...f.eps, [ep]: { text: r.text, passed: r.passed, gates: r.gates, open: false } },
      assembled: null,
    };
    toast(r.passed ? `第 ${ep} 集写好了：${r.gates.filter((g) => g.ok).length}/${r.gates.length} 门通过` : `第 ${ep} 集有 ${r.gates.filter((g) => !g.ok).length} 门未过，可看正文`, r.passed ? 'ok' : 'warn');
  },

  async genAssemble() {
    await doAssemble();
  },

  /** 增量生成：一段（一集）一次，写完立刻上屏，全部完成后自动组装整稿 */
  async genRun() {
    const f0 = state.data.genflow;
    if (!f0?.story || !f0.outline) return toast('先生成梗概与分集大纲', 'warn');

    const total = f0.outline.episodes.length;
    const eps = { ...(f0.eps ?? {}) };
    // 断点续跑：只补还没写过的段，已完成的绝不重写（真模型下每段都花钱）
    const pending = f0.outline.episodes.map((e) => e.ep).filter((ep) => !eps[ep]);
    if (!pending.length) return toast('每一段都已写完，直接组装整稿即可', 'warn');

    genStopRequested = false;
    state.data.genflow = {
      ...f0,
      run: { running: true, total, currentEp: pending[0], failedEp: null, startedAt: Date.now() },
    };
    render(); // 立刻进「运行中」外观：按钮变停止、进度条归位

    let wrote = 0;
    for (const ep of pending) {
      if (genStopRequested) break;

      // 先把「正在写第 N 集」画出来，再发起请求——否则用户只看到一个卡住的按钮
      state.data.genflow = { ...state.data.genflow, run: { ...state.data.genflow.run, currentEp: ep } };
      render();

      try {
        const prev = eps[ep - 1]?.text?.slice(-100) ?? '';
        const r = await api.genEpisode({ story: f0.story, outline: f0.outline, ep, prevEnding: prev });
        // 收拢其它段的展开状态，只把刚写完的这段展开——
        // 这样「逐步呈现」是真的能看到正文一段段长出来，而不只是列表刷新
        for (const k of Object.keys(eps)) eps[k] = { ...eps[k], open: false };
        eps[ep] = { text: r.text, passed: r.passed, gates: r.gates, open: true };
        wrote += 1;
        state.data.genflow = { ...state.data.genflow, eps: { ...eps }, assembled: null };
        render(); // 这一段立刻上屏：正文、字数、门结果
      } catch (e) {
        state.data.genflow = {
          ...state.data.genflow,
          eps: { ...eps },
          run: { ...state.data.genflow.run, running: false, currentEp: null, failedEp: ep },
        };
        render();
        return toast(
          `第 ${ep} 段失败：${e.message}。已完成 ${Object.keys(eps).length}/${total} 段，可再点「继续增量生成」从第 ${ep} 段续跑`,
          'err',
        );
      }
    }

    const doneCount = Object.keys(eps).length;
    const stopped = genStopRequested;
    state.data.genflow = {
      ...state.data.genflow,
      run: { ...state.data.genflow.run, running: false, currentEp: null },
    };
    render();

    if (stopped) return toast(`已停止：本次写了 ${wrote} 段，累计 ${doneCount}/${total} 段`, 'warn');
    if (doneCount < total) return toast(`已写 ${doneCount}/${total} 段，剩余可继续增量生成`, 'warn');

    // 全部完成 → 整体交付（组装 + 大纲门 + 剧本门双体检）
    await doAssemble({ auto: true });
    render();
  },

  /** 停止增量：当前这一段写完就停，不会把半集落盘 */
  genStop() {
    genStopRequested = true;
    toast('正在停止：当前这一段写完后停止', 'warn');
  },

  /** 组装稿 → 本工具的输入：生成结果只留在「AI 剧本生成」这一页，不外溢给别的工具 */
  async useGen() {
    const f = state.data.genflow;
    const r = f?.assembled;
    if (!r?.script) return toast('先组装整稿', 'warn');
    setCurInput({
      script: r.script,
      outline: r.outline,
      llm: null,
      imported: false,
      importedSummary: `${r.script.episodes.length} 集 / ${r.stats.scenes} 场 / ${r.stats.lines} 句台词 / 约 ${Math.round(r.stats.seconds / 60)} 分 ${r.stats.seconds % 60} 秒`,
    });
    clearOwnResult();
    toast('已作为本页输入。要用在其他工具，请先下载成文件，再在那边载入');
  },
};

/** 供 app.js 的 data-act 用：下载整稿 */
export function downloadGen() {
  const r = state.data.genflow?.assembled;
  if (!r?.text) return toast('先组装整稿', 'warn');
  download(`${state.data.genflow.story?.title ?? '剧本'}.md`, r.text);
}
