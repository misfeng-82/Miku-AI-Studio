/* 视图域：小说创作 —— 长篇（设定集 → 章纲 → 逐章正文） */
import { state, api, esc, ICONS, busyBtn, pageHead, gateList, statStrip, toast, download } from '../core.js';

const GENRES = ['悬疑', '都市', '古风', '科幻', '玄幻', '现实'];
const AUDIENCES = ['男频', '女频', '通用'];

const cfg = () => state.cfg;
const book = () => state.data.novel?.book ?? null;
const gates = () => state.data.novel?.gates ?? [];
const readiness = () => state.data.novel?.readiness ?? null;

/** 本章状态标签：已写/未写、过没过门 */
function chapterTag(ch) {
  if (!ch?.text) return '<span class="tag outline">未写</span>';
  if (ch.ok) return `<span class="tag teal">已过门 · ${ch.scan?.score ?? '—'} 分</span>`;
  return `<span class="tag amber">待修 · ${ch.scan?.score ?? '—'} 分</span>`;
}

/* ================= 书目列表 ================= */
function shelfCard(b) {
  const pct = b.planned ? Math.round((b.written / b.planned) * 100) : 0;
  return `<button class="card card-tight" data-novelopen="${b.id}" style="text-align:left;width:100%">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:700;line-height:1.4">${esc(b.title)}</div>
        <div class="muted" style="font-size:10.5px;margin-top:3px">${esc(b.genre || '未定题材')} · 目标 ${b.targetWords} 字</div>
      </div>
      <span class="tag ${b.written ? 'teal' : 'outline'}">${b.written}/${b.planned || '—'} 章</span>
    </div>
    <div class="bar-track" style="margin-top:10px"><span class="bar-fill teal" style="width:${pct}%"></span></div>
    <div class="muted" style="font-size:10px;margin-top:6px">${b.words} 字已写${b.avgScan != null ? ` · 平均 AI 痕迹 ${b.avgScan}` : ''}</div>
  </button>`;
}

/* ================= 新建表单 ================= */
function createForm() {
  return `<div class="card">
    <div class="card-head"><div><h2>立项</h2><div class="sub">先定终点和体量：目标字数 ÷ 单章字数 = 章数，章数由这里算出来，不是模型随口定</div></div></div>
    <div class="form-2">
      <label class="field"><span class="fl">书名</span><input type="text" data-cfg="novelTitle" value="${esc(cfg().novelTitle)}" placeholder="如：渡口灯" /></label>
      <div class="field"><span class="fl">题材</span>
        <div class="chip-row">${GENRES.map((g) => `<button class="chip ${cfg().novelGenre === g ? 'active' : ''}" data-novelgenre="${g}">${g}</button>`).join('')}</div>
      </div>
    </div>
    <label class="field" style="margin-top:12px"><span class="fl">一句话故事（要说清主角要什么、谁挡着）</span>
      <textarea rows="2" data-cfg="novelLogline" placeholder="所有人都说那场船难是意外，只有他记得那天江上有一盏没熄的灯。">${esc(cfg().novelLogline)}</textarea></label>
    <div class="form-2" style="margin-top:12px">
      <label class="field"><span class="fl">目标字数</span><input type="number" min="5000" step="10000" data-cfg="novelTarget" value="${esc(cfg().novelTarget)}" /></label>
      <label class="field"><span class="fl">单章字数</span><input type="number" min="800" step="200" data-cfg="novelPer" value="${esc(cfg().novelPer)}" /></label>
    </div>
    <div class="form-2" style="margin-top:12px">
      <div class="field"><span class="fl">读者</span>
        <div class="chip-row">${AUDIENCES.map((a) => `<button class="chip ${cfg().novelAudience === a ? 'active' : ''}" data-novelaud="${a}">${a}</button>`).join('')}</div>
      </div>
      <label class="field"><span class="fl">基调（可空）</span><input type="text" data-cfg="novelTone" value="${esc(cfg().novelTone)}" placeholder="如：冷、克制、潮湿" /></label>
    </div>
    <label class="field" style="margin-top:12px"><span class="fl">创作禁区（可空）</span>
      <input type="text" data-cfg="novelForbidden" value="${esc(cfg().novelForbidden)}" placeholder="如：不写未成年人受害细节" /></label>
    <div class="actions" style="margin-top:14px">${busyBtn('novelCreate', '立项并建书', 'book')}</div>
  </div>`;
}

/* ================= 设定集 ================= */
function bibleCard(b) {
  const data = b.bible;
  if (!data) {
    return `<div class="card">
      <div class="card-head"><div><h2>设定集</h2><div class="sub">人物（欲望/缺陷/说话方式）+ 世界规则（每条带代价）+ 核心承诺（含结局方向）</div></div>
        <div class="actions">${busyBtn('novelBible', '生成设定集', 'user')}</div></div>
      <div class="empty"><div class="eicon">${ICONS.user}</div><h3>还没有设定集</h3><p>先有人和世界，才有冲突。这一步决定后面几十章能不能立住。</p></div>
    </div>`;
  }

  const cast = data.characters ?? [];
  const world = data.world ?? [];
  return `<div class="card">
    <div class="card-head"><div><h2>设定集</h2><div class="sub">${cast.length} 人 · ${world.length} 条世界规则</div></div>
      <div class="actions">${busyBtn('novelBible', '重出设定', 'refresh')}</div></div>

    ${data.promise?.sellingPoint || data.promise?.ending ? `<div class="notice notice-ai">${ICONS.book}<div>
      ${data.promise.sellingPoint ? `<b>卖点</b>：${esc(data.promise.sellingPoint)}<br>` : ''}
      ${data.promise.theme ? `<b>主题</b>：${esc(data.promise.theme)}<br>` : ''}
      ${data.promise.ending ? `<b>结局方向</b>：${esc(data.promise.ending)}` : ''}
    </div></div>` : ''}

    <div class="grid-2" style="margin-top:14px">
      <div>
        <div class="fl" style="margin-bottom:8px">人物</div>
        <div class="rows">${cast.map((c) => `<div class="row" style="grid-template-columns:1fr">
          <div>
            <div class="row-title" style="font-size:12px">${esc(c.name)}<span class="tag outline" style="margin-left:6px">${esc(c.role)}</span></div>
            <div class="row-sub">要：${esc(c.want || '—')}　缺：${esc(c.flaw || '—')}</div>
            ${c.voice ? `<div class="row-sub">说话：${esc(c.voice)}</div>` : ''}
          </div>
        </div>`).join('')}</div>
      </div>
      <div>
        <div class="fl" style="margin-bottom:8px">世界规则</div>
        <div class="rows">${world.map((w) => `<div class="row" style="grid-template-columns:1fr">
          <div><div class="row-title" style="font-size:11.5px">${esc(w.rule)}</div>
          <div class="row-sub">代价：${esc(w.cost || '未写')}${w.bound ? `　边界：${esc(w.bound)}` : ''}</div></div>
        </div>`).join('')}</div>
      </div>
    </div>
  </div>`;
}

/* ================= 章纲 ================= */
function outlineCard(b) {
  const o = b.outline;
  if (!o) {
    return `<div class="card">
      <div class="card-head"><div><h2>章纲与伏笔</h2><div class="sub">按 目标字数 ÷ 单章字数 排章数；每章要有目标、冲突、转折、钩子</div></div>
        <div class="actions">${busyBtn('novelOutline', '排章纲', 'layers')}</div></div>
      <div class="empty"><div class="eicon">${ICONS.layers}</div><h3>还没有章纲</h3><p>${b.bible ? '设定集已就绪，可以排章纲了。' : '先出设定集，再来排章纲。'}</p></div>
    </div>`;
  }

  const chapters = o.chapters ?? [];
  const written = new Map((b.chapters ?? []).map((c) => [c.index, c]));
  return `<div class="card">
    <div class="card-head"><div><h2>章纲与伏笔</h2><div class="sub">${chapters.length} 章 · ${(o.foreshadow ?? []).length} 条伏笔 · ${(o.volumes ?? []).length} 卷</div></div>
      <div class="actions">${busyBtn('novelOutline', '重排章纲', 'refresh')}</div></div>

    <div class="rows" style="max-height:420px;overflow:auto">${chapters.map((c) => {
      const ch = written.get(c.index);
      return `<div class="row" style="grid-template-columns:1fr auto;align-items:center">
        <div style="min-width:0">
          <div class="row-title" style="font-size:11.5px">第${c.index}章 ${esc(c.title)}
            <span class="muted" style="font-weight:400">· ${esc(c.goal || '（缺目标）')}</span></div>
          <div class="row-sub">冲突：${esc(c.conflict || '—')}　钩子：${esc(c.hook || '—')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${chapterTag(ch)}
          <button class="btn btn-sm" data-novelwrite="${c.index}">${ch?.text ? '重写' : '写这章'}</button>
        </div>
      </div>`;
    }).join('')}</div>

    ${(o.foreshadow ?? []).length ? `<div style="margin-top:14px"><div class="fl" style="margin-bottom:6px">伏笔台账（自动跟踪回收状态）</div>
      <div class="chip-row">${o.foreshadow.map((f) => {
        const st = f.status === 'paid' ? { cls: 'teal', text: `已回收·第${f.paidAt}章` }
          : f.status === 'overdue' ? { cls: 'rose', text: '逾期未收' }
            : f.status === 'due' ? { cls: 'amber', text: '待确认回收' }
              : f.status === 'planted' ? { cls: 'blue', text: `已埋·第${f.plantedAt ?? f.plantAt}章` }
                : { cls: 'outline', text: '待埋' };
        const canConfirm = f.status !== 'paid';
        return `<button class="chip ${canConfirm ? '' : 'static'}" ${canConfirm ? `data-foreconfirm="${esc(f.id)}" title="点一下标记为已回收（模型换了说法时用这个）"` : `title="${esc(f.content)}"`}>${esc(f.id)} 埋${f.plantAt}→收${f.payoffAt}<span class="tag ${st.cls}" style="margin-left:6px">${st.text}</span></button>`;
      }).join('')}</div></div>` : ''}
  </div>`;
}

/* ================= 最新章节 ================= */
function latestChapterCard(b) {
  const list = [...(b.chapters ?? [])].sort((a, z) => z.index - a.index);
  const ch = list[0];
  if (!ch) return '';
  return `<div class="card">
    <div class="card-head"><div><h2>第${ch.index}章 ${esc(ch.title)}</h2>
      <div class="sub">${ch.words} 字 · AI 痕迹 ${ch.scan?.score ?? '—'}（${esc(ch.scan?.grade ?? '')}）</div></div>
      <div class="chip-row">${chapterTag(ch)}
        <button class="btn btn-sm" data-copy="${esc(ch.text)}">${ICONS.copy}复制正文</button>
      </div></div>
    ${ch.gates?.length ? gateList(ch.gates) : ''}
    ${(ch.memory?.points ?? []).length ? `<div style="margin-top:12px"><div class="fl" style="margin-bottom:6px">本章要点（自动提炼，供下一章参考）</div>
      <div class="chip-row">${ch.memory.points.map((p) => `<span class="chip static" title="${esc(p)}">${esc(p)}</span>`).join('')}</div></div>` : ''}
    ${(state.data.novel?.advisories ?? []).length ? `<div class="notice notice-warn" style="margin-top:12px">${ICONS.alert}<div>
      ${state.data.novel.advisories.map((a) => esc(a)).join('<br>')}</div></div>` : ''}
    <div class="pblock" style="margin-top:12px"><div class="pblock-head"><span class="ph-name">chapter ${ch.index}</span><span class="tag outline">${ch.words} 字</span></div>
      <div class="pblock-body" style="max-height:260px;overflow:auto">${esc(ch.text.slice(0, 1200))}${ch.text.length > 1200 ? '…' : ''}</div></div>
  </div>`;
}

/* ================= 连续性记忆 ================= */
/**
 * 长篇真正的难点是「记住前面写过什么」。这张卡把纯规则提炼出的记忆摊开：
 * 全书脉络 / 已出场人物 / 已出现地点 / 时间线 / 待回收伏笔。
 * 它是下一章提示词里【连续性记忆】那一段的来源，也是人工核对连续性的地方。
 */
function memoryCard(b) {
  const m = b.memory;
  const open = (b.outline?.foreshadow ?? []).filter((f) => f.status !== 'paid');
  if (!m?.writtenChapters) {
    return `<div class="card">
      <div class="card-head"><div><h2>连续性记忆</h2><div class="sub">写完第一章后自动提炼：谁出过场、在哪儿、埋了什么、过了多久</div></div></div>
      <div class="empty"><div class="eicon">${ICONS.layers}</div><h3>还没有记忆</h3><p>每写完一章会自动提炼一次，纯本机规则，不花额度。</p></div>
    </div>`;
  }
  return `<div class="card">
    <div class="card-head"><div><h2>连续性记忆</h2>
      <div class="sub">${m.writtenChapters} 章 · ${m.totalChars} 字 · 纯规则提炼（不花额度，可复现）</div></div>
      <span class="tag teal">自动注入下一章提示词</span></div>

    ${(m.arc ?? []).length ? `<div><div class="fl" style="margin-bottom:6px">全书脉络</div>
      <div class="rows" style="max-height:220px;overflow:auto">${m.arc.slice(-10).map((a) => `<div class="row" style="grid-template-columns:52px 1fr">
        <div class="muted mono" style="font-size:10.5px">第${a.no}章</div>
        <div style="font-size:11.5px">${esc(a.point || '（没提炼出要点）')}</div>
      </div>`).join('')}</div></div>` : ''}

    <div class="grid-2" style="margin-top:14px">
      <div>
        <div class="fl" style="margin-bottom:6px">已出场人物</div>
        <div class="chip-row">${(m.characters ?? []).map((n) => `<span class="chip static">${esc(n)}</span>`).join('') || '<span class="muted" style="font-size:11px">（没有识别到）</span>'}</div>
      </div>
      <div>
        <div class="fl" style="margin-bottom:6px">已出现地点</div>
        <div class="chip-row">${(m.places ?? []).map((n) => `<span class="chip static">${esc(n)}</span>`).join('') || '<span class="muted" style="font-size:11px">（没有识别到）</span>'}</div>
      </div>
    </div>

    ${(m.timeline ?? []).length ? `<div style="margin-top:12px"><div class="fl" style="margin-bottom:6px">时间线</div>
      <div class="chip-row">${m.timeline.slice(-6).map((t) => `<span class="chip static">第${t.no}章：${esc(t.t)}</span>`).join('')}</div></div>` : ''}

    ${open.length ? `<div class="notice notice-warn" style="margin-top:12px">${ICONS.alert}<div>
      <b>还没回收的伏笔</b>：${open.map((f) => `${esc(f.id)}（${esc(f.content)}，计划第${f.payoffAt}章）`).join('；')}
    </div></div>` : `<div class="notice notice-ok" style="margin-top:12px">${ICONS.check}<div>伏笔全部回收完毕。</div></div>`}
  </div>`;
}

/* ================= 工作台 ================= */
function workbench(b) {
  const r = readiness() ?? {};
  const bg = gates();
  return `<div class="card">
    <div class="card-head"><div><h2>${esc(b.title)}</h2>
      <div class="sub">${esc(b.genre || '未定题材')} · ${esc(b.audience || '通用')} · 目标 ${b.targetWords} 字 / 单章 ${b.wordsPerChapter} 字</div></div>
      <div class="chip-row">
        <span class="tag ${r.bibleReady ? 'teal' : 'amber'}">设定 ${r.biblePass ?? 0}/${r.bibleTotal ?? 0} 门</span>
        <span class="tag ${r.written ? 'teal' : 'outline'}">${r.written ?? 0}/${r.planned ?? 0} 章</span>
        <button class="btn btn-sm" data-novelexport="${b.id}">${ICONS.download}导出全书</button>
      </div>
    </div>
    ${statStrip([
      { value: r.planned ?? 0, label: '计划章数' },
      { value: r.written ?? 0, label: '已写章数' },
      { value: (b.chapters ?? []).reduce((n, c) => n + (c.words ?? 0), 0), label: '累计字数' },
      { value: r.clean ?? 0, label: '全门通过' },
    ])}
    <div style="margin-top:14px">${gateList(bg)}</div>
    <div class="muted" style="margin-top:10px;font-size:10.5px;line-height:1.7">
      设定门是确定性的：章数是否够装下目标字数、每章有没有目标/冲突/钩子、伏笔有没有回收、结局有没有定。
      模型只负责写，不负责评判自己写得对不对；正文另过 6 道单章门（字数/钩子/对话/承接/AI 痕迹/结尾）。
    </div>
  </div>
  ${bibleCard(b)}
  ${outlineCard(b)}
  ${latestChapterCard(b)}
  ${memoryCard(b)}`;
}

export function viewNovel() {
  const list = state.data.novel?.list ?? null;
  const b = book();
  const tags = `<span class="tag purple">长篇</span><span class="tag teal">确定性门禁</span><span class="tag outline">逐章过门</span>`;

  const head = pageHead(
    '小说创作',
    'AI 写小说',
    '立项 → 设定集（人物/世界/结局）→ 章纲与伏笔 → 逐章正文。每一章都过 AI 痕迹扫描与 6 道单章门，不过门带诊断重写一轮。',
    tags,
  );

  // 没有书：新建表单 + 已有书目
  if (!b) {
    const shelf = list === null ? '<div class="muted">正在读取书目…</div>'
      : list.length
        ? `<div class="card"><div class="card-head"><div><h2>我的长篇</h2><div class="sub">${list.length} 本</div></div>
            <div class="actions"><button class="btn" data-novelnew>${ICONS.pen}写新的</button></div></div>
            <div class="grid-2">${list.map(shelfCard).join('')}</div></div>`
        : '';
    return head + createForm() + shelf
      + `<div style="margin-top:16px"><div class="empty"><div class="eicon">${ICONS.book}</div><h3>还没有开始写</h3>
        <p>填上书名与一句话故事，点「立项并建书」。之后可以随时回来续写。</p></div></div>`;
  }

  return head
    + `<div class="actions" style="margin-bottom:14px"><button class="btn" data-novelnew>${ICONS.book}返回书目 / 写新的</button></div>`
    + workbench(b);
}

/* ================= 运行器 ================= */
function needlive(r) {
  return r?.llm?.mode && r.llm.mode !== 'live';
}

export const runners = {
  async novelCreate() {
    const c = cfg();
    if (!String(c.novelTitle || '').trim()) return toast('先起一个书名', 'warn');
    const r = await api.novelCreate({
      title: String(c.novelTitle).trim(),
      genre: c.novelGenre,
      logline: c.novelLogline,
      audience: c.novelAudience,
      tone: c.novelTone,
      forbidden: c.novelForbidden,
      targetWords: Number(c.novelTarget) || 200000,
      wordsPerChapter: Number(c.novelPer) || 3000,
    });
    state.data.novel = { ...(state.data.novel ?? {}), book: r.book, gates: r.gates, readiness: r.readiness };
    toast(`《${r.book.title}》创建好了，下一步生成设定集`);
  },

  async novelBible() {
    const b = book();
    if (!b) return toast('先选一本书', 'warn');
    const r = await api.novelBible(b.id);
    state.data.novel = { ...(state.data.novel ?? {}), book: { ...b, bible: r.bible }, gates: r.gates };
    const failed = r.gates.filter((g) => !g.ok).length;
    toast(failed ? `设定集已生成，还有 ${failed} 道设定门没过` : '设定集完成，8 道设定门全过', failed ? 'warn' : 'ok');
  },

  async novelOutline() {
    const b = book();
    if (!b) return toast('先选一本书', 'warn');
    if (!b.bible) return toast('先出设定集：没有人物就没有冲突', 'warn');
    const r = await api.novelOutline(b.id);
    state.data.novel = { ...(state.data.novel ?? {}), book: { ...b, outline: r.outline }, gates: r.gates };
    toast(`排了 ${r.outline.chapters.length} 章`);
  },

  async novelWrite(index) {
    const b = book();
    if (!b) return toast('先选一本书', 'warn');
    const r = await api.novelChapter(b.id, index);
    const ch = r.chapter;
    // 记忆与伏笔状态由服务端算好，这里整本刷新一次，避免前端自己拼错
    const full = await api.novel(b.id);
    state.data.novel = {
      ...(state.data.novel ?? {}),
      book: full.book,
      gates: full.gates,
      readiness: full.readiness,
      advisories: r.advisories ?? [],
    };
    if (ch.ok) toast(`第 ${index} 章写完，6 道门全过（AI 痕迹 ${ch.scan?.score}）`);
    else toast(`第 ${index} 章已保存，但有门没过：${ch.error}`, 'warn', 4000);
  },
};

/** 人工确认某条伏笔已回收 */
export async function confirmFore(id, fid) {
  await api.novelForeshadow(id, fid);
  await openBook(id);
  toast(`${fid} 已标记为回收`);
}

/** 打开一本书：拉完整详情（书 + 设定门 + 就绪度） */
export async function openBook(id) {
  const r = await api.novel(id);
  state.data.novel = { ...(state.data.novel ?? {}), book: r.book, gates: r.gates, readiness: r.readiness };
}

/** 导出全书 markdown */
export async function exportBook(id) {
  const r = await api.novelExport(id);
  download(r.filename, r.text);
  toast(`已导出 ${r.chapters} 章 / ${r.words} 字`);
}

/** 返回书目（重新拉列表，看得到刚建的书） */
export async function backToShelf() {
  const r = await api.novels();
  state.data.novel = { list: r.items, book: null, gates: [], readiness: null };
}
