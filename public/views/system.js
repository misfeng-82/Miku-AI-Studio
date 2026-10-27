/* 视图域：系统 —— 首页 / 引擎 */
import { state, api, esc, ICONS, pageHead, statStrip, toast, isLiveLLM, llmLabel, llmReasoningLabel, busyBtn } from '../core.js';
import * as intel from './intel.js';

/* ================= 首页 ================= */
/* 首页首屏直接放「爆款榜单」：这是进应用后最该先看的东西，原来要点一次侧栏才看得到。
   渲染的是 intel.js 里同一个视图函数（withHead:false 只去掉本页自己的大标题），
   所以数据来源、卡片样式、按钮交互和独立页完全一致，不存在两份实现。
   2026-10-19：爆款拆解先不放进来了——它是「贴一段文本等用户操作」的工具，
   放首屏只会多占一屏高度，保留在侧栏「爆款拆解」独立页。 */
const HOME_SECTIONS = [
  { view: 'hot', name: '爆款榜单', desc: '真实可查的红果短剧 TOP10：海报、题材、推荐语、官方播放页，附结构分析与写作建议' },
];

function homeSection({ view, name, desc }) {
  const body = view === 'hot' ? intel.viewHot({ withHead: false }) : '';
  return `<div class="home-sec">
    <div class="card-head" style="margin-bottom:12px"><div><h2>${esc(name)}</h2><div class="sub">${esc(desc)}</div></div>
      <div class="actions"><button class="btn btn-sm" data-goto="${view}">在完整页打开${ICONS.arrow}</button></div></div>
    ${body}
  </div>`;
}

export function viewHome() {
  const tags = `<span class="tag purple">${state.meta?.gates ? state.meta.gates.outline + state.meta.gates.script : 24} 道质量门</span><span class="tag teal">零依赖离线可用</span>`;

  const fnCards = [
    { id: 'hot', name: '爆款榜单', desc: '抓取 + 结构分析 + 写作建议', icon: 'radar', group: '爆款情报' },
    { id: 'compare', name: '对标分析', desc: '自家剧本 vs 爆款基准', icon: 'scale', group: '爆款情报' },
    { id: 'gen', name: 'AI 剧本生成', desc: '一句话创意 → 整稿，每步过质量门', icon: 'spark', group: '剧本创作' },
    { id: 'format', name: '载入 / 转换剧本', desc: '粘贴或上传剧本，转 5 种格式', icon: 'film', group: '剧本创作' },
    { id: 'evaluate', name: '剧本评估', desc: '24 道门 + AI 评审，6:4 加权', icon: 'shield', group: '质量把控' },
    { id: 'assets', name: '资产库', desc: '角色一致性 + 场景无人图', icon: 'box', group: '资产中心' },
    { id: 'stats', name: '统计报表', desc: '节奏曲线 + 角色出场', icon: 'chart', group: '质量把控' },
    { id: 'titles', name: '爆款标题', desc: '结构化组合出候选', icon: 'type', group: '效率工具' },
  ];

  return pageHead('首页', 'Miku AI创作平台', '19 个彼此独立的创作工具，每个自带输入、独立跑完整闭环。要用同一份剧本，各工具各自载入即可。', tags)
  + HOME_SECTIONS.map(homeSection).join('') + `
  <div class="card">
    <div class="card-head"><div><h2>功能入口</h2><div class="sub">${fnCards.length} 个核心功能，左侧还有更多</div></div></div>
    <div class="grid-auto">${fnCards.map((f) => `<button class="card card-tight" data-goto="${f.id}" style="text-align:left;display:flex;flex-direction:column;gap:8px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:9px">
        <span style="width:30px;height:30px;display:grid;place-items:center;border-radius:var(--r-sm);background:var(--violet-soft);color:var(--violet)">${ICONS[f.icon]}</span>
        <strong style="font-size:13px">${esc(f.name)}</strong>
      </div>
      <span class="muted" style="font-size:11px">${esc(f.desc)}</span>
      <span class="tag outline" style="align-self:flex-start">${esc(f.group)}</span>
    </button>`).join('')}</div>
  </div>
  <div class="card card-quiet">
    <div class="card-head"><div><h2>质量门从哪来</h2><div class="sub">不是自造的，是开源短剧引擎里过实战的确定性脚本</div></div></div>
    <div class="kv-grid">
      <div class="kv"><dt>大纲门</dt><dd class="mono">${state.meta?.gates?.outline ?? 14} 道 · 结构 / 钩子 / 弧光</dd></div>
      <div class="kv"><dt>剧本门</dt><dd class="mono">${state.meta?.gates?.script ?? 10} 道 · 时长 / 台词 / 动作密度</dd></div>
      <div class="kv"><dt>画风预设</dt><dd class="mono">${(state.meta?.styles ?? []).length} 种 · 中英反向三件套</dd></div>
    </div>
  </div>`;
}

/* ================= 引擎与关于 ================= */
export function viewEngine() {
  const g = state.meta?.gates ?? {};
  const live = isLiveLLM();
  const tags = `<span class="tag ${live ? 'purple' : 'teal'}">${live ? `API 已接入 · ${esc(llmLabel() || '模型')}` : '本地引擎'}</span>${live ? `<span class="tag outline">推理等级 ${esc(llmReasoningLabel())}</span>` : ''}<span class="tag outline">质量门恒定本地</span>`;

  // —— 模型用量 ——
  // 接上模型之后用户最想知道的两件事：花了多少、刚才那次为什么慢/为什么失败。
  const u = state.data.usage;
  const TASK_LABELS = { outline: '大纲生成', script: '剧本正文', eval: '剧本评审', optrewrite: '逐集精修', optimize: '规则改写', other: '其他' };
  const taskName = (k) => TASK_LABELS[k] ?? k;
  const usageCard = `<div class="card">
    <div class="card-head"><div><h2>模型用量</h2><div class="sub">只记元数据（场景 / 模型 / 耗时 / token），不记 prompt 与返回内容</div></div>
      <div class="actions">${u ? `<button class="btn" data-act="resetusage">${ICONS.refresh}清零</button>` : ''}${busyBtn('usage', u ? '刷新用量' : '查看用量', 'chart')}</div></div>
    ${!u ? `<div class="notice notice-info">${ICONS.chart}<div>点「查看用量」看接上模型之后的真实消耗：调了几次、花了多少 token、每步平均多久、有没有失败。数据只留在本机 <span class="mono">data/llm-usage.json</span>。</div></div>` : `
      ${statStrip([
        { label: '调用次数', value: u.totals.calls, cls: 'hl' },
        {
          label: '命中率',
          value: u.totals.hitRate == null ? '—' : `${u.totals.hitRate}%`,
          cls: u.totals.hitRate == null || u.totals.hitRate >= 90 ? '' : 'hl',
        },
        { label: '成功率', value: `${u.totals.successRate}%`, cls: u.totals.successRate >= 90 ? '' : 'warn' },
        { label: '重试次数', value: u.totals.retried ?? 0, cls: (u.totals.retried ?? 0) > 0 ? 'warn' : '' },
        { label: '总 Token', value: u.totals.tokens.toLocaleString('en-US') },
        { label: '平均耗时', value: `${(u.totals.avgMs / 1000).toFixed(1)}s` },
      ])}
    ${u.byTask.length ? `<div style="margin-top:16px"><div class="fl" style="margin-bottom:8px">按场景</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>场景</th><th>调用</th><th>Token</th><th>平均耗时</th><th>失败</th></tr></thead><tbody>
      ${u.byTask.map((r) => `<tr><td class="row-title">${esc(taskName(r.key))}</td><td class="mono">${r.calls}</td><td class="mono">${r.tokens.toLocaleString('en-US')}</td><td class="mono">${(r.avgMs / 1000).toFixed(1)}s</td><td class="mono">${r.failed || '—'}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    ${u.recent.length ? `<div style="margin-top:16px"><div class="fl" style="margin-bottom:8px">最近调用</div>
      <div class="rows">${u.recent.slice(0, 8).map((r) => `<div class="row" style="grid-template-columns:56px 1fr auto">
        <div class="row-idx">${new Date(r.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
        <div><div class="row-title" style="font-size:11.5px">${esc(taskName(r.task))} · ${esc(r.model || '—')}</div>
          <div class="row-sub">${r.ok ? `${(r.ms / 1000).toFixed(1)}s · ${(r.promptTokens + r.completionTokens).toLocaleString('en-US')} token` : esc(r.error ?? '调用失败')}</div></div>
        <div><span class="tag ${r.ok ? 'teal' : 'rose'}">${r.ok ? '成功' : '失败'}</span></div>
      </div>`).join('')}</div></div>` : ''}
    ${u.totals.calls ? `<div class="muted" style="font-size:10.5px;margin-top:10px">token 数由模型服务返回；本地引擎（样本模式）的调用不计入这里。</div>` : ''}
    `}
  </div>`;

  return pageHead('引擎', '引擎与项目', '质量门、运行模式、用量与数据位置——把这个工具本身讲清楚。', tags) + `
  <div class="card">
    <div class="card-head"><div><h2>运行模式</h2><div class="sub">评估 / 优化 / 拆镜恒定本地判定，不随模式切换</div></div></div>
    <div class="notice ${live ? 'notice-ai' : 'notice-ok'}">${live ? ICONS.cpu : ICONS.shield}<div>${live ? '生成与续写调用你接入的模型；评估、优化、拆镜始终是本地确定性引擎。' : '剧本走内置样本 + 确定性质量门，全程零费用、离线可用。在 .env 配置 LLM_BASE_URL / LLM_API_KEY 后，生成与续写自动切到模型模式。'}</div></div>
  </div>
  ${usageCard}
  <div class="card">
    <div class="card-head"><div><h2>质量门清单</h2><div class="sub">共 ${(g.outline ?? 0) + (g.script ?? 0)} 道 · 来自开源短剧引擎</div></div></div>
    ${statStrip([
      { label: '大纲门', value: g.outline ?? 0, cls: 'hl' },
      { label: '剧本门', value: g.script ?? 0, cls: 'hl' },
      { label: '画风预设', value: (state.meta?.styles ?? []).length },
      { label: '提示词模板', value: (state.meta?.templates ?? []).length },
    ])}
    <div class="notice notice-info" style="margin-top:16px">${ICONS.shield}<div>大纲门查结构（钩子密度 / 爽点间距 / 集尾悬念 / 人物弧光）；剧本门查节奏（单集时长 / 台词长度 / 动作密度）。</div></div>
  </div>
  <div class="card">
    <div class="card-head"><div><h2>快捷键与数据</h2><div class="sub">用得顺的几个键</div></div></div>
    <div class="kv-grid">
      <div class="kv"><dt>Ctrl + Enter</dt><dd>运行当前功能的主动作</dd></div>
      <div class="kv"><dt>Alt + 1–9</dt><dd>快速切换功能页</dd></div>
      <div class="kv"><dt>Esc</dt><dd>关闭弹窗</dd></div>
      <div class="kv"><dt>数据位置</dt><dd class="mono" style="font-size:11px">data/projects.json</dd></div>
    </div>
  </div>`;
}

/* ================= 运行器 ================= */
/* ================= 作品库（只读） =================
 * 这是一个**完全独立**的工具：只做「浏览历史成果 → 导出成文件」。
 * 它不向任何其他工具供数，也不接收任何工具的产出。
 * 要用里面的某份剧本，唯一路径是：在这里导出 → 到目标工具里载入。
 */
const fmtDay = (iso) => (iso ? String(iso).slice(0, 10) : '—');

export function viewLibrary() {
  const list = state.projects ?? [];
  const cur = state.data.library;
  const tags = `<span class="tag outline">只读</span><span class="tag purple">导出即用</span>`;

  const head = pageHead('作品', '作品库',
    '历史作品的只读浏览器：看存过什么、导出成文件。它不向任何工具传数据——已与所有创作工具解耦。',
    tags) + `<div class="card">
    <div class="card-head"><div><h2>已保存的作品</h2><div class="sub">${list.length} 份 · 来自 data/ 目录，本工具只读不改</div></div>
      <div class="actions">${busyBtn('libraryLoad', list.length ? '刷新列表' : '读取列表', 'refresh')}</div></div>
    <div class="notice notice-info">${ICONS.alert}<div>要用这里的某份剧本，请点「导出」拿到文件，再到目标工具里「载入剧本」。这是唯一的传递方式，工具之间不自动共享。</div></div>`;

  if (!list.length) {
    return head + `<div class="empty" style="margin-top:16px"><div class="eicon">${ICONS.doc}</div>
      <h3>还没有读取到作品</h3><p>点上方「读取列表」。如果你确实没存过作品，这里就是空的——每个工具现在都是独立跑的，不再往作品库里自动存东西。</p></div></div>`;
  }

  const rows = list.map((p) => `<tr>
      <td class="row-title">${esc(p.name)}${p.missing ? ' <span class="tag amber">文件缺失</span>' : ''}</td>
      <td class="row-sub">${esc(p.genre ?? '—')}</td>
      <td class="mono">${p.episodes ?? '—'}</td>
      <td class="mono">${p.progress ?? 0}%</td>
      <td class="mono">${p.score ?? '—'}</td>
      <td class="row-sub">${fmtDay(p.updatedAt)}</td>
      <td class="row-sub" style="text-align:right;white-space:nowrap">
        ${p.missing ? '' : `<button class="btn btn-sm" data-act="libraryOpen:${esc(p.id)}">${ICONS.doc}查看</button>`}
      </td>
    </tr>`).join('');

  const detail = cur ? `<div class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>${esc(cur.name)}</h2><div class="sub">${esc(cur.genre ?? '')} · ${cur.episodes ?? '—'} 集 · 单集 ${cur.minutesPerEpisode ?? '—'} 分钟 · 创建于 ${fmtDay(cur.createdAt)}</div></div>
        <div class="actions">
          ${cur.stages?.script?.data ? `<button class="btn" data-act="libraryExportJson:${esc(cur.id)}">${ICONS.doc}导出 JSON</button>
          <button class="btn" data-act="libraryExportMd:${esc(cur.id)}">${ICONS.doc}导出 Markdown</button>` : ''}
          <button class="btn btn-ghost" data-act="libraryClose">${ICONS.x}关闭</button>
        </div></div>
      ${cur.stages?.script?.data
        ? `<div class="sub" style="margin-bottom:8px">剧本：${cur.stages.script.data.episodes?.length ?? 0} 集 · 载入于 ${fmtDay(cur.stages.script.updatedAt)}</div>`
        : `<div class="notice notice-warn">${ICONS.alert}<div>这份作品里没有剧本内容，无法导出。</div></div>`}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>阶段</th><th>状态</th><th>更新时间</th><th>备注</th></tr></thead><tbody>
        ${Object.entries(cur.stages ?? {}).map(([k, v]) => `<tr>
          <td class="row-title">${esc(k)}</td>
          <td>${v?.status === 'empty' ? '<span class="tag outline">空</span>' : `<span class="tag teal">${esc(v?.status ?? '')}</span>`}</td>
          <td class="row-sub">${fmtDay(v?.updatedAt)}</td>
          <td class="row-sub">${esc(v?.note ?? '')}</td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>` : '';

  return head + `<div class="tbl-wrap" style="margin-top:16px"><table class="tbl">
      <thead><tr><th>作品</th><th>题材</th><th>集数</th><th>进度</th><th>评分</th><th>更新</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>${detail}`;
}

export const runners = {
  async usage() {
    state.data.usage = await api.llmUsage();
    const t = state.data.usage.totals;
    toast(t.calls ? `累计 ${t.calls} 次调用 · ${t.tokens} token · 成功率 ${t.successRate}%` : '还没有模型调用记录（本地引擎的调用不计入）');
  },
  async libraryLoad() {
    state.projects = (await api.projects()).items ?? [];
    toast(state.projects.length ? `读到 ${state.projects.length} 份作品` : '作品库是空的');
  },
};
