/* 状态层：单一 state + 快照式撤销重做 + localStorage 持久化
 *
 * 为什么用快照而不是增量 diff：节点数量在几十级别，一次快照几 KB，
 * 换来的是「任何操作都能撤销」且不必为每种操作写逆向逻辑。
 */

const KEY = 'miku.canvas.v8';
const HISTORY_LIMIT = 60;

let state = load();
let past = [];
let future = [];
const listeners = new Set();
let saveTimer = null;

function blank() {
  return {
    name: '未命名画布',
    view: { k: 1, x: 0, y: 0 },
    nodes: [],
    edges: [],
  };
}

/** 首次打开时的示例链路：剧本 → 分镜 → 图片 → 视频
 *  不是假数据 —— 它就是普通节点，可以直接改名改词、删掉重来。 */
function demo() {
  const n = (id, type, x, y, title, prompt, extra = {}) => ({
    id, type,
    x, y,
    title,
    prompt,
    model: '',
    ratio: '',
    duration: '',
    status: 'idle',
    progress: 0,
    result: null,
    ...extra,
  });
  return {
    name: '第1集 · 厨房对峙',
    view: { k: 1, x: 0, y: 0 },
    nodes: [
      n('demo_text', 'text', 0, 0, '剧本 · 厨房对峙',
        '婆婆：这点东西够谁吃？\n媳妇：娘，我给您留了两个蛋。\n婆婆：（沉默，把碗推回去）'),
      n('demo_shot', 'shot', 380, 0, '分镜 · 三个镜头',
        '1【近景】婆婆端起碗，皱眉\n2【中景】媳妇低头，手在围裙上擦\n3【特写】碗底两个鸡蛋'),
      n('demo_img', 'image', 760, 0, '关键帧 · 碗底两个蛋',
        '厨房里，粗陶碗，碗底两个鸡蛋，暖色油灯光，真实摄影质感，特写',
        { ratio: '9:16' }),
      n('demo_video', 'video', 760, 500, '镜头 · 缓推',
        '镜头从碗底缓慢推进到媳妇的手，灯光轻微晃动，15 秒',
        { ratio: '9:16', duration: 15 }),
    ],
    edges: [
      { id: 'demo_e1', from: 'demo_text', to: 'demo_shot' },
      { id: 'demo_e2', from: 'demo_shot', to: 'demo_img' },
      { id: 'demo_e3', from: 'demo_img', to: 'demo_video' },
    ],
  };
}

// 坐标/缩放必须是有限数：脏数据一旦进 state，toWorld 会算出 NaN，
// 新节点就落在 NaN 位置（表现成「点了没反应」），且会一路污染存档。
const finite = (v, def) => (Number.isFinite(v) ? v : def);

function sanitizeNode(n) {
  if (!n || typeof n !== 'object') return null;
  return {
    ...n,
    x: finite(n.x, 0),
    y: finite(n.y, 0),
    progress: finite(n.progress, 0),
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const d = JSON.parse(raw);
    if (!Array.isArray(d.nodes)) return blank();
    const k = finite(Number(d.view?.k), 1);
    return {
      name: d.name || '未命名画布',
      view: {
        k: k > 0 ? Math.min(2.5, Math.max(0.2, k)) : 1,
        x: finite(Number(d.view?.x), 0),
        y: finite(Number(d.view?.y), 0),
      },
      nodes: d.nodes.map(sanitizeNode).filter(Boolean),
      edges: Array.isArray(d.edges) ? d.edges : [],
    };
  } catch {
    return blank();
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

export function get() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason = 'change') {
  listeners.forEach((fn) => fn(state, reason));
  scheduleSave();
}

/* ---------------- 历史 ---------------- */

/** 执行一次会进历史的变更 */
export function commit(mutator, reason = 'edit') {
  const before = clone(snapshot());
  mutator(state);
  past.push(before);
  if (past.length > HISTORY_LIMIT) past.shift();
  future = [];
  emit(reason);
}

/** 不进历史的变更（拖拽中的实时位置、视口平移缩放） */
export function touch(mutator, reason = 'live') {
  mutator?.(state);
  emit(reason);
}

function snapshot() {
  return { nodes: state.nodes, edges: state.edges, name: state.name };
}

function restore(snap) {
  state.nodes = clone(snap.nodes);
  state.edges = clone(snap.edges);
  state.name = snap.name;
}

export function undo() {
  if (!past.length) return false;
  future.push(clone(snapshot()));
  restore(past.pop());
  emit('undo');
  return true;
}

export function redo() {
  if (!future.length) return false;
  past.push(clone(snapshot()));
  restore(future.pop());
  emit('redo');
  return true;
}

export function canUndo() { return past.length > 0; }
export function canRedo() { return future.length > 0; }

/** 拖拽开始前打点：把「拖之前」的样子推进历史 */
export function mark() {
  past.push(clone(snapshot()));
  if (past.length > HISTORY_LIMIT) past.shift();
  future = [];
}

/* ---------------- 持久化 ---------------- */

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      window.dispatchEvent(new CustomEvent('canvas:saved'));
    } catch {
      /* 隐私模式/超额：本次会话仍然可用，只是不落盘 */
    }
  }, 320);
}

export function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function reset() {
  commit((s) => {
    s.nodes = [];
    s.edges = [];
  }, 'reset');
}

/* ---------------- 节点操作 ---------------- */

let seq = 0;
export function uid(prefix = 'n') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export function addNode(node) {
  const n = { id: uid('n'), status: 'idle', ...node };
  commit((s) => { s.nodes.push(n); }, 'add');
  return n;
}

export function updateNode(id, patch, { history = true } = {}) {
  const apply = (s) => {
    const n = s.nodes.find((x) => x.id === id);
    if (n) Object.assign(n, patch);
  };
  history ? commit(apply, 'update') : touch(apply);
}

export function removeNode(id) {
  commit((s) => {
    s.nodes = s.nodes.filter((n) => n.id !== id);
    s.edges = s.edges.filter((e) => e.from !== id && e.to !== id);
  }, 'remove');
}

export function moveNode(id, x, y) {
  touch((s) => {
    const n = s.nodes.find((x2) => x2.id === id);
    if (n) { n.x = x; n.y = y; }
  });
}

export function addEdge(from, to) {
  if (!from || !to || from === to) return false;
  const exists = state.edges.some((e) => e.from === from && e.to === to);
  if (exists) return false;
  commit((s) => { s.edges.push({ id: uid('e'), from, to }); }, 'edge');
  return true;
}

export function removeEdge(id) {
  commit((s) => { s.edges = s.edges.filter((e) => e.id !== id); }, 'edge-del');
}

export function setView(view) {
  touch((s) => { s.view = { ...s.view, ...view }; }, 'view');
}

export function setName(name) {
  commit((s) => { s.name = name; }, 'name');
}
