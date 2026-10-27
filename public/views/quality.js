/* 视图域：质量把控 —— 评估 / 优化 / 统计报表 */
import { curInput, setCurInput,  state, api, esc, ICONS, ctx, needScript, busyBtn, pageHead, scoreRing, gateList, statStrip, barRows, toast, fmtTime, isLiveLLM, llmLabel, llmModeLabel } from '../core.js';
// 载入剧本的入口在两页都要有：用户来到「评估/优化」才发现没剧本，不该再被赶去别的页
import { importCard } from './script.js';

/* ================= 剧本评估 ================= */
// 内容体检（/api/checkup）原先挂在「剧本生成」页上，随生成功能框下线后迁到本页：
// 它管的是「内容」那一半（网文腔 / 水词 / 环境预算 / 集间承接），和质量门互补，不该跟着一起埋掉

/** 评审维度的中文名：后端用 hook/character/... 存，界面给人看的要是中文 */
const JUDGE_DIM_LABEL = { hook: '钩子', character: '人物', dialogue: '台词', pacing: '节奏', commercial: '商业性' };

/** AI 评审卡：模型逐维度打分 + 值钱的点 / 会掉人的点 / 具体改法 */
function judgeCard(r) {
  const j = r.judge;
  const live = r.llm && r.llm.mode !== 'mock';
  if (!j) {
    return `<div class="card">
      <div class="card-head"><div><h2>AI 评审</h2><div class="sub">这一层要调模型：判断「好不好看」是门算不出来的</div></div>
        <span class="tag amber">没拿到评审</span></div>
      <div class="notice notice-warn">${ICONS.alert}<div>${esc(r.judgeError || '模型没有返回可用的评审结果')}。下面只有确定性门的分，先按门改，恢复后重跑一次就有评审了。</div></div>
    </div>`;
  }
  return `<div class="card">
    <div class="card-head"><div><h2>AI 评审</h2><div class="sub">${esc(j.summary || '（模型没给摘要）')}</div></div>
      <div class="chip-row"><span class="tag ${j.score >= 80 ? 'teal' : j.score >= 60 ? 'amber' : 'rose'}">${esc(j.verdict)} · ${j.score}</span>
      <span class="tag ${live ? 'blue' : 'outline'}">${live ? `真模型 · ${esc(r.llm.model || '已接入')}` : '样本评审'}</span></div></div>
    <div class="grid-2">
      <div>
        <div class="fl" style="margin-bottom:8px">模型维度（每个 0–100）</div>
        ${Object.entries(j.dimensions).map(([k, v]) => `<div class="bar-row"><span class="bl">${esc(JUDGE_DIM_LABEL[k] ?? k)}</span>
          <div class="bar-track"><span class="bar-fill ${v >= 90 ? 'teal' : v >= 70 ? 'amber' : 'rose'}" style="width:${v}%"></span></div>
          <span class="bv">${v}</span></div>`).join('')}
      </div>
      <div>
        ${j.strengths.length ? `<div class="fl" style="margin-bottom:6px">值钱的地方</div>
          <div class="gate-list" style="margin-bottom:12px">${j.strengths.map((s) => `<div class="gate"><span class="gate-icon" style="color:var(--teal)">${ICONS.check}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(s)}</span><span></span></div>`).join('')}</div>` : ''}
        ${j.risks.length ? `<div class="fl" style="margin-bottom:6px">会掉人的地方</div>
          <div class="gate-list">${j.risks.map((s) => `<div class="gate"><span class="gate-icon" style="color:var(--amber)">${ICONS.alert}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(s)}</span><span></span></div>`).join('')}</div>` : ''}
      </div>
    </div>
    ${j.fixes?.length ? `<div style="margin-top:14px"><div class="fl" style="margin-bottom:8px">具体改法</div>
      <div class="rows">${j.fixes.map((f) => `<div class="row" style="grid-template-columns:1fr">
        <div><div class="row-title" style="font-size:11.5px">${esc(f.where || '全剧')}${f.what ? ` · ${esc(f.what)}` : ''}</div>
          ${f.why ? `<div class="row-sub">${esc(f.why)}</div>` : ''}</div>
      </div>`).join('')}</div></div>` : ''}
  </div>`;
}

function checkupCard() {
  const c = state.data.checkup;
  if (!c) return `<div class="card">
    <div class="card-head"><div><h2>内容体检</h2><div class="sub">质量门管「形状」，这一半管「内容」：网文腔、水词、环境预算、集间承接</div></div>
      <div class="actions">${curInput() ? busyBtn('checkup', '开始体检', 'shield') : `<button class="btn btn-primary" disabled>${ICONS.shield}开始体检</button>`}</div></div>
    ${curInput() ? `<div class="empty"><div class="eicon">${ICONS.shield}</div><h3>等待体检</h3><p>只报告不拦截，不改你的剧本。</p></div>` : `<div class="notice notice-warn">${ICONS.alert}<div>还没有剧本：在上方「本工具输入」里粘贴或上传一份（只用于本工具，不影响其他工具）。</div></div>`}
  </div>`;

  return `<div class="card">
    <div class="card-head"><div><h2>内容体检</h2><div class="sub">${c.passed}/${c.total} 项通过 · 只报告不拦截</div></div>
      <div class="actions"><button class="btn" data-run="checkup">${ICONS.refresh}重跑</button></div></div>
    ${statStrip([{ label: '体检得分', value: c.score, cls: c.score >= 90 ? 'ok' : 'warn' }, { label: '通过项', value: `${c.passed}/${c.total}` }])}
    <div class="gate-list" style="margin-top:14px">${c.checks.map((x) => `<div class="gate">
      <span class="gate-icon" style="color:${x.ok ? 'var(--teal)' : 'var(--amber)'}">${x.ok ? ICONS.check : ICONS.alert}</span>
      <span class="gate-name">${esc(x.label)}</span>
      <span class="muted" style="font-size:10.5px">${x.ok ? '通过' : `${x.hits.length} 处待改`}</span>
    </div>`).join('')}</div>
    ${c.problems.length ? `<div style="margin-top:14px"><div class="fl" style="margin-bottom:8px">待改明细</div>
      <div class="rows">${c.problems.flatMap((p) => p.hits.slice(0, 4).map((h) => `<div class="row" style="grid-template-columns:1fr">
        <div><div class="row-title" style="font-size:11.5px">${esc(p.label)}${h.ep ? ` · 第${h.ep}集` : ''}${h.where ? ` · ${esc(h.where)}` : ''}</div>
          <div class="row-sub">${esc(h.why ?? '')}${h.fix ? ` —— ${esc(h.fix)}` : ''}</div></div>
      </div>`)).join('')}</div></div>` : ''}
  </div>`;
}

export function viewEvaluate() {
  const r = state.data.eval;
  const live = isLiveLLM();
  const tags = `<span class="tag purple">AI 评审 + 24 门</span><span class="tag ${live ? 'teal' : 'amber'}">${esc(llmModeLabel())}</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>AI 剧本评估</h2><div class="sub">两层：确定性 24 门（大纲 14 + 剧本 10，可复现）+ 大模型评审（懂戏），按 6:4 加权</div></div>
      <div class="actions">${curInput() ? busyBtn('qa', '开始评估', 'shield') : `<button class="btn btn-primary" disabled>${ICONS.shield}开始评估</button>`}
      ${r ? `<button class="btn" data-view="optimize">${ICONS.wrench}去优化</button>` : ''}</div></div>
    ${!curInput() ? `<div class="notice notice-warn">${ICONS.alert}<div>还没有剧本：在上方「本工具输入」里粘贴或上传一份（只用于本工具，不影响其他工具）。</div></div>` : ''}
  </div>`;

  if (!r) return pageHead('质量把控', '剧本评估', '确定性 24 门（时长、单句台词、钩子密度、爽点间距、人物弧光）+ 大模型评审：门判「形状」，模型判「留不留得住人」。', tags) + importCard({ previewOpen: false }) + form
    + (curInput() ? `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.shield}</div><h3>等待评估</h3><p>点「开始评估」，输出总分（门 6 + 模型 4）、维度条与逐条问题。</p></div></div>` : '')
    + `<div style="margin-top:16px">${checkupCard()}</div>`;

  const DIM_LABEL = { script: '剧本门', outline: '大纲门', structure: '结构指标' };
  const dims = Object.entries(r.dimensions).map(([k, v]) => ({ name: DIM_LABEL[k] ?? k, value: v }));
  return pageHead('质量把控', '剧本评估', '确定性 24 门（时长、单句台词、钩子密度、爽点间距、人物弧光）+ 大模型评审：门判「形状」，模型判「留不留得住人」。', tags) + importCard({ previewOpen: false }) + form + `
  <div class="card">
    <div class="score-block">
      ${scoreRing(r.score)}
      <div class="score-meta">
        <div class="big">${r.score} 分 · ${r.passed}/${r.total} 门通过${r.judge ? ` · 模型评 ${r.judge.score}` : ''}</div>
        <p>${r.problems.length ? `未过 ${r.problems.length} 项，明细见下；「优化车间」能自动修掉其中大部分。` : '全部通过，可以直接去优化，或导出给你现在的下游。'}</p>
        <div class="actions" style="margin-top:10px">
          <button class="btn btn-sm" data-view="optimize">${ICONS.wrench}去优化</button>
          <button class="btn btn-sm" data-view="stats">${ICONS.chart}统计报表</button>
        </div>
      </div>
    </div>
    <div style="margin-top:20px">
      <div class="fl" style="margin-bottom:8px">维度得分</div>
      ${dims.map((d) => `<div class="bar-row"><span class="bl">${esc(d.name)}</span>
        <div class="bar-track"><span class="bar-fill ${d.value >= 90 ? 'teal' : d.value >= 70 ? 'amber' : 'rose'}" style="width:${d.value}%"></span></div>
        <span class="bv">${d.value}</span></div>`).join('')}
    </div>
  </div>
  ${judgeCard(r)}
  <div class="card">
    <div class="card-head"><div><h2>质量门明细</h2><div class="sub">${r.total} 道门 · 判定规则来自开源短剧引擎，非人工设定</div></div>
      <span class="tag ${r.problems.length ? 'amber' : 'teal'}">${r.problems.length ? `未过 ${r.problems.length}` : '全过'}</span></div>
    ${gateList(r.gates)}
  </div>
  ${checkupCard()}`;
}

/* ================= 剧本优化 ================= */
export function viewOptimize() {
  const r = state.data.opt;
  const live = isLiveLLM();
  const tags = `<span class="tag purple">确定性预修 + 逐集精修</span><span class="tag ${live ? 'teal' : 'amber'}">${esc(llmModeLabel())}</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>AI 剧本优化</h2><div class="sub">两刀：机器先改它一定改得对的（拆长句 / 补动作 / 回补时长）；再把最该改的几集逐集交给模型重写，每集都过质量门，不过就带诊断再修一轮</div></div>
      <div class="actions">${curInput() ? busyBtn('optimize', '开始优化', 'wrench') : `<button class="btn btn-primary" disabled>${ICONS.wrench}开始优化</button>`}</div></div>
    <label class="field" style="max-width:240px"><span class="fl">本次最多重写几集（逐集调用，1–20）</span>
      <input class="editable" type="number" min="1" max="20" value="${esc(state.cfg.optLimit ?? 8)}" data-cfg="optLimit"></label>
    ${!curInput() ? `<div class="notice notice-warn" style="margin-top:12px">${ICONS.alert}<div>请先载入剧本。</div></div>` : ''}
  </div>`;

  const desc = '机器先改它能改对的，再逐集调模型精修；每集改完立刻过门复评，改不动的列成人能执行的建议。';

  if (!r) return pageHead('质量把控', '剧本优化', desc, tags) + importCard({ previewOpen: false }) + form
    + (curInput() ? `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.wrench}</div><h3>等待优化</h3><p>点「开始优化」：给出前后分数、逐集结果与仍未过门的项。</p></div></div>` : '');

  const delta = r.after.score - r.before.score;
  const okCount = (r.rewritten ?? []).filter((x) => x.ok).length;
  const modeText = r.llm?.mode === 'mock' ? '样本引擎（测试）' : `真模型 · ${esc(r.llm?.model || '已接入')}`;
  return pageHead('质量把控', '剧本优化', desc, tags) + importCard({ previewOpen: false }) + form + `
  <div class="card">
    <div class="card-head"><div><h2>优化前后对比</h2><div class="sub">${modeText} · 重写成功 ${okCount} 集 · 确定性修 ${r.changed ?? 0} 处${r.skipped ? ` · 本轮跳过 ${r.skipped} 集` : ''}</div></div>
      <span class="tag ${delta > 0 ? 'teal' : delta === 0 ? 'outline' : 'rose'}">${delta >= 0 ? '+' : ''}${delta} 分</span></div>
    <div class="grid-2">
      <div class="card card-tight card-quiet">
        <div class="fl" style="margin-bottom:10px">优化前</div>
        ${scoreRing(r.before.score)}
        <div class="kv-grid" style="margin-top:14px">
          <div class="kv"><dt>通过门</dt><dd class="mono">${r.before.passed}/${r.before.total}</dd></div>
          <div class="kv"><dt>未过项</dt><dd class="mono">${r.before.problems.length}</dd></div>
        </div>
      </div>
      <div class="card card-tight" style="border-color:rgba(15,110,86,.3)">
        <div class="fl" style="margin-bottom:10px;color:var(--teal)">优化后</div>
        ${scoreRing(r.after.score)}
        <div class="kv-grid" style="margin-top:14px">
          <div class="kv"><dt>通过门</dt><dd class="mono" style="color:var(--teal)">${r.after.passed}/${r.after.total}</dd></div>
          <div class="kv"><dt>未过项</dt><dd class="mono" style="color:var(--teal)">${r.after.problems.length}</dd></div>
        </div>
      </div>
    </div>
    ${(r.changed ?? 0) > 0 ? `<div class="notice notice-ok" style="margin-top:14px">${ICONS.check}<div>确定性修复改动 <b>${r.changed}</b> 处：拆超长台词、给缺动作的场次补动作、按目标时长回补节拍。</div></div>` : ''}
    ${r.note ? `<div class="notice notice-warn" style="margin-top:10px">${ICONS.alert}<div>${esc(r.note)}</div></div>` : ''}
  </div>
  ${(r.rewritten ?? []).length ? `<div class="card">
    <div class="card-head"><div><h2>逐集改写结果</h2><div class="sub">只改「未过门最多」的几集；改写没过门的自动丢弃，保留原稿</div></div>
      <span class="tag ${okCount === r.rewritten.length ? 'teal' : 'amber'}">${okCount}/${r.rewritten.length} 集已改</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>集</th><th>结果</th><th>门</th><th>说明</th></tr></thead><tbody>
      ${r.rewritten.map((x) => `<tr>
        <td class="row-title">第 ${x.ep} 集</td>
        <td>${x.ok ? '<span class="tag teal">已改</span>' : '<span class="tag amber">保留原稿</span>'}</td>
        <td class="mono" style="font-size:11px">${x.gates?.length ? `${x.gates.filter((g) => g.ok).length}/${x.gates.length}` : '—'}</td>
        <td class="row-sub" style="font-size:11px">${esc(x.error || (x.ok ? '通过全部门' : ''))}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>` : ''}
  ${r.advice?.length ? `<div class="card">
    <div class="card-head"><div><h2>人工建议</h2><div class="sub">机器和模型都改不动的部分，需要人来</div></div></div>
    <div class="gate-list">${r.advice.map((x) => `<div class="gate"><span class="gate-icon" style="color:var(--amber)">${ICONS.alert}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(x.advice)}</span><span></span></div>`).join('')}</div>
  </div>` : ''}
  ${r.after.problems?.length ? `<div class="card">
    <div class="card-head"><div><h2>仍未过门</h2><div class="sub">${r.after.problems.length} 项</div></div></div>
    ${gateList(r.after.problems.map((p) => ({ ...p, ok: false })))}
  </div>` : ''}`;
}

/* ================= 统计报表 ================= */
export function viewStats() {
  const r = state.data.stats;
  const tags = `<span class="tag purple">图表化体检</span><span class="tag blue">节奏 / 出场 / 密度</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>统计报表</h2><div class="sub">场次时长、角色出场、对白密度、每集爽点节奏——一张图看清剧本健康度</div></div>
      <div class="actions">${curInput() ? busyBtn('stats', '生成报表', 'chart') : `<button class="btn btn-primary" disabled>${ICONS.chart}生成报表</button>`}</div></div>
    ${!curInput() ? `<div class="notice notice-warn">${ICONS.alert}<div>请先载入剧本。</div></div>` : ''}
  </div>`;

  if (!curInput()) return pageHead('质量把控', '统计报表', '把剧本拆成图表：每集场次与时长、角色出场分布、每集爽点节奏曲线。', tags) + importCard({ previewOpen: false }) + form + `<div style="margin-top:16px">${needScript()}</div>`;
  if (!r) return pageHead('质量把控', '统计报表', '把剧本拆成图表：每集场次与时长、角色出场分布、每集爽点节奏曲线。', tags) + importCard({ previewOpen: false }) + form
    + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.chart}</div><h3>等待生成</h3><p>点「生成报表」。</p></div></div>`;

  return pageHead('质量把控', '统计报表', '把剧本拆成图表：每集场次与时长、角色出场分布、每集爽点节奏曲线。', tags) + importCard({ previewOpen: false }) + form + `
  <div class="card">
    <div class="card-head"><div><h2>总量</h2><div class="sub">${r.totals.episodes} 集 · ${r.totals.scenes} 场</div></div></div>
    ${statStrip([
      { label: '总时长', value: r.totals.time, cls: 'hl' },
      { label: '场次', value: r.totals.scenes },
      { label: '台词句数', value: r.totals.lines },
      { label: '对白字数', value: r.totals.spoken },
      { label: '出场角色', value: r.totals.characters },
    ])}
  </div>
  <div class="card">
    <div class="card-head"><div><h2>每集爽点节奏</h2><div class="sub">爽点词命中数（揭穿/曝光/反转/跪下…）</div></div></div>
    ${rhythmChart(r.rhythm)}
  </div>
  <div class="grid-2">
    <div class="card card-tight">
      <div class="card-head"><div><h2>角色出场</h2><div class="sub">按台词句数排序</div></div></div>
      ${barRows(r.characters.slice(0, 8).map((c) => ({ name: c.name, value: c.lines })), ' 句')}
      <div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>角色</th><th>句数</th><th>字数</th><th>出场集</th></tr></thead><tbody>
        ${r.characters.map((c) => `<tr><td class="row-title">${esc(c.name)}</td><td class="mono">${c.lines}</td><td class="mono">${c.chars}</td><td class="mono" style="font-size:11px">${(c.episodes ?? []).join(',')}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    <div class="card card-tight">
      <div class="card-head"><div><h2>每集明细</h2><div class="sub">场次 / 台词 / 钩子 / 悬念</div></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>集</th><th>时长</th><th>场</th><th>台词</th><th>动作</th><th>钩/悬</th></tr></thead><tbody>
        ${r.perEpisode.map((e) => `<tr><td class="row-title">第 ${e.ep} 集</td><td class="mono">${fmtTime(e.targetSeconds)}</td><td class="mono">${e.scenes}</td><td class="mono">${e.lines}</td><td class="mono">${e.actions}</td>
          <td>${e.hasHook ? '<span class="tag teal">钩</span>' : '<span class="tag outline">—</span>'} ${e.hasCliff ? '<span class="tag blue">悬</span>' : '<span class="tag outline">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
  </div>
  ${r.warnings.length ? `<div class="card">
    <div class="card-head"><div><h2>体检预警</h2><div class="sub">${r.warnings.length} 条</div></div></div>
    <div class="gate-list">${r.warnings.map((x) => `<div class="gate"><span class="gate-icon" style="color:var(--amber)">${ICONS.alert}</span><span class="gate-name" style="font-weight:500;font-size:11.5px">${esc(x)}</span><span></span></div>`).join('')}</div>
  </div>` : ''}`;
}

/* 节奏曲线（内联 SVG，无依赖） */
function rhythmChart(rhythm) {
  const w = 560, h = 150, padL = 30, padB = 24, padT = 12;
  const n = rhythm.length || 1;
  const max = Math.max(...rhythm.map((r) => r.payoffs), 4);
  const iw = w - padL - 12, ih = h - padT - padB;
  const x = (i) => padL + (i * iw) / Math.max(1, n - 1);
  const y = (v) => padT + ih - (v / max) * ih;
  const pts = rhythm.map((r, i) => `${x(i)},${y(r.payoffs)}`);
  const area = `M${padL},${padT + ih} L${pts.join(' L')} L${x(n - 1)},${padT + ih} Z`;
  const grid = [0, max / 2, max].map((v) => `<line class="grid-line" x1="${padL}" y1="${y(v)}" x2="${w - 12}" y2="${y(v)}"></line><text class="axis-label" x="4" y="${y(v) + 3}">${Math.round(v)}</text>`).join('');
  const dots = rhythm.map((r, i) => `<circle class="dot" cx="${x(i)}" cy="${y(r.payoffs)}" r="3.5"></circle><text class="axis-label" x="${x(i)}" y="${h - 6}" text-anchor="middle">E${r.ep}</text>`).join('');
  return `<svg class="rhythm-chart" viewBox="0 0 ${w} ${h}">${grid}<path class="area" d="${area}"></path><polyline class="line" points="${pts.join(' ')}"></polyline>${dots}</svg>`;
}

/* ================= 运行器 ================= */
export const runners = {
  async qa() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    state.data.eval = await api.evaluate(ctx());
    const r = state.data.eval;
    toast(
      r.judge
        ? `评估完成：${r.score} 分（门 ${r.passed}/${r.total} · 模型 ${r.judge.score} ${r.judge.verdict}）`
        : `门评完了：${r.score} 分，模型评审没拿到（${r.judgeError?.slice(0, 40) || '未知原因'}）`,
      r.judge ? 'ok' : 'warn',
    );
  },
  async checkup() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    state.data.checkup = await api.checkup(ctx());
    const c = state.data.checkup;
    toast(`内容体检：${c.passed}/${c.total} 项通过${c.problems.length ? `，${c.problems.map((p) => p.label).join('、')} 有问题` : ''}`);
  },
  async optimize() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    const limit = Math.min(20, Math.max(1, Number(state.cfg.optLimit) || 8));
    state.data.opt = await api.optimize(ctx({ limit }));
    const r = state.data.opt;
    if (r.script) {
      // 优化后的稿子回写到「本工具自己的输入」，只影响本页
      setCurInput({ ...curInput(), script: r.script });
      state.data.eval = r.after;
    }
    const ok = (r.rewritten ?? []).filter((x) => x.ok).length;
    toast(`优化完成：${r.before.score} → ${r.after.score} 分${ok ? `，重写 ${ok} 集` : ''}`, r.after.score >= r.before.score ? 'ok' : 'warn');
  },
  async stats() {
    if (!curInput()) return toast('请先载入剧本', 'warn');
    state.data.stats = await api.stats(ctx());
    toast('统计报表已生成');
  },
};
