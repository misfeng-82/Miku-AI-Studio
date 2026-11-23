/* 云端桥：画布持久化 / 资产库 / 生成历史
 *
 * 对标即梦短剧画布的三件套：
 *   资产库 —— 生成结果落盘成永久文件，能跨画布复用（不再是 24 小时就烂的临时链）
 *   生成历史 —— 每次生成都留档，节点删了也能从历史找回
 *   多画布 —— 一个项目一个画布，随时切
 *
 * 和主程序之间只走 window 事件，避免循环 import：
 *   canvas:place-asset  { asset }      把资产铺到画布上
 *   canvas:focus-node   { id }         定位到某个节点
 *   canvas:reload       无            切换到别的画布后重绘
 */

import * as S from './store.js';

const api = async (path, { method = 'GET', body } = {}) => {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
  return json;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const ago = (iso) => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const d = Date.now() - t;
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`;
  return `${Math.floor(d / 86400e3)} 天前`;
};

const KIND_LABEL = { image: '图片', video: '视频', audio: '音频', text: '文本', file: '文件' };
const KIND_COLOR = { image: '#3B82F6', video: '#8B5CF6', audio: '#F59E0B', text: '#10B981', file: '#6B7280' };

/* ---------------- 画布列表 ---------------- */

let canvases = [];
let currentId = '';

export function getCanvases() { return canvases; }

async function fetchCanvases() {
  const r = await api('api/canvases');
  canvases = r.canvases || [];
  return canvases;
}

/** 启动：优先打开上次的画布；首次运行把浏览器里已有的画布迁到后端 */
export async function boot() {
  try {
    await fetchCanvases();
  } catch {
    canvases = [];
  }

  const saved = S.getCanvasId();
  const target = (saved && canvases.find((c) => c.id === saved)) || canvases[0];

  if (target) {
    try {
      const doc = await api(`api/canvases/${target.id}`);
      S.hydrate(doc);
      currentId = doc.id;
    } catch (e) {
      console.warn('[cloud] 读取画布失败：', e.message);
    }
  } else {
    // 后端还没有画布：把当前浏览器里的内容整份迁上去
    try {
      const created = await api('api/canvases', {
        method: 'POST',
        body: { name: S.get().name || '未命名画布' },
      });
      S.setCanvasId(created.id);
      currentId = created.id;
      const st = S.get();
      await api(`api/canvases/${created.id}`, {
        method: 'PUT',
        body: { name: st.name, view: st.view, nodes: st.nodes, edges: st.edges },
      });
      canvases = [created];
    } catch (e) {
      console.warn('[cloud] 建画布失败，本次先离线用：', e.message);
    }
  }

  renderCanvasBtn();
}

export function renderCanvasBtn() {
  const btn = document.querySelector('#btnCanvases');
  if (!btn) return;
  const cur = canvases.find((c) => c.id === currentId);
  const name = S.get().name || cur?.name || '画布';
  btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 10h16"/></svg><span class="cv-name">${esc(name)}</span>`;
  btn.title = `切换 / 新建画布（共 ${canvases.length} 个）`;
}

export async function switchCanvas(id) {
  if (!id || id === currentId) return;
  try {
    const doc = await api(`api/canvases/${id}`);
    S.hydrate(doc);
    currentId = id;
    renderCanvasBtn();
    window.dispatchEvent(new CustomEvent('canvas:reload'));
    toastLocal(`已切到「${doc.name}」`);
  } catch (e) {
    toastLocal(`切换失败：${e.message}`);
  }
}

export async function createCanvas(name) {
  try {
    const created = await api('api/canvases', { method: 'POST', body: { name: name || '新画布' } });
    await fetchCanvases();
    await switchCanvas(created.id);
  } catch (e) {
    toastLocal(`新建失败：${e.message}`);
  }
}

export async function renameCanvas(id, name) {
  try {
    await api(`api/canvases/${id}`, { method: 'PUT', body: { name } });
    await fetchCanvases();
    renderCanvasBtn();
    renderCanvasPicker();
    toastLocal('已改名');
  } catch (e) {
    toastLocal(`改名失败：${e.message}`);
  }
}

export async function removeCanvas(id) {
  if (canvases.length <= 1) { toastLocal('至少留一个画布'); return; }
  try {
    await api(`api/canvases/${id}`, { method: 'DELETE' });
    await fetchCanvases();
    if (id === currentId) await switchCanvas(canvases[0]?.id);
    renderCanvasPicker();
    toastLocal('画布已删除');
  } catch (e) {
    toastLocal(`删除失败：${e.message}`);
  }
}

/* ---- 画布选择浮层 ---- */

function overlay() {
  let m = document.querySelector('#cvPicker');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'cvPicker';
  m.className = 'cv-mask';
  m.innerHTML = '<div class="cv-box" id="cvBox"></div>';
  m.addEventListener('mousedown', (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  return m;
}

export async function openCanvasPicker() {
  overlay();
  await fetchCanvases().catch(() => {});
  renderCanvasPicker();
}

async function renderCanvasPicker() {
  const box = document.querySelector('#cvBox');
  if (!box) return;
  if (!canvases.length) {
    try { await fetchCanvases(); } catch { /* ignore */ }
  }
  box.innerHTML = `
    <div class="cv-head">
      <span>我的画布</span>
      <button class="cv-x" id="cvClose">✕</button>
    </div>
    <div class="cv-new">
      <input id="cvNewName" placeholder="新画布名称，例如 第3集 · 雨夜追车" />
      <button id="cvNewGo">新建</button>
    </div>
    <div class="cv-list">
      ${canvases.map((c) => `
        <div class="cv-item${c.id === currentId ? ' is-cur' : ''}" data-id="${c.id}">
          <div class="cv-item-main">
            <div class="cv-item-t">${esc(c.name)}</div>
            <div class="cv-item-s">${c.nodeCount ?? 0} 个节点 · ${c.edgeCount ?? 0} 条连线 · ${ago(c.updatedAt)}</div>
          </div>
          <button class="cv-mini" data-ver="${c.id}" title="历史版本">⏱</button>
          <button class="cv-mini" data-rn="${c.id}" title="重命名">✎</button>
          <button class="cv-mini cv-danger" data-rm="${c.id}" title="删除">🗑</button>
        </div>`).join('') || '<div class="cv-empty">还没有画布</div>'}
    </div>
    <div class="cv-foot">画布存在本机后端（canvas/data/canvases），换设备也能接着做</div>`;

  box.querySelector('#cvClose')?.addEventListener('click', () => document.querySelector('#cvPicker')?.remove());
  box.querySelector('#cvNewGo')?.addEventListener('click', async () => {
    const name = box.querySelector('#cvNewName').value.trim();
    if (!name) return toastLocal('先给画布起个名字');
    await createCanvas(name);
    document.querySelector('#cvPicker')?.remove();
  });
  box.querySelectorAll('[data-id]').forEach((row) => {
    row.addEventListener('click', async (e) => {
      if (e.target.closest('[data-rn],[data-rm],[data-ver]')) return;
      await switchCanvas(row.dataset.id);
      document.querySelector('#cvPicker')?.remove();
    });
  });
  box.querySelectorAll('[data-rn]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.rn;
      const cur = canvases.find((c) => c.id === id);
      const name = prompt('画布名称', cur?.name || '');
      if (name && name.trim()) renameCanvas(id, name.trim());
    });
  });
  box.querySelectorAll('[data-rm]').forEach((b) => {
    b.addEventListener('click', () => {
      if (confirm('删除这个画布？节点数据会一起删掉（资产库里的素材不受影响）')) removeCanvas(b.dataset.rm);
    });
  });
  box.querySelectorAll('[data-ver]').forEach((b) => {
    b.addEventListener('click', () => showVersions(b.dataset.ver));
  });
}

/* ---- 历史版本 ---- */

async function showVersions(canvasId) {
  const box = document.querySelector('#cvBox');
  if (!box) return;
  let versions = [];
  try {
    const r = await api(`api/canvases/${canvasId}/versions`);
    versions = r.versions || [];
  } catch (e) {
    toastLocal(`读快照失败：${e.message}`);
    return;
  }

  box.innerHTML = `
    <div class="cv-head">
      <span>历史版本（每 90 秒最多存一份，保留最近 30 份）</span>
      <button class="cv-x" id="verBack">←</button>
    </div>
    <div class="cv-list">
      ${versions.length ? versions.map((v) => `
        <div class="cv-item">
          <div class="cv-item-main">
            <div class="cv-item-t">${new Date(v.ts).toLocaleString('zh-CN')}</div>
            <div class="cv-item-s">${v.nodeCount} 个节点 · ${v.edgeCount} 条连线</div>
          </div>
          <button class="cv-mini" data-restore="${v.ts}" title="恢复到这个版本">↩</button>
        </div>`).join('') : '<div class="cv-empty">还没有快照。画布改几次之后这里就有东西了</div>'}
    </div>
    <div class="cv-foot">恢复会覆盖当前画布内容；恢复前的那一版也会留在快照里，可以再退回来</div>`;

  box.querySelector('#verBack')?.addEventListener('click', () => renderCanvasPicker());
  box.querySelectorAll('[data-restore]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('用这个版本覆盖当前画布？')) return;
      try {
        const doc = await api(`api/canvases/${canvasId}/restore`, {
          method: 'POST',
          body: { ts: Number(b.dataset.restore) },
        });
        if (canvasId === currentId) {
          S.hydrate(doc);
          window.dispatchEvent(new CustomEvent('canvas:reload'));
        }
        document.querySelector('#cvPicker')?.remove();
        toastLocal('已恢复到所选版本');
      } catch (e) {
        toastLocal(`恢复失败：${e.message}`);
      }
    });
  });
}

/* ---------------- 资产库 ---------------- */

let assets = [];
let assetKind = 'all';
let assetQ = '';
let assetBusy = false;
let assetSearchTimer = null;

export async function loadAssets() {
  assetBusy = true;
  try {
    const q = new URLSearchParams({ kind: assetKind, q: assetQ, limit: '200' });
    const r = await api(`api/assets?${q}`);
    assets = r.items || [];
  } catch {
    assets = [];
  } finally {
    assetBusy = false;
  }
  return assets;
}

export function renderAssets(container) {
  const host = container || document.querySelector('#nodeList');
  if (!host) return;
  host.innerHTML = `
    <div class="sk-bar">
      <input class="sk-search" id="assetQ" placeholder="搜素材 / 提示词" value="${esc(assetQ)}" />
      <button class="sk-refresh" id="assetRefresh" title="刷新">⟳</button>
    </div>
    <div class="sk-tabs">
      ${['all', 'image', 'video', 'audio'].map((k) => `
        <button class="sk-tab${assetKind === k ? ' is-on' : ''}" data-kind="${k}">${k === 'all' ? '全部' : KIND_LABEL[k]}</button>`).join('')}
    </div>
    <div class="sk-grid" id="assetGrid"><div class="pempty">读取中…</div></div>`;

  const refresh = async () => {
    await loadAssets();
    paintGrid();
  };

  host.querySelector('#assetQ').addEventListener('input', (e) => {
    assetQ = e.target.value.trim();
    clearTimeout(assetSearchTimer);
    assetSearchTimer = setTimeout(refresh, 300);
  });
  host.querySelector('#assetRefresh').addEventListener('click', refresh);
  host.querySelectorAll('.sk-tab').forEach((b) => {
    b.addEventListener('click', () => {
      assetKind = b.dataset.kind;
      host.querySelectorAll('.sk-tab').forEach((x) => x.classList.toggle('is-on', x === b));
      refresh();
    });
  });

  const paintGrid = () => {
    const grid = host.querySelector('#assetGrid');
    if (!grid) return;
    if (!assets.length) {
      grid.innerHTML = `<div class="pempty">${assetBusy ? '读取中…' : '还没有素材。生成出来的图片和视频会自动存进来'}</div>`;
      return;
    }
    grid.innerHTML = assets.map((a) => `
      <div class="sk-card" data-asset="${a.id}" draggable="true" title="${esc(a.prompt || a.name)}">
        <div class="sk-thumb">
          ${a.kind === 'video'
            ? `<video src="${esc(a.url)}" muted preload="metadata"></video><span class="sk-play">▶</span>`
            : a.kind === 'audio'
              ? `<div class="sk-audio">♪</div>`
              : `<img src="${esc(a.url)}" alt="" loading="lazy" />`}
        </div>
        <div class="sk-meta">
          <div class="sk-name">${esc(a.name)}</div>
          <div class="sk-sub">${KIND_LABEL[a.kind] || ''} · ${Math.round((a.size || 0) / 1024)} KB · ${ago(a.createdAt)}</div>
        </div>
        <div class="sk-ops">
          <button data-place="${a.id}" title="放到画布">＋</button>
          <button data-rmasset="${a.id}" title="删除素材">🗑</button>
        </div>
      </div>`).join('');

    grid.querySelectorAll('[data-place]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = assets.find((x) => x.id === b.dataset.place);
        if (a) window.dispatchEvent(new CustomEvent('canvas:place-asset', { detail: { asset: a } }));
      });
    });
    grid.querySelectorAll('[data-rmasset]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('删除这个素材文件？画布上已放着的节点不会受影响')) return;
        try {
          await api(`api/assets/${b.dataset.rmasset}`, { method: 'DELETE' });
          await refresh();
        } catch (e) { toastLocal(`删除失败：${e.message}`); }
      });
    });
  };

  refresh();
}

/* ---------------- 生成历史 ---------------- */

let history = [];

export async function loadHistory() {
  try {
    const r = await api(`api/history?canvasId=${encodeURIComponent(S.getCanvasId())}&limit=100`);
    history = r.items || [];
  } catch {
    history = [];
  }
  return history;
}

export function renderHistory(container) {
  const host = container || document.querySelector('#nodeList');
  if (!host) return;

  const paint = () => {
    if (!history.length) {
      host.innerHTML = `<div class="pempty">这个画布还没有生成记录。跑过一次之后，这里会留下每一张图、每一条片子</div>`;
      return;
    }
    host.innerHTML = `
      <div class="sk-bar"><span class="sk-hist-t">最近 ${history.length} 条</span>
        <button class="sk-refresh" id="histRefresh" title="刷新">⟳</button></div>
      <div class="sk-hist">
        ${history.map((h) => `
          <div class="sk-hrow" data-hid="${h.id}">
            <div class="sk-hthumb">
              ${h.kind === 'video'
                ? `<video src="${esc(h.assetUrl || h.resultUrl)}" muted preload="metadata"></video>`
                : h.assetUrl || h.resultUrl
                  ? `<img src="${esc(h.assetUrl || h.resultUrl)}" alt="" loading="lazy" />`
                  : `<div class="sk-audio">${KIND_LABEL[h.kind]?.slice(0, 1) || '?'}</div>`}
            </div>
            <div class="sk-hmain">
              <div class="sk-name">${esc(h.nodeTitle || h.prompt || '未命名')}</div>
              <div class="sk-sub">${KIND_LABEL[h.kind] || ''} · ${ago(h.createdAt)}${h.nodeId ? '' : ' · 节点已删'}</div>
            </div>
            <div class="sk-ops">
              ${h.nodeId ? `<button data-goto="${esc(h.nodeId)}" title="定位到节点">◎</button>` : ''}
              <button data-readd="${esc(h.assetUrl || h.resultUrl)}" title="重新放到画布">＋</button>
            </div>
          </div>`).join('')}
      </div>`;

    host.querySelector('#histRefresh')?.addEventListener('click', async () => { await loadHistory(); paint(); });
    host.querySelectorAll('[data-goto]').forEach((b) => {
      b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('canvas:focus-node', { detail: { id: b.dataset.goto } })));
    });
    host.querySelectorAll('[data-readd]').forEach((b) => {
      b.addEventListener('click', () => {
        const url = b.dataset.readd;
        const row = history.find((h) => (h.assetUrl || h.resultUrl) === url);
        window.dispatchEvent(new CustomEvent('canvas:place-asset', {
          detail: {
            asset: {
              id: `hist_${row?.id || Date.now()}`,
              url,
              kind: row?.kind || 'image',
              name: row?.nodeTitle || '历史结果',
              prompt: row?.prompt || '',
            },
          },
        }));
      });
    });
  };

  host.innerHTML = '<div class="pempty">读取中…</div>';
  loadHistory().then(paint);
}

/* ---------------- 生成结果入档 ---------------- */

/**
 * 生成成功时调用：先把远程结果转存成本地资产，再记一条历史。
 * 转存成功会返回 { url: 'assets/xxx' }，主程序把节点的 result.local 填上，
 * 之后就算上游链接过期，画布上也不会变成裂图。
 */
export async function recordResult({ nodeId, nodeTitle, kind, prompt, params, url }) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  let asset = null;
  try {
    asset = await api('api/assets', {
      method: 'POST',
      body: {
        url,
        kind,
        prompt,
        params,
        name: nodeTitle || '生成结果',
        canvasId: S.getCanvasId(),
        nodeId,
        nodeTitle,
      },
    });
  } catch (e) {
    console.warn('[cloud] 结果转存失败：', e.message);
  }
  try {
    await api('api/history', {
      method: 'POST',
      body: {
        canvasId: S.getCanvasId(),
        nodeId,
        nodeTitle,
        kind,
        prompt,
        params,
        resultUrl: url,
        assetUrl: asset?.url || '',
      },
    });
  } catch { /* 历史失败不影响主流程 */ }
  return asset;
}

/* ---------------- 提示 ---------------- */

function toastLocal(msg) {
  const t = document.querySelector('#tips');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastLocal._t);
  toastLocal._t = setTimeout(() => t.classList.remove('is-on'), 1900);
}
