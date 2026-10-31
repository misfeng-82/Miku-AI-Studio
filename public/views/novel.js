/* 视图域：小说写作台（左章节 / 中正文 / 右设定与记忆）
 *
 * 照墨笔「写作台」的骨架重做：
 *   - 写的是你自己的稿子，模型只在「续写 / 起草」时介入
 *   - 左侧章节列表点一下就切章；正文直接编辑，停手自动保存
 *   - 右栏三页签：设定（人物/世界/大纲）、记忆（全书脉络）、本章（字数与 AI 痕迹）
 */
import { state, api, esc, ICONS, busyBtn, toast, copyText, download } from '../core.js';

const AI_PRESETS = [
  { k: 'conflict', t: '冲突升级', d: '加大矛盾，让局势更紧张' },
  { k: 'detail', t: '细节渲染', d: '补充环境、动作、心理细节' },
  { k: 'fast', t: '节奏加快', d: '砍掉冗余，推进剧情' },
  { k: 'hook', t: '结尾埋钩', d: '在段落结尾留下悬念' },
  { k: 'calm', t: '压低节奏', d: '收一收，写氛围与关系' },
];

const aiState = () => {
  if (!state.cfg.novelAi) state.cfg.novelAi = { preset: '', instruction: '', ctx: 1, chars: [] };
  return state.cfg.novelAi;
};

const TRACKS = [
  { key: 'web-novel', name: '网文', unit: '章' },
  { key: 'short', name: '短篇', unit: '节' },
  { key: 'screenplay', name: '剧本', unit: '场' },
];

const book = () => state.data.novel?.book ?? null;
const chapters = () => [...(book()?.chapters ?? [])].sort((a, b) => a.index - b.index);
const active = () => {
  const b = book();
  if (!b) return null;
  const sel = state.data.novel?.activeId;
  return (b.chapters ?? []).find((c) => c.id === sel) ?? (b.chapters ?? [])[(b.chapters ?? []).length - 1] ?? null;
};

/* ================= 书目 ================= */
function shelfCard(b) {
  const track = TRACKS.find((t) => t.key === b.track) ?? TRACKS[0];
  return `<div class="card card-tight" style="position:relative">
    <button data-novelopen="${b.id}" style="position:absolute;inset:0;border:0;background:transparent;cursor:pointer" aria-label="打开《${esc(b.title)}》"></button>
    <div style="display:flex;justify-content:space-between;gap:10px;position:relative;pointer-events:none">
      <div style="min-width:0">
        <div style="font-size:13px;font-weight:700;line-height:1.4">${esc(b.title)}</div>
        <div class="muted" style="font-size:10.5px;margin-top:3px">${esc(track.name)}${b.genre ? ` · ${esc(b.genre)}` : ''} · ${b.written}/${b.chapters} ${track.unit}</div>
      </div>
      <span class="tag ${b.words ? 'teal' : 'outline'}">${b.words} 字</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;position:relative">
      <span class="muted" style="font-size:10px;pointer-events:none">${esc(b.lastChapter || '还没开始写')}</span>
      <button class="btn btn-sm btn-danger" data-noveldelete="${b.id}" data-novelname="${esc(b.title)}">删除</button>
    </div>
  </div>`;
}

function createForm() {
  const c = state.cfg;
  return `<div class="card">
    <div class="card-head"><div><h2>新建作品</h2><div class="sub">先起个名就能开写；设定、大纲、目标字数都可以之后再补</div></div></div>
    <div class="form-2">
      <label class="field"><span class="fl">书名</span>
        <input type="text" data-cfg="novelTitle" value="${esc(c.novelTitle)}" placeholder="如：渡口灯" /></label>
      <div class="field"><span class="fl">轨道</span>
        <div class="chip-row">${TRACKS.map((t) => `<button class="chip ${c.novelTrack === t.key ? 'active' : ''}" data-noveltrack="${t.key}">${t.name}</button>`).join('')}</div>
      </div>
    </div>
    <div class="form-2" style="margin-top:12px">
      <label class="field"><span class="fl">题材（可空）</span>
        <input type="text" data-cfg="novelGenre" value="${esc(c.novelGenre)}" placeholder="如：悬疑" /></label>
      <label class="field"><span class="fl">目标字数（可空）</span>
        <input type="number" min="1000" step="10000" data-cfg="novelTarget" value="${esc(c.novelTarget)}" placeholder="200000" /></label>
    </div>
    <label class="field" style="margin-top:12px"><span class="fl">一句话故事（可空）</span>
      <textarea rows="2" data-cfg="novelPremise" placeholder="所有人都说那场船难是意外，只有他记得江上一盏没熄的灯。">${esc(c.novelPremise)}</textarea></label>
    <div class="actions" style="margin-top:14px">${busyBtn('novelCreate', '建书并开写', 'book')}</div>
  </div>`;
}

/* ================= 工作台 ================= */
function chapterItem(c, on) {
  return `<div class="wb-ch ${on ? 'is-on' : ''}" data-novelspick="${esc(c.id)}">
    <div style="min-width:0;flex:1">
      <div class="wb-ch-t">第${c.index}章 ${esc(c.title || '')}</div>
      <div class="wb-ch-m">${c.words ?? 0} 字</div>
    </div>
    <button class="wb-ch-x" data-noveldelch="${esc(c.id)}" title="删除这一章">×</button>
  </div>`;
}

function settingsPanel(b) {
  const s = b.settings ?? {};
  return `<div class="card card-tight">
    <div class="fl" style="margin-bottom:8px">一句话故事</div>
    <textarea rows="3" data-novelsetting="premise" placeholder="这本书一句话讲什么">${esc(s.premise ?? '')}</textarea>

    <div class="fl" style="margin:14px 0 8px">人物（${(s.characters ?? []).length}）</div>
    <div class="rows">${(s.characters ?? []).map((c) => `<div class="row" style="grid-template-columns:1fr">
      <div><div class="row-title" style="font-size:11.5px">${esc(c.name)}${c.role ? ` <span class="tag outline">${esc(c.role)}</span>` : ''}</div>
      <div class="row-sub">要 ${esc(c.want || '—')} · 缺 ${esc(c.flaw || '—')}${c.voice ? ` · 说话 ${esc(c.voice)}` : ''}</div></div>
    </div>`).join('') || '<div class="muted" style="font-size:11px">还没有人物。可以在这里补，也可以先写正文。</div>'}</div>
    <input type="text" data-novelcast placeholder="名字｜身份｜他要什么｜缺什么（回车添加）" style="margin-top:8px" />

    <div class="fl" style="margin:14px 0 8px">世界规则（${(s.world ?? []).length}）</div>
    <div class="rows">${(s.world ?? []).map((w) => `<div class="row" style="grid-template-columns:1fr">
      <div><div class="row-title" style="font-size:11.5px">${esc(w.rule)}</div>
      ${w.cost ? `<div class="row-sub">代价：${esc(w.cost)}</div>` : ''}</div></div>`).join('') || '<div class="muted" style="font-size:11px">还没有世界规则。</div>'}</div>
    <input type="text" data-novelworld placeholder="规则｜代价（回车添加）" style="margin-top:8px" />

    <div class="fl" style="margin:14px 0 8px">大纲（${(s.outline ?? []).length} 条）</div>
    <div class="rows">${(s.outline ?? []).slice(0, 30).map((o) => `<div class="row" style="grid-template-columns:34px 1fr">
      <div class="muted mono" style="font-size:10px">${o.index}</div>
      <div style="font-size:11.5px">${esc(o.title || '')}${o.goal ? `<span class="muted"> · ${esc(o.goal)}</span>` : ''}</div>
    </div>`).join('') || '<div class="muted" style="font-size:11px">还没有大纲。写作台不强制大纲，想列再列。</div>'}</div>
  </div>`;
}

function memoryPanel(b) {
  const m = b.memory;
  if (!m?.writtenChapters) {
    return `<div class="card card-tight"><div class="fl" style="margin-bottom:6px">全局记忆</div>
      <div class="muted" style="font-size:11px;line-height:1.7">写完并保存后自动提炼：全书脉络、出场人物、地点、伏笔、时间线。纯本机规则，不花额度。</div></div>`;
  }
  return `<div class="card card-tight">
    <div class="fl" style="margin-bottom:8px">全书脉络（${m.writtenChapters} 章 / ${m.totalChars} 字）</div>
    <div class="rows" style="max-height:260px;overflow:auto">${m.arc.slice(-12).map((a) => `<div class="row" style="grid-template-columns:44px 1fr">
      <div class="muted mono" style="font-size:10px">第${a.no}章</div>
      <div style="font-size:11px">${esc(a.point || '—')}</div>
    </div>`).join('')}</div>
    <div class="fl" style="margin:12px 0 6px">已出场人物</div>
    <div class="chip-row">${(m.characters ?? []).map((n) => `<span class="chip static">${esc(n)}</span>`).join('') || '<span class="muted" style="font-size:11px">（无）</span>'}</div>
    <div class="fl" style="margin:12px 0 6px">已出现地点</div>
    <div class="chip-row">${(m.places ?? []).map((n) => `<span class="chip static">${esc(n)}</span>`).join('') || '<span class="muted" style="font-size:11px">（无）</span>'}</div>
    ${(m.timeline ?? []).length ? `<div class="fl" style="margin:12px 0 6px">时间线</div>
      <div class="chip-row">${m.timeline.slice(-6).map((t) => `<span class="chip static">第${t.no}章：${esc(t.t)}</span>`).join('')}</div>` : ''}
  </div>`;
}

/**
 * AI 续写面板（对应墨笔的右侧「AI 续写」页签）
 * 续写要求预设 + 具体要求 + 关联前几章 + 指定角色；参数随请求发给服务端。
 */
function aiPanel(b, ch) {
  const ai = aiState();
  const cast = b.settings?.characters ?? [];
  const written = (b.chapters ?? []).filter((c) => c.text).length;

  return `<div class="card card-tight">
    <div class="fl" style="margin-bottom:8px">写到哪儿</div>
    <div class="chip-row">
      <button class="chip active" data-novelcompose="continue">续写当前章</button>
      <button class="chip" data-novelcompose="next">写下一章</button>
    </div>

    <div class="fl" style="margin:14px 0 8px">续写要求</div>
    <div class="chip-row">
      ${AI_PRESETS.map((p) => `<button class="chip ${ai.preset === p.k ? 'active' : ''}" data-aipreset="${p.k}" title="${esc(p.d)}">${esc(p.t)}</button>`).join('')}
    </div>
    <textarea rows="3" data-novelai="instruction" placeholder="具体要求：要发生什么、不能出现什么、语气与节奏……" style="margin-top:8px">${esc(ai.instruction)}</textarea>

    <div class="fl" style="margin:14px 0 8px">关联前文</div>
    <div class="chip-row">
      ${[0, 1, 3, 5].map((n) => `<button class="chip ${Number(ai.ctx) === n ? 'active' : ''}" data-aictx="${n}" ${n > written ? 'disabled title="前面还没有这么多章"' : ''}>${n === 0 ? '不关联' : `最近 ${n} 章`}</button>`).join('')}
    </div>

    ${cast.length ? `<div class="fl" style="margin:14px 0 8px">提及角色</div>
      <div class="chip-row">${cast.map((c) => `<button class="chip ${(ai.chars ?? []).includes(c.name) ? 'active' : ''}" data-aichar="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>
      <div class="muted" style="font-size:10px;margin-top:6px">点亮只把该角色设定发给模型；不点亮则发全部人物。</div>` : ''}

    <div class="actions" style="margin-top:14px">${busyBtn('novelCompose', '开始 AI 续写', 'wand')}</div>
    <div class="muted" style="font-size:10px;margin-top:6px">续写接在正文末尾；起草只对空章生效。</div>
  </div>`;
}

/** 时光机：AI 覆盖前留的版本，可还原 */
function historyPanel(ch) {
  const hist = [...(ch?.history ?? [])].reverse();
  if (!hist.length) {
    return `<div class="card card-tight"><div class="fl" style="margin-bottom:6px">时光机</div>
      <div class="muted" style="font-size:11px;line-height:1.7">AI 续写 / 起草 / 整理排版之前会自动留一份快照，这里可以看到并还原。</div></div>`;
  }
  return `<div class="card card-tight">
    <div class="fl" style="margin-bottom:8px">时光机（${hist.length} 个版本）</div>
    <div class="rows" style="max-height:240px;overflow:auto">${hist.map((h) => `<div class="row" style="grid-template-columns:1fr auto;align-items:center">
      <div style="min-width:0">
        <div class="row-title" style="font-size:11px">${esc(new Date(h.ts).toLocaleString('zh-CN', { hour12: false }))}</div>
        <div class="row-sub">${h.label ? esc(h.label) : '手动版本'} · ${(h.text || '').replace(/\s/g, '').length} 字符</div>
      </div>
      <button class="btn btn-sm" data-novelrestore="${h.ts}">还原</button>
    </div>`).join('')}</div>
  </div>`;
}

function chapterPanel(ch) {
  const rep = state.data.novel?.scan?.report;
  if (!ch) return '';
  return `<div class="card card-tight">
    <div class="fl" style="margin-bottom:8px">本章数据</div>
    <div class="chip-row">
      <span class="tag blue">${ch.words ?? 0} 字</span>
      ${rep?.ok ? `<span class="tag ${rep.score <= 40 ? 'teal' : rep.score <= 55 ? 'amber' : 'rose'}">AI 痕迹 ${rep.score}</span>` : ''}
      ${(ch.tidy ?? []).length ? `<span class="tag outline">排版清理 ${ch.tidy.length}</span>` : ''}
    </div>
    ${rep?.ok ? `<div style="margin-top:10px">${rep.dimensions.slice(0, 6).map((d) => `<div class="bar-row">
      <span class="bl">${esc(d.label)}</span>
      <div class="bar-track"><span class="bar-fill ${d.penalty >= 0.7 ? 'rose' : d.penalty >= 0.35 ? 'amber' : 'teal'}" style="width:${Math.round(d.penalty * 100)}%"></span></div>
      <span class="bv">${d.penalty.toFixed(2)}</span></div>`).join('')}</div>` : '<div class="muted" style="font-size:11px;margin-top:8px">点工具栏「扫本章」看 13 维 AI 痕迹。</div>'}
  </div>
  ${historyPanel(ch)}`;
}

function workbench(b) {
  const ch = active();
  const list = chapters();
  const panel = state.data.novel?.panel ?? 'settings';
  const words = list.reduce((n, c) => n + (c.words ?? 0), 0);
  const saving = state.data.novel?.saving;

  return `
  <div class="card wb-shell">
    <div class="wb-topbar">
      <button class="btn btn-sm" data-novelnew>${ICONS.arrow}书目</button>
      <input class="wb-title-in" data-noveltitle value="${esc(b.title)}" placeholder="未命名作品" />
      <span class="muted" style="font-size:10.5px">${list.length} 章 · ${words} 字</span>
      <span style="flex:1"></span>
      <span class="wb-save ${saving ? 'is-on' : ''}">${saving ? '保存中…' : '已保存'}</span>
      <button class="btn btn-sm" data-novelexport="${b.id}">${ICONS.download}导出全书</button>
    </div>

    <div class="wb-grid">
      <aside class="wb-side">
        <div class="wb-side-head">
          <span class="fl">章节</span>
          <button class="btn btn-sm" data-noveladdch>+ 新建</button>
        </div>
        <div class="wb-chlist">${list.map((c) => chapterItem(c, ch && c.id === ch.id)).join('') || '<div class="muted" style="font-size:11px;padding:8px">还没有章节，点「+ 新建」。</div>'}</div>
      </aside>

      <main class="wb-main">
        ${ch ? `
        <div class="wb-ch-head">
          <input class="wb-ch-title" data-novelchtitle value="${esc(ch.title || '')}" placeholder="章节标题" />
          <span class="muted" style="font-size:10.5px">${ch.words ?? 0} 字</span>
        </div>
        <textarea class="wb-editor" data-noveltext spellcheck="false" placeholder="在这里写正文。停手会自动保存；也可以点「续写」让模型接着写。">${esc(ch.text ?? '')}</textarea>
        <div class="wb-tools">
          ${busyBtn('novelCompose', '续写', 'pen')}
          ${busyBtn('novelDraft', '起草本章', 'spark')}
          ${busyBtn('novelScan', '扫本章（免费）', 'radar')}
          <button class="btn" data-noveltidy title="清 Markdown 符号 + 统一中文标点 + 智能排版（本地，不花钱）">${ICONS.wand}整理排版</button>
          <button class="btn" data-novelcopych>${ICONS.copy}复制本章</button>
          <button class="btn" data-novelsave>${ICONS.check}保存</button>
          <span class="muted" style="font-size:10.5px;margin-left:auto">续写接在正文末尾，不覆盖你写的</span>
        </div>` : `<div class="empty"><div class="eicon">${ICONS.doc}</div><h3>还没有章节</h3><p>点左侧「+ 新建」开第一章。</p></div>`}
      </main>

      <aside class="wb-right">
        <div class="wb-tabs">
          ${[['settings', '设定'], ['ai', '续写'], ['memory', '记忆'], ['chapter', '本章']].map(([k, n]) =>
            `<button class="wb-tab ${panel === k ? 'is-on' : ''}" data-novelpanel="${k}">${n}</button>`).join('')}
        </div>
        <div class="wb-panel">
          ${panel === 'settings' ? settingsPanel(b)
    : panel === 'ai' ? aiPanel(b, ch)
      : panel === 'memory' ? memoryPanel(b) : chapterPanel(ch)}
        </div>
      </aside>
    </div>
  </div>`;
}

export function viewNovel() {
  const b = book();
  const tags = `<span class="tag purple">写作台</span><span class="tag teal">自动保存</span><span class="tag outline">模型只在你叫它时才介入</span>`;
  const head = `<div class="page-head"><div class="ph-kicker">${tags}<span class="tag outline">小说创作</span></div>
    <h1>AI 写小说</h1>
    <p>左边选章、中间写正文、右边看设定与记忆。正文停手自动保存；需要时点「续写」让模型接着写。</p></div>`;

  if (!b) {
    const list = state.data.novel?.list;
    const shelf = list === null || list === undefined ? '<div class="muted">正在读取书目…</div>'
      : list.length
        ? `<div class="card"><div class="card-head"><div><h2>我的作品</h2><div class="sub">${list.length} 本</div></div></div>
            <div class="grid-2">${list.map(shelfCard).join('')}</div></div>`
        : '';
    return head + createForm() + shelf;
  }
  return head + workbench(b);
}

/* ================= 运行器 ================= */
const cur = () => active();

export const runners = {
  async novelCreate() {
    const c = state.cfg;
    if (!String(c.novelTitle || '').trim()) return toast('先起个书名', 'warn');
    const r = await api.novelCreate({
      title: String(c.novelTitle).trim(),
      track: c.novelTrack || 'web-novel',
      genre: c.novelGenre || '',
      premise: c.novelPremise || '',
      targetWords: Number(c.novelTarget) || 200000,
    });
    const ch = await api.novelAddChapter(r.book.id, { title: '第1章' });
    const full = await api.novel(r.book.id);
    state.data.novel = { ...(state.data.novel ?? {}), book: full.book, activeId: ch.chapter.id, panel: 'settings', list: null, scan: null };
    toast(`《${r.book.title}》建好了，直接写第一章`);
  },

  async novelCompose() {
    const b = book(); const ch = cur();
    if (!b || !ch) return toast('先选一章', 'warn');
    const ai = aiState();
    const r = await api.novelCompose(b.id, ch.id, {
      mode: 'continue', words: 1200,
      instruction: ai.instruction || '', preset: ai.preset || '',
      ctx: Number(ai.ctx) || 0, chars: ai.chars ?? [],
    });
    state.data.novel = {
      ...(state.data.novel ?? {}),
      book: { ...b, chapters: b.chapters.map((x) => (x.id === r.chapter.id ? r.chapter : x)), memory: r.memory },
    };
    toast(`续写完成：+${r.chapter.words - (ch.words ?? 0)} 字`);
  },

  async novelDraft() {
    const b = book(); const ch = cur();
    if (!b || !ch) return toast('先选一章', 'warn');
    if (String(ch.text || '').trim()) return toast('这一章已有正文：用「续写」接着写；要重写先清空', 'warn');
    const ai = aiState();
    const r = await api.novelCompose(b.id, ch.id, {
      mode: 'draft', words: 1200,
      instruction: ai.instruction || '', preset: ai.preset || '', ctx: Number(ai.ctx) || 0,
    });
    state.data.novel = {
      ...(state.data.novel ?? {}),
      book: { ...b, chapters: b.chapters.map((x) => (x.id === r.chapter.id ? r.chapter : x)), memory: r.memory },
    };
    toast(`起草完成：${r.chapter.words} 字`);
  },

  async novelScan() {
    const b = book(); const ch = cur();
    if (!b || !ch) return toast('先选一章', 'warn');
    const r = await api.novelScan(b.id, ch.id);
    state.data.novel = { ...(state.data.novel ?? {}), scan: r, panel: 'chapter' };
    toast(r.report?.ok ? `AI 痕迹 ${r.report.score}（${r.report.grade}）` : '这一章还没有正文');
  },
};

/* ================= 供 app.js 调用的动作 ================= */

export async function openBook(id) {
  const r = await api.novel(id);
  const list = [...(r.book.chapters ?? [])].sort((a, b) => a.index - b.index);
  state.data.novel = {
    ...(state.data.novel ?? {}),
    book: r.book,
    activeId: list.length ? list[list.length - 1].id : null,
    panel: state.data.novel?.panel ?? 'settings',
    scan: null,
  };
}

export async function backToShelf() {
  const r = await api.novels();
  state.data.novel = { list: r.items, book: null, activeId: null, panel: 'settings', scan: null };
}

export async function selectChapter(id) {
  if (!book()) return;
  state.data.novel = { ...(state.data.novel ?? {}), activeId: id, scan: null };
}

export async function addChapter() {
  const b = book();
  if (!b) return;
  const r = await api.novelAddChapter(b.id, {});
  const full = await api.novel(b.id);
  state.data.novel = { ...(state.data.novel ?? {}), book: full.book, activeId: r.chapter.id, scan: null };
  toast(`新建第 ${r.chapter.index} 章`);
}

export async function deleteChapter(id) {
  const b = book();
  if (!b) return;
  // 确认由界面的两步按钮负责（iframe 里 window.confirm 会被拦掉）
  await api.novelDeleteChapter(b.id, id);
  const full = await api.novel(b.id);
  state.data.novel = { ...(state.data.novel ?? {}), book: full.book, activeId: full.book.chapters.at(-1)?.id ?? null, scan: null };
  toast('已删除');
}

/**
 * 存稿。正文输入停手 800ms 自动调；切章/点保存也会调。
 */
export async function saveActive({ text, title } = {}) {
  const b = book(); const ch = cur();
  if (!b || !ch) return;
  const payload = {};
  if (text !== undefined) payload.text = text;
  if (title !== undefined) payload.title = title;
  if (!Object.keys(payload).length) return;

  state.data.novel = { ...(state.data.novel ?? {}), saving: true };
  try {
    const r = await api.novelSaveChapter(b.id, ch.id, payload);
    state.data.novel = {
      ...(state.data.novel ?? {}),
      saving: false,
      book: {
        ...b,
        chapters: b.chapters.map((x) => (x.id === r.chapter.id ? r.chapter : x)),
        memory: r.memory,
      },
    };
  } catch (e) {
    state.data.novel = { ...(state.data.novel ?? {}), saving: false };
    toast(`保存失败：${e.message}`, 'err');
  }
}

export async function setPanel(k) {
  state.data.novel = { ...(state.data.novel ?? {}), panel: k };
}

export async function setSetting(field, value) {
  const b = book();
  if (!b) return;
  const settings = { ...(b.settings ?? {}), [field]: value };
  await api.novelPatch(b.id, { settings });
  state.data.novel = { ...(state.data.novel ?? {}), book: { ...b, settings } };
}

export async function addCast(line) {
  const b = book();
  if (!b) return;
  const [name, role, want, flaw] = String(line).split('｜').map((x) => x.trim());
  if (!name) return toast('至少给我一个名字', 'warn');
  const characters = [...(b.settings?.characters ?? []), { name, role: role || '', want: want || '', flaw: flaw || '', voice: '' }];
  await setSetting('characters', characters);
  toast(`已加入人物：${name}`);
}

export async function addWorld(line) {
  const b = book();
  if (!b) return;
  const [rule, cost] = String(line).split('｜').map((x) => x.trim());
  if (!rule) return toast('规则不能为空', 'warn');
  const world = [...(b.settings?.world ?? []), { rule, cost: cost || '', bound: '' }];
  await setSetting('world', world);
  toast('已加入世界规则');
}

export async function setTitle(title) {
  const b = book();
  if (!b) return;
  await api.novelPatch(b.id, { title });
  state.data.novel = { ...(state.data.novel ?? {}), book: { ...b, title } };
}

export async function deleteBook(id, title) {
  // 确认由两步按钮负责；这里只管执行
  await api.novelDelete(id);
  await backToShelf();
  toast(`已移除《${title}》`);
  return true;
}

/** 一键整理（服务端做，纯本地） */
export async function tidyChapter() {
  const b = book(); const ch = cur();
  if (!b || !ch) return;
  if (!(ch.text ?? '').trim()) return toast('这一章还没有正文', 'warn');
  const r = await api.novelTidy(b.id, ch.id);
  if (!r.changed) return toast('排版已经很整齐，没有可改的');
  state.data.novel = { ...(state.data.novel ?? {}), book: { ...b, chapters: b.chapters.map((x) => (x.id === r.chapter.id ? r.chapter : x)) } };
  toast('已整理：清 Markdown、统一标点、重排段落');
}

/** 还原到某个历史版本 */
export async function restoreChapter(ts) {
  const b = book(); const ch = cur();
  if (!b || !ch) return;
  const r = await api.novelRestore(b.id, ch.id, ts);
  state.data.novel = { ...(state.data.novel ?? {}), book: { ...b, chapters: b.chapters.map((x) => (x.id === r.chapter.id ? r.chapter : x)) } };
  toast('已还原');
}

/** 写下一章：建章 + 起草一气呵成 */
export async function composeNext() {
  const b = book();
  if (!b) return;
  const added = await api.novelAddChapter(b.id, {});
  const ai = aiState();
  const r = await api.novelCompose(b.id, added.chapter.id, {
    mode: 'draft', words: 1200,
    instruction: ai.instruction || '', preset: ai.preset || '', ctx: Number(ai.ctx) || 0,
  });
  const full = await api.novel(b.id);
  state.data.novel = { ...(state.data.novel ?? {}), book: full.book, activeId: r.chapter.id, panel: 'ai' };
  toast(`第 ${r.chapter.index} 章起草完成：${r.chapter.words} 字`);
}

export async function copyChapterText() {
  const ch = cur();
  if (!ch?.text) return toast('这一章还没有正文', 'warn');
  await copyText(ch.text, `已复制第 ${ch.index} 章（${ch.words} 字）`);
}

export async function exportBook(id) {
  const r = await api.novelExport(id);
  download(r.filename, r.text);
  toast(`已导出 ${r.chapters} 章 / ${r.words} 字`);
}
