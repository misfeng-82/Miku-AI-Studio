/* 无限画布 · 装配层
 *
 * 负责：视口（平移缩放）、节点渲染与同步、连线、手势状态机、
 *      左侧面板、小地图、工具栏、运行模拟。
 * 数据全部走 store，UI 永远从 state 渲染，不各自持有副本。
 */
import {
  get, subscribe, commit, touch, mark, undo, redo, canUndo, canRedo,
  uid, addNode, updateNode, removeNode, moveNode, addEdge, removeEdge,
  setView, setName, saveNow,
} from './store.js';
import { TYPES, defaultNode, nodeHTML, previewHTML, setModelCatalog, setSel, STYLE_PRESETS, SKILLS } from './nodes.js?v=20261122p';
import * as cloud from './cloud.js?v=20261122m';

/* 运行期错误可见化：出问题时把信息挂到 title 和右下角提示，不用开 devtools 也能看到 */
window.addEventListener('error', (e) => {
  const loc = e.filename ? ` @ ${(e.filename.split('/').pop())}:${e.lineno}` : '';
  document.title = `ERR: ${e.message}${loc}`;
  const b = document.getElementById('boot');
  if (b) { b.textContent = `JS 错误: ${e.message} ${loc}`; b.style.background = '#B42318'; }
  console.error('[canvas]', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  document.title = `REJ: ${e.reason?.message ?? e.reason}`;
  console.error('[canvas]', e.reason);
});

/* ---------------- DOM ---------------- */
const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const grid = $('#grid');
const world = $('#world');
const wires = $('#wires');
const emptyEl = $('#empty');
const palette = $('#palette');
const minimap = $('#minimap');
const miniVp = $('#miniVp');
const tips = $('#tips');

const NODE_W = 300;
const GRID = 20;            // 吸附网格
const nodeEls = new Map();  // id -> DOM
let sel = new Set();        // 选中的节点 id
let mode = 'select';        // select | link

/* ---------------- 视口 ---------------- */
let view = sanitizeView(get().view);

function sanitizeView(v) {
  const k = Number.isFinite(v?.k) && v.k > 0 ? v.k : 1;
  return {
    k,
    x: Number.isFinite(v?.x) ? v.x : 0,
    y: Number.isFinite(v?.y) ? v.y : 0,
  };
}

function applyView() {
  // 兜底：k/x/y 任何一个是非有限数都会让整个画布消失，这里强制纠回安全值
  if (!Number.isFinite(view.k) || view.k <= 0) view.k = 1;
  if (!Number.isFinite(view.x)) view.x = 0;
  if (!Number.isFinite(view.y)) view.y = 0;
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
  grid.style.backgroundPosition = `${view.x}px ${view.y}px`;
  grid.style.backgroundSize =
    `${GRID * view.k}px ${GRID * view.k}px, ${GRID * view.k}px ${GRID * view.k}px, ${GRID * 5 * view.k}px ${GRID * 5 * view.k}px, ${GRID * 5 * view.k}px ${GRID * 5 * view.k}px`;
  $('#zoomVal').textContent = `${Math.round(view.k * 100)}%`;
  renderMini();
}

function toWorld(cx, cy) {
  const r = stage.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
}

function zoomAt(cx, cy, factor) {
  const r = stage.getBoundingClientRect();
  const mx = cx - r.left, my = cy - r.top;
  const nk = Math.min(2.5, Math.max(0.2, view.k * factor));
  const f = nk / view.k;
  view.x = mx - (mx - view.x) * f;
  view.y = my - (my - view.y) * f;
  view.k = nk;
  applyView();
  setView(view);
}

function centerOn(nodeId) {
  const n = get().nodes.find((x) => x.id === nodeId);
  if (!n) return;
  const r = stage.getBoundingClientRect();
  const k = Number.isFinite(view.k) && view.k > 0 ? view.k : 1;
  view.k = k;
  view.x = r.width / 2 - (n.x + NODE_W / 2) * k;
  view.y = r.height / 2 - (n.y + 120) * k;
  applyView();
  setView(view);
}

/** 把某个节点放大到「看得清」的尺寸并居中（targetW = 想要的屏幕宽度，像素）
 *  画布缩到 40% 时节点只有 120px 宽、字全糊在一起，双击/点提示词框就会走这里。
 *  顶部留 40、底部给工具条留 56，保证整张卡（连同提示词框和运行按钮）都在视口里，不被底栏压住。 */
function zoomToNode(nodeId, targetW = 400) {
  const n = get().nodes.find((x) => x.id === nodeId);
  if (!n) return;
  const el = nodeEls.get(nodeId);
  const r = stage.getBoundingClientRect();
  const h = el?.offsetHeight ?? 380;
  const topPad = 40;
  const bottomPad = 78;                     // 底部工具条 56 + 12 余量：留够，运行按钮不能被压住
  const availH = Math.max(200, r.height - topPad - bottomPad);
  const k = Math.min(2.2, Math.max(0.4, targetW / NODE_W), availH / h);
  view.k = k;
  view.x = r.width / 2 - (n.x + NODE_W / 2) * k;
  view.y = topPad + availH / 2 - (n.y + h / 2) * k;
  applyView();
  setView(view);
}

/* 底部浮动工具条占位：56 高 + 12 余量，取景时留出来，不然卡片最后一行会被压住 */
const DOCK_RESERVE = 78;

function fit(all = true) {
  const ns = get().nodes;
  const r = stage.getBoundingClientRect();
  if (!ns.length) {
    view = { k: 1, x: 0, y: 0 };
    applyView(); setView(view);
    return;
  }
  const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y);
  const minX = Math.min(...xs) - 60, minY = Math.min(...ys) - 60;
  const maxX = Math.max(...ns.map((n) => n.x + NODE_W)) + 60;
  const maxY = Math.max(...ys.map((n) => {
    const el = nodeEls.get(n.id);
    return n.y + (el?.offsetHeight ?? 300);
  })) + 60;
  const w = maxX - minX, h = maxY - minY;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    view = { k: 1, x: 0, y: 0 };
    applyView(); setView(view);
    return;
  }
  const availH = Math.max(200, r.height - DOCK_RESERVE);   // 底部工具条是浮层，别把卡片最后一行压住
  view.k = Math.max(0.25, Math.min(r.width / w, availH / h, 1));
  view.x = -minX * view.k + (r.width - w * view.k) / 2;
  view.y = -minY * view.k + (availH - h * view.k) / 2;
  applyView(); setView(view);
}

/**
 * 取景到全部节点。不依赖 stage 尺寸以外的任何东西（宽窗口下 fit 会算不准，
 * 这里自己按内容包围盒 + 固定留白重算，边距用 32px，保证一排卡片也能装下）。
 */
function frameNodes(maxK = 1) {
  const ns = get().nodes;
  const r = stage.getBoundingClientRect();
  if (!ns.length) {
    view = { k: 1, x: 0, y: 0 };
    applyView(); setView(view);
    return;
  }
  const pad = 40;
  const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y);
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + NODE_W + pad;
  const maxY = Math.max(...ys) + 340 + pad;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  const rw = Math.max(1, r.width), rh = Math.max(1, r.height);
  const availH = Math.max(160, rh - DOCK_RESERVE);
  const k = Math.max(0.2, Math.min((rw - 24) / w, (availH - 24) / h, maxK));
  view = { k, x: (rw - w * k) / 2 - minX * k, y: (availH - h * k) / 2 - minY * k };
  applyView();
  setView(view);
}

/* ---------------- 渲染 ---------------- */
function render() {
  const s = get();
  setSel(sel.size === 1 ? [...sel][0] : null);   // nodeHTML 按单选 id 画选中态
  const alive = new Set(s.nodes.map((n) => n.id));

  for (const n of s.nodes) {
    // 坐标必须是有限数：任何一步算出 NaN 都会让节点跑到界外、连带 fit 失效
    if (!Number.isFinite(n.x)) n.x = 0;
    if (!Number.isFinite(n.y)) n.y = 0;

    let el = nodeEls.get(n.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = n.id;
      el.innerHTML = nodeHTML(n);
      world.appendChild(el);
      nodeEls.set(n.id, el);
    }
    el.style.left = `${n.x}px`;
    el.style.top = `${n.y}px`;
    syncNode(el, n);
  }

  for (const [id, el] of nodeEls) {
    if (!alive.has(id)) { el.remove(); nodeEls.delete(id); }
  }

  drawWires();
  // 空态显隐用 DOM 实际数量兜底：state 和 DOM 不同步时（撤销/恢复竞态），
  // 会出现「节点明明在、空态胶囊还叠在上面」的灵异现场
  const domCount = nodeEls.size;
  emptyEl.classList.toggle('is-hidden', s.nodes.length > 0 || domCount > 0);
  $('#nodeCount').textContent = String(Math.max(s.nodes.length, domCount));
  renderPanel();
  renderMini();
  updateDock();
  applyView();
}

function syncNode(el, n) {
  el.classList.toggle('is-sel', sel.has(n.id));
  el.classList.toggle('is-run', n.status === 'running');
  el.classList.toggle('is-done', n.status === 'done');

  // 引用 chip 数量和数据对不上时（刚 @ 上 / 刚点 × 删掉），整块重建，否则旧 chip 会残留
  const wantRefs = Math.max((n.refImages ?? []).length, (n.refNames ?? []).length);
  if (wantRefs !== el.querySelectorAll('[data-refdel]').length) {
    el.innerHTML = nodeHTML(n);
  }

  const badge = el.querySelector('.n-badge-slot');
  const map = {
    idle: '', running: '<span class="n-badge run">生成中</span>',
    done: '<span class="n-badge done">已完成</span>', error: '<span class="n-badge err">失败</span>',
  };
  const want = map[n.status] ?? '';
  if (badge.innerHTML !== want) badge.innerHTML = want;

  const run = el.querySelector('.n-send') ?? el.querySelector('.n-run');
  if (run) {
    const label = n.status === 'running' ? '生成中…' : '运行';
    if (run.textContent !== label) run.textContent = label;
    run.disabled = n.status === 'running';
  }

  const pv = el.querySelector('.n-preview');
  if (pv) {
    const html = previewHTML(n, TYPES[n.type] ?? TYPES.text);
    if (pv.dataset.sig !== html) { pv.innerHTML = html; pv.dataset.sig = html; }
  }
}

/* ---------------- 连线 ---------------- */
function anchor(id, side) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n) return { x: 0, y: 0 };
  const h = nodeEls.get(id)?.offsetHeight ?? 240;
  return side === 'out'
    ? { x: n.x + NODE_W, y: n.y + h / 2 }
    : { x: n.x, y: n.y + h / 2 };
}

function curve(a, b) {
  const dx = Math.max(48, Math.abs(b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function drawWires(temp) {
  const s = get();
  const hot = new Set();
  if (sel.size) {
    s.edges.forEach((e) => {
      if (sel.has(e.from) || sel.has(e.to)) { hot.add(e.from); hot.add(e.to); }
    });
  }

  const paths = s.edges.map((e) => {
    const d = curve(anchor(e.from, 'out'), anchor(e.to, 'in'));
    const on = hot.has(e.from) && hot.has(e.to);
    return `<path class="wire-hit" d="${d}" fill="none" stroke="transparent" stroke-width="14" data-edge="${e.id}"></path>
      <path class="wire-line" d="${d}" fill="none" stroke="${on ? '#3B82F6' : '#C6CBD2'}"
        stroke-width="${on ? 2.2 : 1.8}" stroke-linecap="round" marker-end="url(#${on ? 'arr' : 'arrg'})"/>`;
  }).join('');

  wires.innerHTML = paths
    + (temp ? `<path d="${temp}" fill="none" stroke="#3B82F6" stroke-width="2" stroke-dasharray="6 4"/>` : '')
    + `<defs>
        <marker id="arr" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto">
          <path d="M0 0 L7 3.2 L0 6.4 z" fill="#3B82F6"/></marker>
        <marker id="arrg" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto">
          <path d="M0 0 L7 3.2 L0 6.4 z" fill="#C6CBD2"/></marker>
      </defs>`;
}

/* ---------------- 左侧面板 ---------------- */
function renderPanel() {
  const s = get();
  const q = ($('#nodeSearch').value || '').trim().toLowerCase();
  const f = $('#filterType').value;

  const list = s.nodes.filter((n) => {
    if (f !== 'all' && n.type !== f) return false;
    if (!q) return true;
    return (n.title + n.prompt).toLowerCase().includes(q);
  });

  const box = $('#nodeList');
  if (!list.length) {
    box.innerHTML = `<div class="pempty">${s.nodes.length ? '没有匹配的节点' : '画布暂无节点'}</div>`;
    return;
  }
  box.innerHTML = list.map((n) => {
    const t = TYPES[n.type] ?? TYPES.text;
    return `<button class="pitem${sel.has(n.id) ? ' is-on' : ''}" data-focus="${n.id}">
      <span class="pitem-ic" style="color:${t.color}"><svg viewBox="0 0 24 24"><path d="${t.icon}"/></svg></span>
      <span class="pitem-main">
        <span class="pitem-t">${escapeHtml(n.title)}</span>
        <span class="pitem-s">${t.label}${n.prompt ? ' · ' + escapeHtml(n.prompt.slice(0, 12)) : ''}</span>
      </span>
    </button>`;
  }).join('');
}

/* ---------------- 小地图 ---------------- */
function renderMini() {
  if (!minimap.classList.contains('is-on')) return;
  const s = get();
  const r = stage.getBoundingClientRect();
  const W = 180, H = 116, pad = 8;
  const ns = s.nodes;
  if (!ns.length) { miniVp.style.cssText = 'left:8px;top:8px;width:60px;height:40px'; return; }

  const vx0 = -view.x / view.k, vy0 = -view.y / view.k;
  const vx1 = vx0 + r.width / view.k, vy1 = vy0 + r.height / view.k;
  const minX = Math.min(...ns.map((n) => n.x), vx0) - 40;
  const minY = Math.min(...ns.map((n) => n.y), vy0) - 40;
  const maxX = Math.max(...ns.map((n) => n.x + NODE_W), vx1) + 40;
  const maxY = Math.max(...ns.map((n) => n.y + 260), vy1) + 40;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));

  minimap.querySelectorAll('.mini-node').forEach((x) => x.remove());
  ns.forEach((n) => {
    const d = document.createElement('i');
    d.className = 'mini-node';
    d.style.cssText = `left:${pad + (n.x - minX) * sc}px;top:${pad + (n.y - minY) * sc}px;
      width:${Math.max(3, NODE_W * sc)}px;height:${Math.max(2, 80 * sc)}px`;
    minimap.appendChild(d);
  });
  miniVp.style.cssText = `left:${pad + (vx0 - minX) * sc}px;top:${pad + (vy0 - minY) * sc}px;
    width:${Math.max(10, (vx1 - vx0) * sc)}px;height:${Math.max(10, (vy1 - vy0) * sc)}px`;
}

/* ---------------- 工具栏状态 ---------------- */
function updateDock() {
  $('#btnUndo').disabled = !canUndo();
  $('#btnRedo').disabled = !canRedo();
  $('#toolSelect').classList.toggle('is-on', mode === 'select');
  $('#toolLink').classList.toggle('is-on', mode === 'link');
  stage.classList.toggle('is-link', mode === 'link');
}

/* ---------------- 手势 ---------------- */
let pan = null;
let drag = null;
let band = null;
let linkDrag = null;

stage.addEventListener('pointerdown', (e) => {
  if (e.button === 2) return;

  // 只有「画布本体」和「节点」才参与手势。
  // 一旦这里对别的元素 setPointerCapture，click 的 target 会被改写成 stage，
  // 工具栏/空态按钮上的事件委托就全部失效（表现成「点了没反应」）。
  const isCanvas = e.target === stage || e.target.id === 'grid' || e.target === world
    || !!e.target.closest('.wires');
  const nodeEl = e.target.closest('.node');
  const portOut = e.target.closest('.port.out');
  if (!isCanvas && !nodeEl) return;

  // 从输出端口拖线
  if (portOut) {
    const id = nodeEl.dataset.id;
    linkDrag = { from: id };
    e.preventDefault();
    return;
  }

  if (nodeEl) {
    const id = nodeEl.dataset.id;
    // 连线模式：点节点即连线（先点源，再点目标）
    if (mode === 'link') {
      if (!linkDrag) { linkDrag = { from: id, click: true }; setHot(id); }
      else { connectNodes(linkDrag.from, id); linkDrag = null; render(); }
      return;
    }
    if (e.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
    else if (!sel.has(id)) { sel.clear(); sel.add(id); }

    // 只有标题栏能拖：按钮/输入框/下拉要自己吃点击，
    // 一旦这里 setPointerCapture，click 的 target 会被改写成 stage，按钮就点不动了。
    if (!e.target.closest('.n-head')) {
      render();
      return;
    }

    render();
    const w = toWorld(e.clientX, e.clientY);
    drag = { ids: [...sel], start: w, orig: [...sel].map((x) => {
      const nn = get().nodes.find((y) => y.id === x);
      return { id: x, x: nn.x, y: nn.y };
    }) };
    mark();
    stage.setPointerCapture(e.pointerId);
    return;
  }

  // 空白：Shift 框选，否则平移
  if (e.shiftKey) {
    const w = toWorld(e.clientX, e.clientY);
    band = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    return;
  }
  sel.clear(); render();
  pan = { x: e.clientX - view.x, y: e.clientY - view.y };
  stage.classList.add('is-pan');
  stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', (e) => {
  if (pan) {
    view.x = e.clientX - pan.x;
    view.y = e.clientY - pan.y;
    applyView();
    return;
  }
  if (drag) {
    const w = toWorld(e.clientX, e.clientY);
    const dx = w.x - drag.start.x;
    const dy = w.y - drag.start.y;
    drag.orig.forEach((o) => {
      let nx = o.x + dx, ny = o.y + dy;
      if (snapOn) { nx = Math.round(nx / GRID) * GRID; ny = Math.round(ny / GRID) * GRID; }
      moveNode(o.id, nx, ny);
      const el = nodeEls.get(o.id);
      if (el) { el.style.left = `${nx}px`; el.style.top = `${ny}px`; }
    });
    drawWires();
    renderMini();
    return;
  }
  if (linkDrag) {
    const w = toWorld(e.clientX, e.clientY);
    const a = anchor(linkDrag.from, 'out');
    drawWires(curve(a, w));
    return;
  }
  if (band) {
    const w = toWorld(e.clientX, e.clientY);
    band.x1 = w.x; band.y1 = w.y;
    drawBand();
  }
});

stage.addEventListener('pointerup', (e) => {
  if (pan) { pan = null; stage.classList.remove('is-pan'); setView(view); }
  if (drag) { drag = null; setView(view); }
  if (band) {
    const x0 = Math.min(band.x0, band.x1), x1 = Math.max(band.x0, band.x1);
    const y0 = Math.min(band.y0, band.y1), y1 = Math.max(band.y0, band.y1);
    get().nodes.forEach((n) => {
      if (n.x < x1 && n.x + NODE_W > x0 && n.y < y1 && n.y + 100 > y0) sel.add(n.id);
    });
    band = null;
    document.getElementById('band')?.remove();
    render();
  }
  if (linkDrag) {
    if (!linkDrag.click) {
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port.in');
      const to = t?.closest('.node')?.dataset.id;
      if (to && to !== linkDrag.from) { connectNodes(linkDrag.from, to); }
    }
    linkDrag = null;
    clearHot();
    render();
  }
});

function drawBand() {
  let b = document.getElementById('band');
  if (!b) {
    b = document.createElement('div');
    b.id = 'band';
    b.style.cssText = 'position:fixed;border:1px solid #3B82F6;background:rgba(59,130,246,.08);pointer-events:none;z-index:20;border-radius:3px';
    document.body.appendChild(b);
  }
  const r = stage.getBoundingClientRect();
  const sx = (w) => r.left + w * view.k + view.x;
  const sy = (w) => r.top + w * view.k + view.y;
  const left = Math.min(sx(band.x0), sx(band.x1));
  const top = Math.min(sy(band.y0), sy(band.y1));
  b.style.left = `${left}px`;
  b.style.top = `${top}px`;
  b.style.width = `${Math.abs(sx(band.x1) - sx(band.x0))}px`;
  b.style.height = `${Math.abs(sy(band.y1) - sy(band.y0))}px`;
}

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.92 : 1.08);
}, { passive: false });

/* 双击空白：默认「以双击点为锚放大」；Shift+双击 才是新建菜单 */
stage.addEventListener('dblclick', (e) => {
  if (e.target.closest('.node, .dock, .empty, .minimap, .palette, .modal')) return;
  if (e.shiftKey) {
    const w = toWorld(e.clientX, e.clientY);
    palette.dataset.x = String(w.x);
    palette.dataset.y = String(w.y);
    palette.style.left = `${Math.min(e.clientX, window.innerWidth - 190)}px`;
    palette.style.top = `${Math.min(e.clientY, window.innerHeight - 240)}px`;
    palette.classList.add('is-on');
    return;
  }
  zoomAt(e.clientX, e.clientY, 1.5);
});

document.addEventListener('pointerdown', (e) => {
  if (!palette.contains(e.target) && !e.target.closest('.node')) palette.classList.remove('is-on');
}, true);

/* ---------------- 节点内交互（事件委托） ---------------- */

/* 双击节点：提示词框 → 放大编辑窗；有结果的预览区 → 开大图；其余位置 → 把这个节点放大到可读 */
world.addEventListener('dblclick', (e) => {
  const nodeEl = e.target.closest('.node');
  if (!nodeEl) return;
  const id = nodeEl.dataset.id;
  if (e.target.closest('.n-prompt')) { e.preventDefault(); openPromptEditor(id); return; }
  if (e.target.closest('textarea, input, select, button, .n-tools')) return;
  const n = get().nodes.find((x) => x.id === id);
  const src = n?.result?.local || n?.result?.url;
  if (e.target.closest('.n-preview') && src) { openLightbox({ ...n.result, url: src }, n.title); return; }
  zoomToNode(id, 420);
});

/* 点进提示词框：节点在屏幕上太窄（字糊成一团）时自动放大到可读尺寸；正常大小不打扰输入 */
world.addEventListener('focusin', (e) => {
  const ta = e.target.closest('.n-prompt');
  if (!ta) return;
  const nodeEl = ta.closest('.node');
  if (!nodeEl) return;
  const shownW = (nodeEl.offsetWidth || NODE_W) * view.k;
  if (shownW < 300) setTimeout(() => zoomToNode(nodeEl.dataset.id, 420), 60);
});

world.addEventListener('click', (e) => {
  const pzoom = e.target.closest('[data-pzoom]');
  if (pzoom) {
    openPromptEditor(pzoom.closest('.node').dataset.id);
    return;
  }

  const plus = e.target.closest('[data-plus]');
  if (plus) {
    openPlusMenu(plus.closest('.node').dataset.id, plus);
    return;
  }

  const sw = e.target.closest('[data-settype]');
  if (sw) {
    switchNodeType(sw.closest('.node').dataset.id, sw.dataset.settype);
    return;
  }

  // @ 引用 chip 上的 × ：移除这条引用（重新引用从「@」或「画布参考」再加）
  const refdel = e.target.closest('[data-refdel]');
  if (refdel) {
    e.preventDefault();
    e.stopPropagation();
    const nid = refdel.closest('.node').dataset.id;
    const idx = Number(refdel.dataset.refdel);
    const nn = get().nodes.find((x) => x.id === nid);
    if (!nn) return;
    const name = (nn.refNames || [])[idx] || '';
    const oldEl = nodeEls.get(nid);
    if (oldEl) { oldEl.remove(); nodeEls.delete(nid); }   // 旧卡片带着被删的 chip，先拆掉让 render 重建
    updateNode(nid, {
      refImages: (nn.refImages || []).filter((_, i) => i !== idx),
      refNames: (nn.refNames || []).filter((_, i) => i !== idx),
    }, { history: false });
    render();
    toast(name ? `已移除引用 @${name}` : '已移除这条引用');
    return;
  }

  const chip = e.target.closest('[data-chip]');
  if (chip) {
    handleChip(chip.dataset.chip, chip.closest('.node').dataset.id, chip);
    return;
  }

  const tryBtn = e.target.closest('[data-try]');
  if (tryBtn) {
    const nid = tryBtn.closest('.node').dataset.id;
    const nn = get().nodes.find((x) => x.id === nid);
    const add = tryBtn.dataset.try === 'img2img'
      ? '，保持画面主体不变，仅按描述微调'
      : '，高清画质，细节丰富，锐化';
    updateNode(nid, { prompt: (nn.prompt || '') + add }, { history: false });
    const ta = nodeEls.get(nid) ? nodeEls.get(nid).querySelector('[data-f="prompt"]') : null;
    if (ta) { ta.value = nn.prompt; ta.focus(); }
    return;
  }

  const exp = e.target.closest('[data-expand]');
  if (exp) {
    const nn2 = get().nodes.find((x) => x.id === exp.closest('.node').dataset.id);
    const src2 = nn2?.result?.local || nn2?.result?.url;
    if (src2) openLightbox({ ...nn2.result, url: src2 }, nn2.title);
    return;
  }
  const dl = e.target.closest('[data-dl]');
  if (dl) {
    const n = get().nodes.find((x) => x.id === dl.closest('.node').dataset.id);
    if (!n?.result) return;
    const a = document.createElement('a');
    if (n.result.local) {
      // 已经转存到本机资产库：直接下载这个永久文件，不再依赖上游签名链接
      a.href = n.result.local;
      a.download = '';
      toast('从本机资产库下载（永久地址，不会过期）');
    } else if (n.result.url) {
      // 走服务端代理：上游是带签名的 COS/TOS 链接，浏览器直连会跨域，而且 24 小时就失效
      a.href = `api/download?url=${encodeURIComponent(n.result.url)}`;
      toast('开始下载，同时会存一份到 data/output');
    } else {
      return;
    }
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  const dup = e.target.closest('[data-dup]');
  if (dup) {
    const src = get().nodes.find((n) => n.id === dup.closest('.node').dataset.id);
    if (src) {
      const spot = findFreeSpot(src.x + NODE_W + SPOT_GAP, src.y);
      const copy = JSON.parse(JSON.stringify(src));
      // 一定要丢掉旧 id：addNode 里 { id: uid(), ...node } 会把 node.id 覆盖回去，
      // 两个节点同 id 就会在 nodeEls 里合并成一个 DOM（画布上少一张卡）
      delete copy.id;
      copy.x = spot.x;
      copy.y = spot.y;
      const node = addNode(copy);
      sel.clear();
      sel.add(node.id);
      render();
      centerOn(node.id);
      toast('已复制节点');
    }
    return;
  }

  const del = e.target.closest('[data-del]');
  if (del) {
    const id = del.closest('.node').dataset.id;
    removeNode(id); sel.delete(id); render();
    return;
  }
  const run = e.target.closest('[data-run]');
  if (run) {
    const id = run.closest('.node').dataset.id;
    runNode(id);
    return;
  }
  const edge = e.target.closest('[data-edge]');
  if (edge) { removeEdge(edge.dataset.edge); render(); }
});

world.addEventListener('input', (e) => {
  const f = e.target.dataset?.f;
  if (!f) return;
  const id = e.target.closest('.node').dataset.id;
  updateNode(id, { [f]: e.target.value }, { history: false });

  // 提示词里输入 @ → 弹出引用菜单（引用画布上的图片节点作参考图）
  if (f === 'prompt' && e.target.value.endsWith('@')) openRefMenu(id, e.target);
});

world.addEventListener('change', (e) => {
  const f = e.target.dataset?.f;
  if (!f) return;
  const id = e.target.closest('.node').dataset.id;
  updateNode(id, { [f]: e.target.value });
});

/* ---------------- 服务端能力 ---------------- */

const API = {
  async json(path, body) {
    // 相对路径：独立访问（5180 根路径）与 iframe 嵌入（/canvas/ 下）都能正确解析
    if (path.startsWith('/')) path = path.slice(1);
    const res = await fetch(path, body === undefined
      ? {}
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    // error 可能是字符串也可能是对象（网关/代理的 404 格式不一），统一取 message
    const errMsg = typeof data.error === 'string'
      ? data.error
      : (data.error?.message || data.message || `请求失败（HTTP ${res.status}）`);
    if (!res.ok) throw new Error(errMsg);
    return data;
  },
};

let SERVER = { ready: false, configured: false, tokenMasked: '', workflows: {} };
let catalogSig = null;

async function loadServerStatus() {
  try {
    SERVER = await API.json('/api/status');
  } catch (e) {
    SERVER = { ready: false, configured: false, error: e.message };
  }
  // 把服务端真实的模型/工作流目录灌进下拉。
  // 下拉的 option 是在建卡那一刻生成的，所以目录到位后要重建一次节点 DOM，
  // 否则先渲染的卡片下拉是空的（首次打开时状态还没拉回来）。
  setModelCatalog({
    imageModels: SERVER.imageModels,
    imageDefault: SERVER.imageModel,
    videoWorkflows: SERVER.videoWorkflows,
  });
  paintServerState();

  // 下拉的 option 在建卡那一刻就固定了，目录到位后必须重建节点 DOM
  const sig = JSON.stringify([SERVER.imageModels, SERVER.videoWorkflows]);
  if (sig !== catalogSig) {
    catalogSig = sig;
    nodeEls.forEach((el) => el.remove());
    nodeEls.clear();
  }

}

function paintServerState() {
  const el = $('#modelState');
  if (!el) return;
  if (SERVER.ready) {
    el.className = 'pill is-ok';
    el.innerHTML = `<i></i>模型已接入 ${SERVER.tokenMasked ?? ''}`;
    el.title = `文生视频：${SERVER.workflows?.text2video ?? '—'}\n图生视频：${SERVER.workflows?.refVideo ?? '—'}`;
  } else if (SERVER.permission?.reason === 'no-comfyui') {
    el.className = 'pill is-warn';
    el.innerHTML = '<i></i>令牌缺 ComfyUI 权限';
      el.title = '点右上角「接 API」换一把 ComfyUI 分组的令牌';
  } else if (SERVER.forceMock) {
    el.className = 'pill is-warn';
    el.innerHTML = '<i></i>模拟模式';
    el.title = '服务端设置了 FORCE_MOCK=1，不会真的调模型';
  } else {
    el.className = 'pill is-warn';
    el.innerHTML = '<i></i>未配置令牌';
    el.title = '在 .env 里填 AUTODL_TOKEN（AutoDL 令牌分组必须选 ComfyUI），然后重启服务';
  }
}

/* ---------------- 运行 ---------------- */

const running = new Set();

async function runNode(id) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n || running.has(id)) return;

  running.add(id);
  commit((s) => {
    const t = s.nodes.find((x) => x.id === id);
    if (!t) return;
    t.status = 'running';
    t.progress = 6;
    t.error = '';
    t.result = null;
  }, 'run');

  const t0 = Date.now();
  const ticker = setInterval(() => {
    // 真实任务可能要跑几分钟，进度条只是「还在动」的反馈，到 90% 就压住不再涨
    const grow = Math.min(90, 6 + (Date.now() - t0) / 900);
    updateNode(id, { progress: Math.round(grow) }, { history: false });
  }, 900);

  try {
    const resolution = n.ratio === '1:1' ? '480p方' : n.ratio === '16:9' ? '480p横' : '480p竖';

    // 把连到本节点上游的图片结果收集起来当参考图——
    // 之前只画了线没传图，所以「按参考图生成」其实是空的。
    const state0 = get();
    const fromEdges = state0.edges
      .filter((e) => e.to === id)
      .map((e) => state0.nodes.find((x) => x.id === e.from))
      .filter((x) => x?.result?.url && (x.result.kind === 'image'))
      .map((x) => x.result.url);
    // @ 引用的（没有连线的也算）+ 连线上游的，去重后按顺序传。
    // dataURL/本地图 AutoDL 云端下载不到，视频参考图只保留公网 http(s) 链接
    const explicit = (n.refImages ?? []).filter((u) => /^https?:\/\//i.test(u));
    const refImages = [...new Set([...explicit, ...fromEdges])].slice(0, 9);

    // 老存档里可能存着写死的假模型名（Seedream 4.0 之类），提交前对齐成真实可用的
    const imgList = SERVER.imageModels ?? [];
    const flowList = (SERVER.videoWorkflows ?? []).map((w) => w.id);
    const model = n.type === 'image'
      ? (imgList.includes(n.model) ? n.model : imgList[0] ?? '')
      : (flowList.includes(n.model) ? n.model : flowList[0] ?? '');
    if (model && model !== n.model) updateNode(id, { model }, { history: false });

    const sub = await API.json('/api/generate', {
      kind: n.type === 'image' ? 'image' : 'video',
      prompt: (n.prompt || '').trim() || n.title,
      ratio: n.ratio || '9:16',
      resolution,
      duration: Number(n.duration) || 15,
      model,
      refImages,
      // 图片节点上传了本地图 → 走 images/edits 图生图
      refImage: n.type === 'image' && n.uploadImage ? n.uploadImage : undefined,
    });

    if (sub.refImages) {
      updateNode(id, { refCount: sub.refImages, realWorkflow: sub.workflowId }, { history: false });
      if (sub.switchedToRef) toast(`检测到 ${sub.refImages} 张参考图，已自动切到图生视频工作流`);
    }

    // 图片是同步接口，提交即出图；视频才需要等
    const out = sub.done ? sub : await API.json('/api/generate/wait', { taskId: sub.taskId });
    clearInterval(ticker);

    if (out.status === 'done') {
      const first = (out.results || [])[0];
      const result = out.mock
        ? mockPlaceholder(n)
        : { kind: first?.type || 'file', url: first?.url || '' };
      commit((s) => {
        const t = s.nodes.find((x) => x.id === id);
        if (!t) return;
        t.status = 'done';
        t.progress = 100;
        t.result = result;
      }, 'done');

      // 结果一出来就转存进资产库：上游链接 24 小时就过期，本地这份是永久的。
      // 转存成功后把本地地址写进 result.local，预览/下载都走它，画布再也不会裂图。
      if (!out.mock && result.url) {
        cloud.recordResult({
          nodeId: id,
          nodeTitle: n.title,
          kind: result.kind === 'video' ? 'video' : 'image',
          prompt: (n.prompt || '').trim(),
          params: { ratio: n.ratio, duration: n.duration, model },
          url: result.url,
        }).then((asset) => {
          if (asset?.url) {
            updateNode(id, { result: { ...result, local: asset.url, assetId: asset.id } }, { history: false });
          }
        }).catch(() => { /* 转存失败不影响本次结果展示 */ });
      }

      toast(out.mock
        ? '模拟完成：链路通了，但没有调模型、没有花钱'
        : `生成完成${out.elapsedMs ? `，耗时 ${Math.round(out.elapsedMs / 1000)} 秒` : ''}${out.mock ? '' : '，已存入资产库'}`);
    } else {
      const msg = out.status === 'timeout'
        ? (out.message || '等待超时，任务可能还在排队')
        : (out.message || out.rawStatus || '任务失败');
      commit((s) => {
        const t = s.nodes.find((x) => x.id === id);
        if (!t) return;
        t.status = 'error';
        t.error = msg;
        t.progress = 0;
      }, 'err');
      toast(msg);
    }
  } catch (e) {
    clearInterval(ticker);
    commit((s) => {
      const t = s.nodes.find((x) => x.id === id);
      if (!t) return;
      t.status = 'error';
      t.error = e.message;
      t.progress = 0;
    }, 'err');
    toast(e.message);
  } finally {
    running.delete(id);
    render();
  }
}

function runAll() {
  const targets = get().nodes.filter((n) => n.type === 'image' || n.type === 'video');
  if (!targets.length) { toast('画布上没有图片/视频节点可运行'); return; }
  if (!SERVER.ready) {
    if (SERVER.permission?.reason === 'no-comfyui') toast('令牌缺 ComfyUI 权限，生成会被拒（详情看节点上的报错）');
    else if (SERVER.forceMock) toast('当前是模拟模式，不会真的出片');
    else toast('还没配 AUTODL_TOKEN，只能跑模拟');
  }
  targets.forEach((n, i) => setTimeout(() => runNode(n.id), i * 400));
  toast(`开始生成 ${targets.length} 个节点`);
}

/* ---------------- 顶栏 / 按钮 ---------------- */
$('#docName').addEventListener('change', (e) => {
  setName(e.target.value.trim() || '未命名画布');
  cloud.renderCanvasBtn();
});
$('#btnCanvases')?.addEventListener('click', () => cloud.openCanvasPicker());

$('#btnRunAll').addEventListener('click', runAll);

/* ---------------- 接 API 弹窗 ---------------- */

function openApiModal() {
  const cur = SERVER.workflows ?? {};
  const def = SERVER.defaults ?? {};
  const resOpts = ['480p竖', '768p竖', '480p横', '768p横', '480p方']
    .map((x) => `<option${x === def.resolution ? ' selected' : ''}>${x}</option>`).join('');

  $('#modalBox').innerHTML = `
    <h3>接入生成模型</h3>
    <div class="cfg-sub">
      令牌在 <b>autodl.art → 令牌管理 → 创建令牌</b> 生成，<b>分组必须选 ComfyUI</b>；
      普通 LLM 分组的令牌提交会被拒（403 permission_denied）。
    </div>

    <label class="cfg-field">
      <span>AutoDL 令牌${SERVER.tokenMasked ? `　当前：${SERVER.tokenMasked}` : ''}</span>
      <input id="cfgToken" type="password" autocomplete="off"
        placeholder="${SERVER.configured ? '留空 = 保持当前令牌不变' : '粘贴令牌，形如 ft7i…'}" />
    </label>

    <label class="cfg-field">
      <span>图片令牌（LLM 分组）${SERVER.imageTokenMasked ? `　当前：${SERVER.imageTokenMasked}` : '　未配置，图片生成不可用'}</span>
      <input id="cfgLlmToken" type="password" autocomplete="off"
        placeholder="图片走 /api/v1/images/generations，需要 LLM 分组的令牌" />
    </label>

    <div class="cfg-row">
      <label class="cfg-field"><span>图片模型</span>
        <input id="cfgImgModel" value="${SERVER.imageModel ?? 'gpt-image-2.5-flare'}" /></label>
      <label class="cfg-field"><span>文生视频工作流</span>
        <input id="cfgW1" value="${cur.text2video ?? ''}" /></label>
    </div>

    <label class="cfg-field"><span>图生视频工作流（多图多音频）</span>
      <input id="cfgW2" value="${cur.refVideo ?? ''}" /></label>

    <div class="cfg-row">
      <label class="cfg-field"><span>默认分辨率</span>
        <select id="cfgRes">${resOpts}</select></label>
      <label class="cfg-field"><span>默认时长（秒）</span>
        <input id="cfgDur" type="number" min="1" max="60" value="${def.duration ?? 15}" /></label>
    </div>

    <div class="cfg-result" id="cfgResult"></div>

    <div class="cfg-actions">
      <button class="btn" id="cfgCancel">取消</button>
      <button class="btn btn-primary" id="cfgSave">保存并测试连接</button>
    </div>`;

  $('#modal').classList.add('is-on');
  $('#cfgToken').focus();

  $('#cfgCancel').onclick = () => $('#modal').classList.remove('is-on');
  $('#cfgSave').onclick = async () => {
    const btn = $('#cfgSave');
    const box = $('#cfgResult');
    btn.disabled = true;
    btn.textContent = '测试中…';
    box.className = 'cfg-result is-on';
    box.textContent = '正在保存并探测权限…';

    try {
      const out = await API.json('/api/config', {
        token: $('#cfgToken').value.trim(),
        llmToken: $('#cfgLlmToken').value.trim(),
        imageModel: $('#cfgImgModel').value.trim(),
        workflowText2Video: $('#cfgW1').value.trim(),
        workflowRefVideo: $('#cfgW2').value.trim(),
        resolution: $('#cfgRes').value,
        duration: Number($('#cfgDur').value) || 15,
      });

      SERVER = { ...SERVER, ...out };
      paintServerState();

      if (out.ready) {
        box.className = 'cfg-result is-on ok';
        box.innerHTML = `已接入，权限正常。<br>令牌 ${out.tokenMasked}　·　文生视频 <code>${out.workflows?.text2video ?? ''}</code>`;
        setTimeout(() => $('#modal').classList.remove('is-on'), 1400);
      } else {
        box.className = 'cfg-result is-on err';
        box.innerHTML = out.permission?.reason === 'no-comfyui'
          ? '保存了，但<b>令牌还是缺 ComfyUI 权限</b>：分组选错或者这把不是 ComfyUI 分组的令牌。'
          : `保存了，但连接不通：${out.permission?.message || '未知原因'}`;
      }
    } catch (e) {
      box.className = 'cfg-result is-on err';
      box.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '保存并测试连接';
    }
  };
}

$('#btnApi').addEventListener('click', openApiModal);

$('#btnFitAll').addEventListener('click', () => frameNodes());
$('#btnUndo').addEventListener('click', () => { undo(); sel.clear(); render(); });
$('#btnRedo').addEventListener('click', () => { redo(); sel.clear(); render(); });
$('#btnZoomIn').addEventListener('click', () => zoomAt(innerWidth / 2, innerHeight / 2, 1.15));
$('#btnZoomOut').addEventListener('click', () => zoomAt(innerWidth / 2, innerHeight / 2, 0.87));
$('#zoomVal').addEventListener('click', () => {
  const r = stage.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / view.k);
});

let snapOn = true;
$('#btnSnap').addEventListener('click', () => {
  snapOn = !snapOn;
  $('#btnSnap').classList.toggle('is-on', snapOn);
  toast(snapOn ? '网格吸附：开' : '网格吸附：关');
});
$('#btnSnap').classList.add('is-on');

$('#btnMini').addEventListener('click', () => {
  minimap.classList.toggle('is-on');
  $('#btnMini').classList.toggle('is-on', minimap.classList.contains('is-on'));
  renderMini();
});

$('#btnTidy').addEventListener('click', () => {
  const ns = [...get().nodes];
  if (!ns.length) return;
  // 按数据流分层：无入边的排第一列，其余按最长路径推到右侧
  const depth = new Map(ns.map((n) => [n.id, 0]));
  const edges = get().edges;
  for (let i = 0; i < ns.length; i++) {
    edges.forEach((e) => {
      const d = (depth.get(e.from) ?? 0) + 1;
      if (d > (depth.get(e.to) ?? 0)) depth.set(e.to, d);
    });
  }
  const cols = new Map();
  commit((s) => {
    s.nodes.forEach((n) => {
      const d = depth.get(n.id) ?? 0;
      const row = cols.get(d) ?? 0;
      cols.set(d, row + 1);
      n.x = d * (NODE_W + 80);
      n.y = row * 340;
    });
  }, 'tidy');
  // 等一拍再适应：commit 之后节点 DOM 才按新坐标布局，这时读 offsetHeight 才准。
  // 用 setTimeout 而不是 requestAnimationFrame——后台标签页里 rAF 会被暂停，界面会停在没缩放的状态。
  setTimeout(() => frameNodes(), 80);
  toast('已按数据流整理');
});

$('#btnPanel').addEventListener('click', () => {
  document.body.classList.toggle('panel-hidden');
  $('#panel').classList.toggle('is-hidden');
  setTimeout(() => { frameNodes(); }, 240);
});

$('#toolSelect').addEventListener('click', () => { mode = 'select'; linkDrag = null; updateDock(); });
$('#toolLink').addEventListener('click', () => {
  mode = mode === 'link' ? 'select' : 'link';
  linkDrag = null;
  updateDock();
  toast(mode === 'link' ? '连线模式：先点源节点，再点目标节点' : '已回到选择模式');
});

$('#btnHelp').addEventListener('click', () => {
  $('#modalBox').innerHTML = `
    <h3>快捷键</h3>
    <table>
      <tr><td>平移画布</td><td>空白处拖拽 / 中键拖拽 / <kbd>空格</kbd>+拖拽</td></tr>
      <tr><td>缩放</td><td>滚轮 / 左下 <kbd>＋</kbd><kbd>−</kbd> / 点百分比归位 / 双击空白放大</td></tr>
      <tr><td>新建节点</td><td><kbd>Shift</kbd>+双击空白 / 底部工具条 / 空态快捷按钮</td></tr>
      <tr><td>放大看内容</td><td>双击节点（有图开大图，没图放大该节点）；双击提示词框开大编辑窗</td></tr>
      <tr><td>连线</td><td>从右侧圆点拖到目标左侧圆点，或按 <kbd>L</kbd> 进连线模式</td></tr>
      <tr><td>多选</td><td><kbd>Shift</kbd>+点击 / <kbd>Shift</kbd>+拖拽框选</td></tr>
      <tr><td>删除</td><td>选中后 <kbd>Delete</kbd>；点连线可删连线</td></tr>
      <tr><td>撤销 / 重做</td><td><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></td></tr>
      <tr><td>适应画布</td><td><kbd>F</kbd></td></tr>
    </table>`;
  $('#modal').classList.add('is-on');
});
$('#modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') $('#modal').classList.remove('is-on');
});

/* ---------------- 新建节点的落点：不叠在一起 ---------------- */
const NODE_H_GUESS = 460;   // 生成卡片高度估算（预览区 224 + 参数区），只用于避让
const SPOT_GAP = 28;        // 两个节点之间至少留这么多空隙

function spotOverlaps(p, o) {
  return Math.abs(p.x - o.x) < NODE_W + SPOT_GAP
    && Math.abs(p.y - o.y) < NODE_H_GUESS + SPOT_GAP;
}

/**
 * 从目标点开始找最近的一个空位。
 * 候选按「离中心近的优先，且右侧/下方优先」排序，最多铺到第 4 圈；
 * 全占满时退回斜向错开，保证任何情况下都不会和已有节点完全重合。
 */
function findFreeSpot(bx, by) {
  const list = get().nodes;
  if (!list.length) return { x: bx, y: by };

  const stepX = NODE_W + SPOT_GAP;
  const stepY = NODE_H_GUESS + SPOT_GAP;
  const cands = [];
  for (let ring = 1; ring <= 4; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        // 左边/上边加一点惩罚，让新节点优先落到右侧和下方
        const score = Math.hypot(i, j) * (i < 0 ? 1.3 : 1) * (j < 0 ? 1.15 : 1);
        cands.push({ i, j, score });
      }
    }
  }
  cands.sort((a, b) => a.score - b.score);

  for (const c of cands) {
    const p = { x: bx + c.i * stepX, y: by + c.j * stepY };
    if (!list.some((o) => spotOverlaps(p, o))) return p;
  }
  return { x: bx + list.length * 56, y: by + list.length * 56 };
}

/* 快捷新建按钮（空态 + 底部工具条 + 双击菜单）
 * 直接绑在按钮上，不走 document 委托——画布会 setPointerCapture，
 * 冒泡路径上的 target 可能被改写成 stage，委托就收不到按钮了。 */
function createFromButton(b) {
  const type = b.dataset.add;
  let x, y;
  if (palette.dataset.x) {
    x = Number(palette.dataset.x);
    y = Number(palette.dataset.y);
    delete palette.dataset.x;
    delete palette.dataset.y;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const r = stage.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    // 以视口中心为起点找最近的空位：已有节点占住的位置会自动让开
    const spot = findFreeSpot(Math.round(c.x - NODE_W / 2), Math.round(c.y - 140));
    x = spot.x;
    y = spot.y;
  }
  const node = addNode(defaultNode(type, x, y));
  sel.clear();
  sel.add(node.id);
  palette.classList.remove('is-on');
  render();
  centerOn(node.id);
  focusPrompt(node.id);
}

// 双保险：委托（捕获阶段，先触发）负责执行；元素级兜底检查 fired 防重复。
// 这样无论哪个浏览器/扩展环境里元素级绑定失效，按钮都能工作。
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (!b || b.dataset.fired) return;
  b.dataset.fired = '1';
  setTimeout(() => { delete b.dataset.fired; }, 0);
  e.preventDefault();
  e.stopPropagation();
  createFromButton(b);
}, true);

document.querySelectorAll('[data-add]').forEach((b) => {
  if (b.dataset.bound) return;
  b.dataset.bound = '1';
  b.addEventListener('click', () => {
    if (b.dataset.fired) return;
    createFromButton(b);
  });
});

/* 左侧面板：点击定位 */
$('#nodeList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-focus]');
  if (!b) return;
  sel.clear(); sel.add(b.dataset.focus);
  render();
  centerOn(b.dataset.focus);
});
$('#nodeSearch').addEventListener('input', renderPanel);
$('#filterType').addEventListener('change', renderPanel);

/* 面板 Tab 切换：画布 / 资产库 / 生成历史 */
document.querySelectorAll('.ptab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.ptab').forEach((x) => x.classList.toggle('is-on', x === t));
    const k = t.dataset.ptab;
    // 画布控件（筛选/搜索）只在「画布」tab 下有意义，其余 tab 收起来
    const canvasCtl = k === 'nodes';
    const prow = document.querySelector('.prow');
    if (prow) prow.style.display = canvasCtl ? '' : 'none';
    $('#nodeSearch').style.display = canvasCtl ? '' : 'none';

    if (k === 'assets') {
      cloud.renderAssets($('#nodeList'));
    } else if (k === 'prompts') {
      cloud.renderHistory($('#nodeList'));
    } else {
      renderPanel();
    }
  });
});

/* 视图模式 segmented（工作流 / 故事板）
 * 故事板 = 按画布上从上到下的顺序横排成一条时间线，切回来还原原来的位置。
 * 切换只改坐标、不进撤销栈（用 touch），免得撤销记录被视图操作污染。 */
let boardSnap = null;

function enterBoard() {
  const list = get().nodes;
  if (!list.length) { toast('画布上还没有节点，先加一个'); return false; }
  if (boardSnap) return true;
  boardSnap = list.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  const order = [...list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  touch((s) => {
    s.nodes.forEach((n) => {
      const i = order.findIndex((o) => o.id === n.id);
      n.x = Math.max(0, i) * (NODE_W + SPOT_GAP);
      n.y = 0;
    });
  }, 'board');
  render();
  frameNodes();
  toast('故事板：按顺序排成一行，拖一下就能调整先后');
  return true;
}

function exitBoard() {
  if (!boardSnap) return;
  const snap = boardSnap;
  boardSnap = null;
  touch((s) => {
    s.nodes.forEach((n) => {
      const o = snap.find((x) => x.id === n.id);
      if (o) { n.x = o.x; n.y = o.y; }
    });
  }, 'board');
  render();
  frameNodes();
}

document.querySelectorAll('.seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    const toBoard = b.dataset.mode === 'board';
    if (toBoard && !enterBoard()) return;         // 空画布不切
    document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('is-on', x === b));
    if (!toBoard) exitBoard();
  });
});

/* ---------------- 节点外侧 ⊕：引用当前节点生成下游 ---------------- */

const plusMenu = document.createElement('div');
plusMenu.className = 'ctx-menu plus-menu';
plusMenu.innerHTML = `
  <div class="ctx-title">引用该节点生成</div>
  <button data-plus-type="image"><i class="cdot" style="--c:#3B82F6"></i>图片</button>
  <button data-plus-type="video"><i class="cdot" style="--c:#8B5CF6"></i>视频</button>
  <button data-plus-type="text"><i class="cdot" style="--c:#10B981"></i>文本</button>
  <button data-plus-type="shot"><i class="cdot" style="--c:#EF4444"></i>分镜</button>
  <button data-plus-type="audio"><i class="cdot" style="--c:#F59E0B"></i>音频</button>
  <button data-plus-type="edit"><i class="cdot" style="--c:#111827"></i>智能剪辑</button>`;
document.body.appendChild(plusMenu);

function openPlusMenu(parentId, btn) {
  const r = btn.getBoundingClientRect();
  plusMenu.dataset.parent = parentId;
  plusMenu.style.left = `${Math.min(r.right + 10, window.innerWidth - 190)}px`;
  plusMenu.style.top = `${Math.min(r.top - 10, window.innerHeight - 280)}px`;
  plusMenu.classList.add('is-on');
}

document.addEventListener('pointerdown', (e) => {
  if (!plusMenu.contains(e.target) && !e.target.closest('[data-plus]')) plusMenu.classList.remove('is-on');
}, true);

plusMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-plus-type]');
  if (!b) return;
  const parent = get().nodes.find((x) => x.id === plusMenu.dataset.parent);
  plusMenu.classList.remove('is-on');
  if (!parent) return;

  const type = b.dataset.plusType;
  const el = nodeEls.get(parent.id);
  const h = el?.offsetHeight ?? 260;
  const n = addNode(defaultNode(type, parent.x + NODE_W + 90, parent.y + Math.round(h / 2) - 120));
  connectNodes(parent.id, n.id);

  sel.clear(); sel.add(n.id);
  render();
  centerOn(n.id);
  focusPrompt(n.id);
});

/* ---------------- 连线：顺手把上游图片带进参考 ---------------- */

/** 连线的同时，若上游是已出图的图片节点，自动塞进下游的参考图（公网 http 才有效）。
 *  这样「拉了线」就等于「引用了这张图」，不用再手动 @ 一遍。 */
function connectNodes(fromId, toId) {
  if (!addEdge(fromId, toId)) return false;
  const s = get();
  const f = s.nodes.find((x) => x.id === fromId);
  const t = s.nodes.find((x) => x.id === toId);
  const url = f?.result?.url;
  if (f && t && f.type === 'image' && url && /^https?:\/\//i.test(url)) {
    const name = f.title || '上游图片';
    const refImages = (t.refImages || []).includes(url) ? (t.refImages || []) : (t.refImages || []).concat([url]).slice(0, 9);
    const refNames = (t.refNames || []).includes(name) ? (t.refNames || []) : (t.refNames || []).concat([name]).slice(0, 9);
    updateNode(toId, { refImages, refNames }, { history: false });
    toast('已连线，并自动带上上游图片做参考');
    return true;
  }
  toast('已连线');
  return true;
}

/* ---------------- 右键菜单 ---------------- */

const ctx = document.createElement('div');
ctx.className = 'ctx-menu';
ctx.innerHTML = `
  <button data-ctx="image"><i class="cdot" style="--c:#3B82F6"></i>文生图</button>
  <button data-ctx="video"><i class="cdot" style="--c:#8B5CF6"></i>文生视频</button>
  <div class="ctx-sep"></div>
  <button data-ctx="text"><i class="cdot" style="--c:#10B981"></i>文本 / 剧本</button>
  <button data-ctx="shot"><i class="cdot" style="--c:#EF4444"></i>脚本分镜</button>
  <div class="ctx-sep"></div>
  <button data-ctx="fit">适应画布</button>
  <button data-ctx="undo">撤销<span class="ctx-key">Ctrl+Z</span></button>
  <button data-ctx="redo">重做<span class="ctx-key">Ctrl+Shift+Z</span></button>`;
document.body.appendChild(ctx);

let ctxWorld = { x: 0, y: 0 };

stage.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.closest('.node')) return;      // 节点上右键不接管
  const w = toWorld(e.clientX, e.clientY);
  ctxWorld = w;
  ctx.style.left = `${Math.min(e.clientX, window.innerWidth - 176)}px`;
  ctx.style.top = `${Math.min(e.clientY, window.innerHeight - 250)}px`;
  ctx.classList.add('is-on');
});

document.addEventListener('pointerdown', (e) => {
  if (!ctx.contains(e.target)) ctx.classList.remove('is-on');
}, true);

ctx.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ctx]');
  if (!b) return;
  const k = b.dataset.ctx;
  ctx.classList.remove('is-on');
  if (k === 'fit') return frameNodes();
  if (k === 'undo') { undo(); sel.clear(); render(); return; }
  if (k === 'redo') { redo(); sel.clear(); render(); return; }
  const node = addNode(defaultNode(k, Math.round(ctxWorld.x), Math.round(ctxWorld.y)));
  sel.clear(); sel.add(node.id); render(); centerOn(node.id); focusPrompt(node.id);
});

/* ---------------- 新建 + 生成 弹窗（提示词与类型一次填完） ---------------- */

function openCreateModal(kind, pos) {
  const isVideo = kind === 'video';
  const t = TYPES[kind];
  const ratioOpts = (isVideo ? ['9:16', '16:9', '1:1'] : ['9:16', '3:4', '1:1', '16:9'])
    .map((x) => `<option>${x}</option>`).join('');

  $('#modalBox').innerHTML = `
    <h3>${isVideo ? '文生视频' : '文生图'}</h3>
    <div class="cfg-sub">写提示词、选参数，直接出结果。${isVideo
      ? '视频走 ComfyUI 工作流，按秒计费（480p≈0.04 元/秒）。'
      : `图片走 /api/v1/images/generations，模型 <code>${escapeHtml(SERVER.imageModel || '')}</code>。`}</div>

    <label class="cfg-field"><span>提示词</span>
      <textarea id="ncPrompt" rows="4" placeholder="${isVideo
        ? '描述镜头运动与画面变化，例如：宋代厨房，镜头从碗底缓慢推进，暖光'
        : '描述要生成的画面，例如：宋代农家厨房，粗陶碗，碗底两个鸡蛋，暖色油灯光'}"></textarea>
    </label>

    <div class="cfg-row">
      <label class="cfg-field"><span>画面比例</span>
        <select id="ncRatio">${ratioOpts}</select></label>
      ${isVideo
        ? `<label class="cfg-field"><span>时长（秒）</span>
             <select id="ncDur"><option>5</option><option>10</option><option selected>15</option></select></label>`
        : `<label class="cfg-field"><span>说明</span>
             <input value="同步出图，约 10–30 秒" disabled /></label>`}
    </div>

    <div class="cfg-result" id="ncResult"></div>

    <div class="cfg-actions">
      <button class="btn" id="ncCancel">取消</button>
      <button class="btn" id="ncOnly">只建节点</button>
      <button class="btn btn-primary" id="ncRun">创建并生成</button>
    </div>`;

  $('#modal').classList.add('is-on');
  setTimeout(() => $('#ncPrompt')?.focus(), 50);

  const build = () => {
    const prompt = $('#ncPrompt').value.trim();
    if (!prompt) { toast('先写提示词'); return null; }
    const n = addNode({
      ...defaultNode(kind, Math.round(pos.x), Math.round(pos.y)),
      prompt,
      title: prompt.slice(0, 14) + (prompt.length > 14 ? '…' : ''),
      ratio: $('#ncRatio').value,
      duration: isVideo ? Number($('#ncDur').value) : '',
    });
    sel.clear(); sel.add(n.id);
    $('#modal').classList.remove('is-on');
    render();
    centerOn(n.id);
    focusPrompt(n.id);
    return n;
  };

  $('#ncCancel').onclick = () => $('#modal').classList.remove('is-on');
  $('#ncOnly').onclick = () => build();
  $('#ncRun').onclick = () => {
    const n = build();
    if (n) setTimeout(() => runNode(n.id), 120);
  };
}

/* ---------------- 点击预览放大 ---------------- */

function openLightbox(result, title) {
  if (!result?.url) return;
  $('#modalBox').classList.remove('is-wide');
  const isVideo = result.kind === 'video';
  $('#modalBox').innerHTML = `
    <h3>${escapeHtml(title || (isVideo ? '生成视频' : '生成图片'))}</h3>
    ${isVideo
      ? `<video src="${escapeHtml(result.url)}" controls autoplay playsinline
           style="width:100%;max-height:62vh;border-radius:12px;background:#000"></video>`
      : `<img src="${escapeHtml(result.url)}" alt=""
           style="width:100%;max-height:62vh;object-fit:contain;border-radius:12px;background:#F2F3F5" />`}
    <div class="cfg-actions" style="margin-top:14px">
      <a class="btn" href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">打开原链接</a>
      <button class="btn btn-primary" id="lbClose">关闭</button>
    </div>`;
  $('#modal').classList.add('is-on');
  $('#lbClose').onclick = () => $('#modal').classList.remove('is-on');
}

/** 放大编辑提示词：节点小框里改长句太挤、字还容易被挡住，这里给一个大窗。
 *  保存后写回节点（进撤销栈），同时把卡片上的 textarea 同步成新值。 */
function openPromptEditor(nodeId) {
  const n = get().nodes.find((x) => x.id === nodeId);
  if (!n) return;
  $('#modalBox').innerHTML = `
    <h3>${escapeHtml(n.title || '节点')} · 提示词</h3>
    <div class="cfg-sub">大窗编辑，保存后写回节点并进撤销栈。<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 保存，<kbd>Esc</kbd> 关闭。</div>
    <textarea class="pe-area" id="peArea" spellcheck="false"></textarea>
    <div class="pe-meta"><span id="peCount"></span><span>${escapeHtml(n.model || '')}　${escapeHtml(n.ratio || '')}</span></div>
    <div class="cfg-actions">
      <button class="btn" id="peCancel">取消</button>
      <button class="btn btn-primary" id="peSave">保存并写回</button>
    </div>`;
  const area = $('#peArea');
  area.value = n.prompt || '';
  const recount = () => { $('#peCount').textContent = `${area.value.length} 字`; };
  recount();
  area.addEventListener('input', recount);
  $('#modalBox').classList.add('is-wide');
  $('#modal').classList.add('is-on');
  setTimeout(() => {
    area.focus();
    const L = area.value.length;
    area.setSelectionRange(L, L);
  }, 40);
  const close = () => {
    $('#modal').classList.remove('is-on');
    $('#modalBox').classList.remove('is-wide');
  };
  const save = () => {
    const v = area.value;
    updateNode(nodeId, { prompt: v });
    const dom = nodeEls.get(nodeId)?.querySelector('textarea[data-f="prompt"]');
    if (dom) dom.value = v;
    close();
    toast('提示词已更新');
  };
  $('#peSave').onclick = save;
  $('#peCancel').onclick = close;
  area.onkeydown = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); save(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  };
}

/** 新建完直接能打字：把光标放进提示词框 */function focusPrompt(id) {
  setTimeout(() => {
    const ta = nodeEls.get(id)?.querySelector('textarea[data-f="prompt"]');
    ta?.focus();
    ta?.setSelectionRange(0, 0);
  }, 90);
}

/* 卡片上直接切「图片 / 视频」：结构变了，必须重建这张卡 */
function switchNodeType(id, type) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n || n.type === type) return;
  const el = nodeEls.get(id);
  if (el) { el.remove(); nodeEls.delete(id); }   // 先拆掉旧 DOM，render 会按新类型重建
  commit((s) => {
    const t = s.nodes.find((x) => x.id === id);
    if (!t) return;
    // 先把当前结果按「当前类型」各自存一份，切回来时还能看到，而不是一律清空
    if (t.result) {
      if (t.type === 'image') t.imageResult = t.result;
      else t.videoResult = t.result;
    }
    t.type = type;
    t.title = TYPES[type].label;
    // 切换类型后默认模型用「接 API」里配置的那个，而不是列表第一个
    const imgList = SERVER.imageModels || [];
    const flowList = SERVER.videoWorkflows || [];
    if (type === 'image') {
      t.model = imgList.includes(t.model) ? t.model : (SERVER.imageModel || imgList[0] || '');
      t.ratio = t.ratio || '9:16';
    } else {
      t.model = flowList.some((w) => w.id === t.model) ? t.model : (flowList[0] ? flowList[0].id : '');
      t.ratio = t.ratio || '9:16';
      t.duration = 15;
    }
    // 按新类型恢复它自己那份结果；没有就保持空
    const keep = (type === 'image' ? t.imageResult : t.videoResult) || null;
    t.result = keep;
    t.status = keep ? 'done' : 'idle';
    t.progress = keep ? 100 : 0;
    t.error = '';
  }, 'type');
  render();
}

/* 参数面板上的功能 chips：上传 / 画布参考 / 风格 / 标记 */
function handleChip(kind, id, btn) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n) return;

  if (kind === 'upload') {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/webp';
    inp.onchange = async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      toast('正在上传…');
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          // 先落盘到服务端（data/uploads/），拿本机 URL —— 刷新不丢、localStorage 不爆
          const out = await API.json('/api/upload', { data: reader.result });
          updateNode(id, { uploadImage: out.url }, { history: false });
          render();
          toast('已上传，将作为参考图');
        } catch (e) {
          toast('上传失败：' + e.message);
        }
      };
      reader.readAsDataURL(file);
    };
    inp.click();
    return;
  }

  if (kind === 'canvasref') {
    const sources = get().nodes.filter((x) => x.id !== id && x.type === 'image' && x.result && x.result.url);
    if (!sources.length) { toast('画布上还没有已生成的图片节点'); return; }
    document.getElementById('modalBox').innerHTML =
      '<h3>画布参考</h3>' +
      '<div class="cfg-sub">选一张已有图片作为本节点的参考图。</div>' +
      sources.map((x) =>
        '<button class="cfg-pick" data-src="' + x.id + '">' +
        '<img src="' + x.result.url + '" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px" />' +
        '<span>' + escapeHtml(x.title) + '</span></button>').join('') +
      '<div class="cfg-actions"><button class="btn" id="cfgCancel2">取消</button></div>';
    document.getElementById('modal').classList.add('is-on');
    document.getElementById('modalBox').querySelectorAll('[data-src]').forEach((b) => {
      b.onclick = () => {
        const src = get().nodes.find((x) => x.id === b.dataset.src);
        const list = (n.refImages || []).concat([src.result.url]).slice(0, 9);
        updateNode(id, { refImages: list }, { history: false });
        document.getElementById('modal').classList.remove('is-on');
        render();
        toast('已挂参考图，共 ' + list.length + ' 张');
      };
    });
    const cancel = document.getElementById('cfgCancel2');
    if (cancel) cancel.onclick = () => document.getElementById('modal').classList.remove('is-on');
    return;
  }

  if (kind === 'style') {
    const cur = STYLE_PRESETS.indexOf(n.style || '');
    const next = STYLE_PRESETS[(cur + 1) % STYLE_PRESETS.length];
    // 清掉旧的风格后缀再追加新的
    const cleaned = (n.prompt || '').replace(/，?(真实摄影质感|电影级构图与光影|动漫风格|水墨画|赛博朋克)$/g, '');
    const p = next ? (cleaned ? cleaned + '，' + next : next) : cleaned;
    updateNode(id, { style: next, prompt: p }, { history: false });
    const ta = nodeEls.get(id) && nodeEls.get(id).querySelector('[data-f="prompt"]');
    if (ta) ta.value = p;
    toast(next ? '风格：' + next : '风格已清除');
    return;
  }

  if (kind === 'skill') { openSkillMenu(id); return; }

  if (kind === 'mark') { toast('已标记此节点'); return; }
}

/* ---------------- 技能预设：⚡ 技能 ---------------- */

function applySkill(id, skillId) {
  const n = get().nodes.find((x) => x.id === id);
  const s = SKILLS.find((x) => x.id === skillId);
  if (!n || !s) return;
  const patch = { prompt: s.prompt, style: '' };
  if (s.ratio) patch.ratio = s.ratio;
  if (s.duration) patch.duration = s.duration;
  if (s.type && s.type !== n.type) patch.type = s.type;
  updateNode(id, patch, { history: false });
  document.getElementById('modal').classList.remove('is-on');
  render();
  const ta = nodeEls.get(id) && nodeEls.get(id).querySelector('[data-f="prompt"]');
  if (ta) ta.value = s.prompt;
  const have = (n.refImages || []).length + (n.uploadImage ? 1 : 0);
  if (s.needRefs && have < s.needRefs) {
    toast(`已套用「${s.name}」，还差 ${s.needRefs - have} 张参考图 —— 提示词里打 @ 引用，或点「画布参考」`);
    return;
  }
  toast(`已套用技能「${s.name}」，参数已填好，点运行生成`);
}

function openSkillMenu(id) {
  const n = get().nodes.find((x) => x.id === id);
  if (!n) return;
  const list = SKILLS.filter((s) => !s.type || s.type === n.type);
  if (!list.length) { toast('这个节点还没有可用技能'); return; }
  const el = document.getElementById('modalBox');
  el.innerHTML =
    '<h3>⚡ 技能</h3>' +
    '<div class="cfg-sub">选一个技能，自动把提示词、比例、时长填好（不会直接花钱，填完自己点运行）。</div>' +
    list.map((s) =>
      '<button class="cfg-pick" data-skill="' + s.id + '" style="justify-content:flex-start;text-align:left;gap:10px">' +
      '<span style="font-size:20px;line-height:1">' + s.icon + '</span>' +
      '<span style="display:flex;flex-direction:column;gap:2px">' +
      '<b style="font-size:13px">' + escapeHtml(s.name) + '</b>' +
      '<span style="font-size:11px;color:var(--text-2)">' + escapeHtml(s.note || '') + '</span>' +
      '</span></button>').join('') +
    '<div class="cfg-actions"><button class="btn" id="skCancel">取消</button></div>';
  document.getElementById('modal').classList.add('is-on');
  el.querySelectorAll('[data-skill]').forEach((b) => {
    b.onclick = () => applySkill(id, b.dataset.skill);
  });
  const cancel = document.getElementById('skCancel');
  if (cancel) cancel.onclick = () => document.getElementById('modal').classList.remove('is-on');
}

/* 点击卡片预览区 → 大窗查看（图片/视频） */
world.addEventListener('click', (e) => {
  if (e.target.closest('.n-run, .n-del, .n-switch, [data-dl], [data-del], [data-dup], [data-chip], [data-try], [data-expand], [data-plus], [data-settype]')) return;
  const pv = e.target.closest('.n-preview');
  if (!pv) return;
  const n = get().nodes.find((x) => x.id === pv.closest('.node').dataset.id);
  const src = n?.result?.local || n?.result?.url;
  if (src) openLightbox({ ...n.result, url: src }, n.title);
});

/* ---------------- 粘贴：剪贴板图片直接变节点 ---------------- */

document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const it of items) {
    if (!it.type || !it.type.startsWith('image/')) continue;
    e.preventDefault();
    const file = it.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // 先落盘拿本机 URL（localStorage 存 dataURL 会爆）
        const up = await API.json('/api/upload', { data: reader.result });
        const r = stage.getBoundingClientRect();
        const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
        const jitter = (get().nodes.length % 6) * 32;
        const n = addNode({
          ...defaultNode('image', Math.round(c.x - NODE_W / 2 + jitter), Math.round(c.y - 120 + jitter)),
          uploadImage: up.url,
          title: '粘贴的图片',
          ratio: '9:16',
        });
        sel.clear(); sel.add(n.id);
        render(); centerOn(n.id);
        toast('剪贴板图片已变成节点，可直接写提示词生成');
      } catch (e) {
        toast('图片保存失败：' + e.message);
      }
    };
    reader.readAsDataURL(file);
    return;
  }
});

/* ---------------- @ 引用：提示词里 @ 图片节点作参考图 ---------------- */

const refMenu = document.createElement('div');
refMenu.className = 'ctx-menu ref-menu';
refMenu.innerHTML = '<div class="ctx-title">引用画布上的图片</div>';
document.body.appendChild(refMenu);

let refTarget = null;   // { nodeId, ta }

function openRefMenu(nodeId, ta) {
  const sources = get().nodes.filter((x) =>
    x.id !== nodeId && (x.result?.url || x.uploadImage) &&
    !(get().nodes.find((y) => y.id === nodeId)?.refImages ?? []).includes(x.result?.url || x.uploadImage));
  refTarget = { nodeId, ta };
  const r = ta.getBoundingClientRect();
  const list = sources.length
    ? sources.map((x) => {
        const thumb = x.result?.url || x.uploadImage;
        return `<button data-ref-name="${escapeHtml(x.title)}" data-ref-url="${escapeHtml(x.result?.url || x.uploadImage)}">
          <img src="${escapeHtml(thumb)}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:6px" />
          <span>${escapeHtml(x.title)}</span></button>`;
      }).join('')
    : '<div class="pempty">画布上还没有可引用的图片（先生成一张）</div>';
  refMenu.innerHTML = '<div class="ctx-title">引用画布上的图片</div>' + list;
  refMenu.style.left = `${Math.min(r.left, window.innerWidth - 200)}px`;
  refMenu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 200)}px`;
  refMenu.classList.add('is-on');
}

refMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ref-name]');
  if (!b || !refTarget) return;
  const { nodeId, ta } = refTarget;
  const name = b.dataset.refName;
  const url = b.dataset.refUrl;
  const n = get().nodes.find((x) => x.id === nodeId);
  if (!n) return;
  // 提示词里把末尾的 @ 替换为 @名称
  const v = ta.value;
  ta.value = v.endsWith('@') ? v.slice(0, -1) + '@' + name : v + '@' + name;
  n.prompt = ta.value;
  // 挂为参考图（去重，上限 9 张）
  const list = (n.refImages || []).includes(url) ? n.refImages : (n.refImages || []).concat([url]).slice(0, 9);
  const names = (n.refNames || []).includes(name) ? (n.refNames || []) : (n.refNames || []).concat([name]).slice(0, 9);
  updateNode(nodeId, { refImages: list, refNames: names }, { history: false });
  render();   // updateNode 只改数据，卡片要重画才会出现 @chip
  refMenu.classList.remove('is-on');
  ta.focus();
  toast(`已引用 @${name} · 共 ${list.length} 张参考图`);
});

document.addEventListener('pointerdown', (e) => {
  if (!refMenu.contains(e.target)) refMenu.classList.remove('is-on');
}, true);

/* ---------------- 键盘 ---------------- */
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    sel.clear(); render();
    return;
  }
  if (typing) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!sel.size) return;
    e.preventDefault();
    [...sel].forEach((id) => removeNode(id));
    sel.clear(); render();
  }
  if (e.key === 'Escape') { palette.classList.remove('is-on'); sel.clear(); render(); }
  if (e.key.toLowerCase() === 'f') frameNodes();
  if (e.key.toLowerCase() === 'l') $('#toolLink').click();
  if (e.key === ' ') { e.preventDefault(); }
});

/* 空格临时抓取平移：按下改光标，松开恢复 */
let spaceDown = false;
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !spaceDown) { spaceDown = true; stage.classList.add('is-pan'); } });
document.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('is-pan'); } });

/* ---------------- 杂项 ---------------- */
let tipTimer;
function toast(msg) {
  tips.textContent = msg;
  tips.classList.add('is-on');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => tips.classList.remove('is-on'), 1900);
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function setHot(id) {
  nodeEls.forEach((el, key) => el.classList.toggle('is-sel', key === id));
}
function clearHot() { nodeEls.forEach((el) => el.classList.toggle('is-sel', sel.has(el.dataset.id))); }

/* 保存提示 */
window.addEventListener('canvas:saved', () => {
  const p = $('#saveState');
  p.classList.remove('is-dirty');
  p.innerHTML = '<i></i>已保存';
});
let dirtyTimer;
subscribe((_state, reason) => {
  const p = $('#saveState');
  p.classList.add('is-dirty');
  p.innerHTML = '<i></i>保存中…';
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => {
    p.classList.remove('is-dirty');
    p.innerHTML = '<i></i>已保存';
  }, 700);

  // live 是「拖拽中的位置 / 输入框里的字 / 视口平移」，DOM 已经就地更新过，
  // 再整页重绘反而会让输入框失焦，所以跳过。
  if (reason === 'live') return;
  render();
});

/* ---------------- 资产库 / 生成历史 ↔ 画布 ---------------- */

/** 素材铺到当前视口中心，带上永久本地地址 */
window.addEventListener('canvas:place-asset', (e) => {
  const a = e.detail?.asset;
  if (!a) return;
  if (a.kind === 'audio') { toast('音频素材放到画布还没做，先在资产库里试听'); return; }

  const r = stage.getBoundingClientRect();
  const k = Number.isFinite(view.k) && view.k > 0 ? view.k : 1;
  const wx = Math.round((-view.x + r.width / 2) / k - NODE_W / 2);
  const wy = Math.round((-view.y + r.height / 2) / k - 160);

  const type = a.kind === 'video' ? 'video' : 'image';
  const n = addNode({
    ...defaultNode(type, wx, wy),
    title: a.name || '素材',
    prompt: a.prompt || '',
    status: 'done',
    progress: 100,
    result: { kind: a.kind || 'image', url: a.sourceUrl || '', local: a.url, assetId: a.id },
  });
  sel.clear();
  sel.add(n.id);
  render();
  centerOn(n.id);
  toast('素材已放到画布（本地永久地址）');
});

/** 从生成历史定位到节点 */
window.addEventListener('canvas:focus-node', (e) => {
  const id = e.detail?.id;
  if (!id) return;
  const n = get().nodes.find((x) => x.id === id);
  if (!n) { toast('这个节点已经删了，可用历史里的「＋」把结果重新放到画布'); return; }
  sel.clear();
  sel.add(id);
  render();
  centerOn(id);
});

/** 切换画布后重绘 */
window.addEventListener('canvas:reload', () => {
  $('#docName').value = get().name;
  sel.clear();
  render();
  applyView();
  cloud.renderCanvasBtn();
  if (get().nodes.length) setTimeout(() => frameNodes(), 30);
});

/* ---------------- 启动 ---------------- */
$('#docName').value = get().name;
loadServerStatus();
render();
applyView();
if (get().nodes.length) setTimeout(() => frameNodes(), 60);

// 连后端画布：打开上次用的那个；首次运行把浏览器里已有的画布整份迁到服务端。
// 失败也不拦着用 —— localStorage 还在，只是这一轮不会同步。
cloud.boot()
  .then(() => {
    $('#docName').value = get().name;
    render();
    applyView();
    if (get().nodes.length) setTimeout(() => frameNodes(), 60);
  })
  .catch((e) => {
    console.warn('[canvas] 画布后端没连上，先用本地缓存：', e);
    // 后端失败时也要把本地缓存画出来，否则一进画布是空白，看着像数据丢了
    $('#docName').value = get().name;
    render();
    applyView();
    if (get().nodes.length) setTimeout(() => frameNodes(), 60);
  });

// 兜底：后端慢或保存抖动时，首屏可能来不及画，800ms 后补一次重绘
setTimeout(() => {
  if (!document.querySelector('.node') && get().nodes.length) {
    $('#docName').value = get().name;
    render();
    applyView();
    frameNodes();
  }
}, 800);

document.getElementById('boot')?.remove();
window.addEventListener('beforeunload', saveNow);
window.addEventListener('resize', () => { applyView(); });
