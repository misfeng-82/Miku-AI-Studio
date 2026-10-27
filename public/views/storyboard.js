/* 视图域：剧本转分镜 —— 剧本 → 15 秒分镜段 → 段内子镜头 + 段提示词
 *
 * 2026-10-19 v2：按「15 秒一段」拆，段内 3–6 个子镜头；每段输出一条时间轴提示词，
 * 可直接喂 10–15 秒视频模型。结构由服务端 12 道门确定性校验，模型不可用时规则切段。
 */
import { curInput, 
  state, api, esc, ICONS, ctx, busyBtn, pageHead, statStrip, gateList, toast,
  copyText, download, isLiveLLM, llmLabel,
} from '../core.js';
import { importCard } from './script.js';

const SIZE_CN = {
  'extreme-wide': '大远景', wide: '远景', medium: '中景', 'medium-close': '中近景',
  'close-up': '特写', 'extreme-close': '大特写', 'over-shoulder': '过肩', pov: '主观',
};
const MOVE_CN = {
  static: '固定', 'push-in': '推近', 'pull-back': '拉远', 'pan-left': '左摇', 'pan-right': '右摇',
  'tilt-up': '上摇', 'tilt-down': '下摇', tracking: '跟拍', orbit: '环绕', crane: '升降',
  handheld: '手持', zoom: '变焦',
};

const epList = () => (curInput()?.script?.episodes ?? []).map((e) => e.ep);

/** 当前正在看的那一集的拆解结果 */
const currentShots = () => (state.data.shotsMap ?? {})[Number(state.data.shotEp) || 0] ?? null;

/** 没有集标记的剧本，按每集这么多场自动分（短剧一集通常 3–5 场） */
const SCENES_PER_EP = 3;

/**
 * 本页要拆的「集」列表。
 *
 * 导入的剧本不一定带「第N集」标记：解析器遇到没有标记的长文会整体塞成 1 集。
 * 这里补一层自动分集（**只作用于本工具的视图，不改用户的文件**）：
 * 只有 1 集且场数超过阈值时才切，按每 SCENES_PER_EP 场一集。
 */
function episodesForSplit() {
  const g = curInput();
  const eps = g?.script?.episodes ?? [];
  if (eps.length === 0) return { list: [], autoSplit: false };
  if (eps.length > 1) return { list: eps, autoSplit: false };

  const only = eps[0];
  const scenes = only?.scenes ?? [];
  if (scenes.length <= SCENES_PER_EP) return { list: eps, autoSplit: false };

  const chunks = [];
  for (let i = 0; i < scenes.length; i += SCENES_PER_EP) {
    const part = scenes.slice(i, i + SCENES_PER_EP);
    chunks.push({
      ...only,
      ep: chunks.length + 1,
      scenes: part,
      // 集尾钩子/卡点只保留在最后一段，避免每段都重复同一句
      hook: i + SCENES_PER_EP >= scenes.length ? only.hook : '',
      cliff: i + SCENES_PER_EP >= scenes.length ? only.cliff : '',
    });
  }
  return { list: chunks, autoSplit: true };
}

/** 画幅 + 分集列表（每集单独拆） */
function splitForm() {
  const g = curInput();
  const { list, autoSplit } = episodesForSplit();
  const map = state.data.shotsMap ?? {};
  const live = isLiveLLM();
  const busy = Boolean(state.busy?.shots);
  const viewing = Number(state.data.shotEp) || 0;

  const rows = list.map((e) => {
    const r = map[e.ep];
    const scenes = e.scenes?.length ?? 0;
    const lines = (e.scenes ?? []).reduce((n, s) => n + (s.lines?.length ?? 0), 0);
    const okN = r ? r.gates.filter((x) => x.ok).length : 0;
    return `<div class="card" style="margin-bottom:8px;padding:12px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <b style="min-width:44px">第${e.ep}集</b>
        <span class="muted" style="font-size:11px">${scenes} 场 · ${lines} 句</span>
        ${r
          ? `<span class="tag ${r.passed ? 'teal' : 'amber'}">已拆 ${r.stats.segments} 段 · ${r.stats.shots} 镜 · 门 ${okN}/${r.gates.length}</span>`
          : '<span class="tag outline">未拆</span>'}
        <span style="flex:1;min-width:12px"></span>
        ${r ? `<button class="btn btn-sm" data-shotview="${e.ep}">${viewing === e.ep ? '收起结果' : '看结果'}</button>` : ''}
        <button class="btn btn-sm ${r ? '' : 'btn-primary'}" data-shotep="${e.ep}" ${busy || !g ? 'disabled' : ''}>${ICONS.grid}${r ? '重拆本集' : '拆解本集'}</button>
      </div>
    </div>`;
  }).join('');

  return `<div class="card">
    <div class="card-head"><div><h2>分集拆解</h2><div class="sub">导入的剧本已自动分集；每集单独拆成 15 秒分镜段，每段再分 3–6 个子镜头，并给每段一条时间轴提示词。12 道门确定性校验，不过带诊断重修一轮</div></div>
      <span class="tag ${live ? 'teal' : 'amber'}">${live ? `真模型 · ${esc(llmLabel() || '已接入')}` : '样本引擎'}</span></div>
    ${autoSplit ? `<div class="notice notice-info">${ICONS.alert}<div>没检测到「第 N 集」标记，已按每 ${SCENES_PER_EP} 场自动分成 <b>${list.length}</b> 集（只影响本页视图，不改你的剧本文件）</div></div>` : ''}
    <label class="field" style="max-width:220px;margin-bottom:12px"><span class="fl">画幅</span>
      <select class="editable" data-cfg="aspect">
        <option value="9:16" ${state.cfg.aspect !== '16:9' ? 'selected' : ''}>9:16 竖屏</option>
        <option value="16:9" ${state.cfg.aspect === '16:9' ? 'selected' : ''}>16:9 横屏</option>
      </select></label>
    ${g ? rows : `<div class="empty"><div class="eicon">${ICONS.grid}</div><h3>还没有剧本</h3><p>先在下面「载入剧本」里粘贴或上传，导入后会自动分集。</p></div>`}
    <div class="muted" style="font-size:10.5px;margin-top:10px">一次模型调用 = 本集正文 + 大纲 + 人物编号 → 15 秒段；首次约 30–60 秒，同一集同参数再点直接命中缓存</div>
  </div>`;
}

/** 角色识别结果：编号 / 角色 / 身份 / 出场 / 台词 / 是否未命名 */
function castCard(cast) {
  if (!cast?.characters?.length) return '';
  const rows = cast.characters.map((c) => `<tr>
    <td class="mono" style="font-size:10.5px">${esc(c.id)}</td>
    <td class="row-title" style="font-size:11.5px">${esc(c.name)}${c.aliases?.length ? `<span class="muted" style="font-size:10px">（${esc(c.aliases.join('/'))}）</span>` : ''}</td>
    <td style="font-size:11px">${esc(c.identity || c.role)}</td>
    <td class="mono" style="font-size:10.5px">${c.episodes?.length ? `第 ${c.episodes.join('、')} 集` : '—'}</td>
    <td class="mono">${c.lines}</td>
    <td>${c.unnamed ? '<span class="tag amber">未命名</span>' : c.lines === 0 ? '<span class="tag outline">无台词</span>' : ''}</td>
  </tr>`).join('');
  return `<div class="card">
    <div class="card-head"><div><h2>角色识别</h2><div class="sub">从剧本里自动抽出登场角色：名字、身份、别名、出场集与台词数；分镜提示词按编号引用</div></div>
      <span class="tag outline">${cast.summary?.total ?? cast.characters.length} 个角色</span></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>编号</th><th>角色</th><th>身份</th><th>出场</th><th>台词</th><th>备注</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${(cast.notes ?? []).length ? `<div class="notice notice-info" style="margin-top:10px">${ICONS.alert}<div>${cast.notes.map((n) => esc(n)).join('<br>')}</div></div>` : ''}
  </div>`;
}

function resultCard(d) {
  if (!d) {
    return `<div class="card">
      <div class="card-head"><div><h2>拆分结果</h2><div class="sub">每 15 秒一段：段号 / 子镜头（景别·运镜·画面·台词·光线）/ 一段可直接生成视频的提示词</div></div></div>
      <div class="empty"><div class="eicon">${ICONS.grid}</div><h3>还没有分镜</h3><p>选好集数点「拆分这一集」，一次调用拿到整集 15 秒段。</p></div>
    </div>`;
  }
  const bad = (d.gates ?? []).filter((g) => !g.ok);
  const segs = d.segments ?? [];
  return `<div class="card">
    <div class="card-head"><div><h2>第 ${d.ep} 集 · ${d.stats.segments} 段 / ${d.stats.shots} 镜</h2>
      <div class="sub">约 ${d.stats.seconds} 秒 · ${d.stats.scenes} 场 · ${(d.llm?.mode === 'mock' ? '样本引擎' : `真模型 ${esc(d.llm?.model || '')}`)}${d.rounds > 1 ? ` · 重修 ${d.rounds - 1} 轮` : ''}${d.cached ? ' · 缓存命中' : ''}</div></div>
      <div class="chip-row">
        <span class="tag ${d.passed ? 'teal' : 'amber'}">门 ${(d.gates ?? []).filter((g) => g.ok).length}/${(d.gates ?? []).length}</span>
        ${d.degraded ? '<span class="tag rose">规则切段（模型未拆成）</span>' : ''}
      </div></div>
    ${statStrip([
      { label: '15 秒段', value: d.stats.segments, cls: 'hl' },
      { label: '子镜头', value: d.stats.shots },
      { label: '总时长', value: `${d.stats.seconds}s` },
      { label: '台词', value: (d.shots ?? []).filter((s) => s.line).length },
    ])}
    ${d.degraded ? `<div class="notice notice-warn" style="margin-top:12px">${ICONS.alert}<div>模型这次没拆成（${esc((d.error || '').slice(0, 120)) || '未知原因'}），已用规则切段兜底：台词一句不丢、每段 15 秒，但镜头语言比较朴素。接上模型后重跑一次即可。</div></div>` : ''}
    ${bad.length ? `<div style="margin-top:12px">${gateList(bad)}</div>` : ''}
    <div class="actions" style="margin-top:12px">
      <button class="btn" data-run="shotmd">${ICONS.download}导出 MD 分镜表</button>
      <button class="btn" data-run="shotjson">${ICONS.download}导出 JSON</button>
      <button class="btn" data-run="shotcopy">${ICONS.copy}复制全部段提示词</button>
    </div>
  </div>
  ${castCard(d.cast)}
  ${segs.map((seg) => `<div class="card">
    <div class="card-head"><div><h2>${esc(seg.id)} · ${seg.sec}s${seg.beat ? ` · ${esc(seg.beat)}` : ''}</h2>
      <div class="sub">第 ${seg.sceneIndex} 场 · ${(seg.shots ?? []).length} 个子镜头${seg.env ? ` · ${esc(seg.env)}` : ''}${seg.lighting ? ` · ${esc(seg.lighting)}` : ''}</div></div>
      <button class="btn btn-sm" data-copy="${esc(seg.prompt)}">${ICONS.copy}复制这段提示词</button></div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>子镜头</th><th>时长</th><th>景别</th><th>机位/运动</th><th>画面内容</th><th>台词</th><th>光线</th></tr></thead>
      <tbody>${(seg.shots ?? []).map((s) => `<tr>
        <td class="row-title mono" style="font-size:10.5px">${esc(s.id.slice(-2))}</td>
        <td class="mono">${s.sec}s</td>
        <td>${esc(SIZE_CN[s.size] ?? s.size)}</td>
        <td>${esc(MOVE_CN[s.move] ?? s.move)}</td>
        <td style="font-size:11px">${esc(s.visual)}</td>
        <td style="font-size:11px">${esc(s.line || '—')}</td>
        <td style="font-size:11px">${esc(s.lighting || '—')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="pblock" style="margin-top:10px">
      <div class="pblock-head"><span class="ph-name">15 秒提示词（时间轴）</span><span class="tag outline">直接贴进视频模型</span></div>
      <div class="pblock-body" style="white-space:pre-wrap;max-height:260px">${esc(seg.prompt)}</div>
    </div>
  </div>`).join('')}`;
}

export function viewStoryboard() {
  const live = isLiveLLM();
  const tags = `<span class="tag purple">15 秒 × 子镜头</span><span class="tag ${live ? 'teal' : 'amber'}">${live ? `真模型 · ${esc(llmLabel() || '已接入')}` : '样本引擎'}</span><span class="tag blue">12 道结构门</span>`;
  return pageHead(
    '剧本创作', '剧本转分镜',
    '把一集剧本拆成 15 秒分镜段，段内再分 3–6 个子镜头；每段给一条时间轴提示词，可直接生成 15 秒视频。',
    tags,
  ) + importCard({ previewOpen: false }) + splitForm() + resultCard(currentShots());
}

  export const runners = {
    /** 拆某一集：按钮带 data-shotep，app.js 分发时把集数闭包进来 */
    async shots(ep) {
      if (!curInput()) return toast('请先载入剧本', 'warn');
      const { list, autoSplit } = episodesForSplit();
      const target = Number(ep) || Number(state.data.shotEp) || list[0]?.ep || 1;

      // 自动分集时，发给服务端的必须是「切好的」那份，
      // 否则第 2 集在原始 script 里根本不存在
      const scriptArg = autoSplit ? { ...curInput().script, episodes: list } : {};
      const r = await api.splitShots(ctx({
        ...scriptArg,
        ep: target,
        styleId: state.cfg.style || undefined,
        aspect: state.cfg.aspect || '9:16',
      }));
      state.data.shotsMap = { ...(state.data.shotsMap ?? {}), [target]: r };
      state.data.shotEp = target; // 拆完立刻展示这一集的结果
      if (r.degraded) {
        toast(`第 ${target} 集：模型没拆成，已用规则切段 ${r.stats.segments} 段 / ${r.stats.shots} 镜`, 'warn');
      } else {
        toast(`第 ${target} 集拆好了：${r.stats.segments} 段 / ${r.stats.shots} 镜 / ${r.stats.seconds}s${r.passed ? ' · 全门通过' : ' · 有门未过'}`);
      }
    },

  async shotmd() {
    const d = currentShots();
    if (!d?.segments?.length) return toast('先拆分一次', 'warn');
    const r = await api.shotsExport({ ep: d.ep, segments: d.segments, format: 'md', styleId: state.cfg.style || undefined });
    download(`第${d.ep}集-分镜表.md`, r.text);
    toast(`已导出 ${r.total} 段 / ${r.shots ?? 0} 镜`);
  },

  async shotjson() {
    const d = currentShots();
    if (!d?.segments?.length) return toast('先拆分一次', 'warn');
    const r = await api.shotsExport({ ep: d.ep, segments: d.segments, format: 'json', styleId: state.cfg.style || undefined });
    download(`第${d.ep}集-分镜.json`, r.text);
    toast(`已导出 ${r.total} 段`);
  },

  async shotcopy() {
    const d = currentShots();
    if (!d?.segments?.length) return toast('先拆分一次', 'warn');
    const text = d.segments.map((s) => `【${s.id} · ${s.sec}s】\n${s.prompt}`).join('\n\n');
    copyText(text, `已复制 ${d.segments.length} 段提示词`);
  },
};
