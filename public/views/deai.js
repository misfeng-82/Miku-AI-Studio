/* 视图域：质量把控 —— 去 AI 味（13 维实测 + 带门禁的改写） */
import { state, api, esc, ICONS, busyBtn, pageHead, scoreRing, gateList, statStrip, toast, copyText } from '../core.js';

const TARGETS = [
  { v: 40, name: '定稿门禁 40', hint: '上平台前的常规线' },
  { v: 55, name: '初稿 55', hint: '能看，但还留着一些套话' },
  { v: 20, name: '严格 20', hint: '近乎人类手改的程度，难且慢' },
];

const target = () => Number(state.cfg.deaiTarget) || 40;

/** 惩罚值 → 颜色（越低越好，所以是反着来的） */
const barColor = (p) => (p >= 0.7 ? 'rose' : p >= 0.35 ? 'amber' : 'teal');

/**
 * 维度条：这里不能用 core 的 barRows。
 * barRows 按「本组最大值」归一化，适合展示各项得分的相对高低；
 * 惩罚值本身就在 0–1 之间，绝对值才有意义（0.9 就是快顶格了），
 * 按最大值归一化会把「最好的那一项」也画满格，看着像全都烂。
 */
function dimBars(dims) {
  return dims.map((d) => {
    const off = d.effectiveWeight === 0;
    return `<div class="bar-row" title="${esc(d.detail)}">
      <span class="bl">${esc(d.label)}${off ? ' <span class="muted" style="font-size:9.5px">不计分</span>' : ''}</span>
      <div class="bar-track"><span class="bar-fill ${off ? '' : barColor(d.penalty)}" style="width:${Math.round(d.penalty * 100)}%"></span></div>
      <span class="bv">${d.penalty.toFixed(2)}</span>
    </div>`;
  }).join('');
}

/** 命中的套话：按词给 chip，带出现次数和一处上下文 */
function issueChips(issues) {
  if (!issues.length) return '<div class="notice notice-ok">' + ICONS.check + '<div>没有命中套话词表——这一步的问题在节奏与具体性，不在用词。</div></div>';
  return `<div class="chip-row">${issues.slice(0, 18).map((i) => `<span class="chip static" title="${esc(i.samples?.[0] ?? '')}">${esc(i.word)}<span class="muted" style="font-size:9.5px"> ×${i.count}</span></span>`).join('')}</div>`;
}

/** 扫描报告卡 */
function reportCard(r) {
  const rep = r.report;
  if (!rep?.ok) {
    return `<div class="card"><div class="card-head"><div><h2>扫描结果</h2></div></div>
      <div class="notice notice-warn">${ICONS.alert}<div>${esc(rep?.error ?? '没有可扫描的内容')}</div></div></div>`;
  }

  const flags = rep.structureFlags ?? [];
  const advisories = rep.advisory ?? [];
  const top = rep.topProblems ?? [];

  return `<div class="card">
    <div class="card-head">
      <div><h2>扫描结果</h2><div class="sub">${rep.charCount} 字 · ${rep.basic.sentences} 句 · ${rep.basic.paragraphs} 段 · 对话占比 ${(rep.basic.dialogRatio * 100).toFixed(1)}%</div></div>
      <div class="chip-row">
        <span class="tag ${rep.score <= 20 ? 'teal' : rep.score <= 40 ? 'blue' : rep.score <= 55 ? 'amber' : 'rose'}">${esc(rep.grade)}</span>
        <span class="tag outline">门禁 ${r.maxScore}</span>
        ${rep.bodyExtracted ? '<span class="tag outline">已自动只扫正文</span>' : ''}
      </div>
    </div>

    <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      ${scoreRing(rep.score)}
      <div style="flex:1;min-width:220px">${gateList(r.gates)}</div>
    </div>

    ${top.length ? `<div class="notice notice-warn" style="margin-top:12px">${ICONS.alert}<div>
      <b>先动这三项</b>：${top.map((d) => `${esc(d.label)}（${esc(d.detail)}）`).join('、')}
    </div></div>` : ''}

    <div style="margin-top:16px"><div class="fl" style="margin-bottom:8px">13 个维度（惩罚值越低越好；灰条是不计分的短样本项）</div>
      ${dimBars(rep.dimensions)}
    </div>

    <div style="margin-top:16px"><div class="fl" style="margin-bottom:8px">命中的套话（${rep.clicheTotal} 处）</div>
      ${issueChips(rep.issues ?? [])}
    </div>

    ${flags.length ? `<div style="margin-top:14px"><div class="fl" style="margin-bottom:6px">结构标志</div>
      <div class="chip-row">${flags.map((f) => `<span class="chip static">${esc(f.type)}${f.signal ? `：${esc(f.signal)}` : ''}${f.count ? ` ×${f.count}` : ''}</span>`).join('')}</div></div>` : ''}

    ${advisories.length ? `<div class="notice notice-info" style="margin-top:14px">${ICONS.alert}<div>${advisories.map((a) => esc(a)).join('<br>')}</div></div>` : ''}

    <div class="muted" style="margin-top:12px;font-size:10.5px;line-height:1.7">
      全部指标都是本机实测：句长/段长 cv、套话密度、破折号密度、对话占比、感官密度、MATTR。
      同一段文本任何时候扫都是同一分，所以它可以当门禁用。
    </div>
  </div>`;
}

/** 改写结果卡 */
function rewriteCard(rw) {
  if (!rw) return '';
  if (!rw.ok) {
    return `<div class="card"><div class="card-head"><div><h2>改写结果</h2></div></div>
      <div class="notice notice-err">${ICONS.x}<div>${esc(rw.error ?? '改写失败')}</div></div></div>`;
  }

  if (rw.skipped) {
    return `<div class="card">
      <div class="card-head"><div><h2>改写结果</h2><div class="sub">扫描是真的，改写要接模型</div></div>
        <span class="tag amber">${esc(rw.llm?.mode === 'mock' ? '样本引擎' : '未接入模型')}</span></div>
      <div class="notice notice-info">${ICONS.alert}<div>${esc(rw.note)}</div></div>
    </div>`;
  }

  const b = rw.before;
  const a = rw.after;
  const delta = rw.delta ?? 0;

  return `<div class="card">
    <div class="card-head">
      <div><h2>改写结果</h2><div class="sub">${esc(rw.note)}</div></div>
      <div class="chip-row">
        <span class="tag ${a.score <= rw.target ? 'teal' : 'amber'}">${b.score} → ${a.score}</span>
        <span class="tag ${delta < 0 ? 'teal' : 'rose'}">${delta <= 0 ? '' : '+'}${delta} 分</span>
        <span class="tag outline">${rw.llm?.mode === 'live' ? `真模型 · ${esc(rw.llm.model ?? '')}` : '样本'}</span>
      </div>
    </div>

    ${statStrip([
      { value: b.score, label: `改前（${b.grade}）`, cls: '' },
      { value: a.score, label: `改后（${a.grade}）`, cls: a.score <= rw.target ? 'teal' : 'amber' },
      { value: `${b.charCount} → ${a.charCount}`, label: '字数' },
      { value: b.clicheTotal + ' → ' + a.clicheTotal, label: '套话命中' },
    ])}

    <div style="margin-top:14px">${gateList(rw.gates)}</div>

    ${(rw.rounds ?? []).length > 1 ? `<div class="muted" style="margin-top:10px;font-size:10.5px">轮次：${rw.rounds.map((x) => `第${x.round}轮 ${x.score ?? '—'} 分`).join(' · ')}</div>` : ''}

    <div style="margin-top:16px"><div class="fl" style="margin-bottom:8px">改写后的正文</div>
      <div class="pblock"><div class="pblock-head"><span class="ph-name">deai output</span><span class="tag outline">${a.charCount} 字</span></div>
        <div class="pblock-body">${esc(rw.text)}</div></div>
      <div class="actions" style="margin-top:10px">
        <button class="btn" data-copy="${esc(rw.text)}">${ICONS.copy}复制正文</button>
        <button class="btn" data-deai-adopt>${ICONS.check}用这份替换输入框</button>
      </div>
    </div>

    ${rw.record ? `<div style="margin-top:16px"><div class="fl" style="margin-bottom:8px">修改记录（模型自述，可核对）</div>
      <div class="pblock"><div class="pblock-body" style="font-size:11.5px;line-height:1.75">${esc(rw.record)}</div></div></div>` : ''}

    ${rw.pending ? `<div class="notice notice-info" style="margin-top:12px">${ICONS.alert}<div><b>它选择不改的地方</b><br>${esc(rw.pending)}</div></div>` : ''}
  </div>`;
}

export function viewDeai() {
  const d = state.data.deai ?? {};
  const scanResult = d.scan ?? null;
  const rw = d.rw ?? null;
  const text = String(state.cfg.deaiText ?? '');
  const chars = text.replace(/\s/g, '').length;

  const tags = `<span class="tag purple">13 维实测</span><span class="tag teal">扫描零费用</span><span class="tag outline">门禁可核对</span>`;

  const form = `<div class="card">
    <div class="card-head"><div><h2>稿子贴进来</h2><div class="sub">剧本、小说、旁白都行；扫描是本机算的，不花额度</div></div>
      <span class="tag ${chars >= 300 ? 'blue' : 'amber'}">${chars} 字</span></div>
    <label class="field"><span class="fl">正文（脚本可直接贴「角色：台词」格式）</span>
      <textarea rows="10" data-cfg="deaiText" placeholder="把整集剧本或整章小说粘进来。少于 300 字时分数仅供参考，扫描器会自己标注。">${esc(text)}</textarea></label>

    <div class="form-2" style="margin-top:12px">
      <div class="field"><span class="fl">门禁线</span>
        <div class="chip-row">${TARGETS.map((t) => `<button class="chip ${target() === t.v ? 'active' : ''}" data-deaitarget="${t.v}" title="${esc(t.hint)}">${esc(t.name)}</button>`).join('')}</div>
      </div>
      <div class="field"><span class="fl">说明</span>
        <div class="muted" style="font-size:11px;line-height:1.7">扫描：秒出、免费。改写：调模型，逐轮复扫，过了门才收工。</div>
      </div>
    </div>

    <div class="actions" style="margin-top:14px">
      ${busyBtn('deaiScan', '只扫描（免费）', 'radar')}
      ${busyBtn('deaiRewrite', '去味改写', 'wand')}
      <span class="muted" style="font-size:10.5px">改写不改情节、人物、场次顺序，只改表达</span>
    </div>
  </div>`;

  if (!scanResult && !rw) {
    return pageHead('质量把控', '去 AI 味', '把「AI 味」变成可以数的东西：13 个维度本机实测，同一段稿任何时候都是同一个分；改写按实测数据下手，改完复扫，分数降没降看得见。', tags)
      + form
      + `<div style="margin-top:16px">${`<div class="empty"><div class="eicon">${ICONS.wand}</div><h3>等待扫描</h3><p>粘贴一集剧本或一章小说，点「只扫描」先看看分。</p></div>`}</div>`;
  }

  return pageHead('质量把控', '去 AI 味', '把「AI 味」变成可以数的东西：13 个维度本机实测，同一段稿任何时候都是同一个分；改写按实测数据下手，改完复扫，分数降没降看得见。', tags)
    + form
    + `<div style="margin-top:16px">${reportCard(scanResult ?? { report: rw.after, gates: rw.gates, maxScore: rw.target })}</div>`
    + `<div style="margin-top:16px">${rewriteCard(rw)}</div>`;
}

/* ================= 运行器 ================= */
export const runners = {
  async deaiScan() {
    const text = String(state.cfg.deaiText ?? '');
    if (text.replace(/\s/g, '').length < 10) return toast('先把稿子贴进来（至少 10 个字）', 'warn');
    const r = await api.deaiScan({ text, maxScore: target() });
    state.data.deai = { ...(state.data.deai ?? {}), scan: r, rw: null };
    toast(`扫描完成：${r.report.score} 分（${r.report.grade}）`);
  },

  async deaiRewrite() {
    const text = String(state.cfg.deaiText ?? '');
    if (text.replace(/\s/g, '').length < 30) return toast('太短了：改写至少要 30 个字', 'warn');
    const rw = await api.deaiRewrite({ text, target: target(), rounds: 2 });
    state.data.deai = { scan: { report: rw.before, gates: rw.gates, maxScore: rw.target }, rw };
    if (rw.skipped) toast(rw.note, 'warn', 4200);
    else toast(rw.note, rw.after.score <= rw.target ? 'ok' : 'warn', 4200);
  },
};

/** 「用这份替换输入框」：把改写稿写回输入，方便再扫一轮或继续改 */
export function adoptRewrite() {
  const rw = state.data.deai?.rw;
  if (!rw?.text) return;
  state.cfg.deaiText = rw.text;
  state.data.deai = { ...(state.data.deai ?? {}), rw: null };
  toast('已替换输入框，可再扫一次');
}
