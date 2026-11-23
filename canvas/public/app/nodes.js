/* 节点类型定义与卡片模板
 *
 * 六种节点对应一条短剧生产链：
 *   文本/剧本 → 脚本分镜 → 图片生成 → 视频生成 → 音频生成 → 智能剪辑
 * 生成类节点（图片/视频）的布局照搬 LibTV：
 *   大预览区在上 + 底部参数面板（chips 行 / 提示词 / 模型比例时长 / 发送）
 * 参考图不是数组：AutoDL 用 ref_image_0..8 / ref_audio_0..2 的独立字段。
 */

export const TYPES = {
  text: {
    label: '文本 / 剧本',
    color: '#10B981',
    icon: 'M5 5h14M12 5v14M8 19h8',
    hasPreview: false,
    placeholder: '写下这一场戏的台词与动作，一行一句',
  },
  shot: {
    label: '脚本分镜',
    color: '#EF4444',
    icon: 'M4 5h16v14H4zM8 5v14M16 5v14',
    hasPreview: false,
    placeholder: '镜头序号 + 景别 + 画面内容，例如：\n1【近景】婆婆端起碗\n2【中景】媳妇低头不语',
  },
  image: {
    label: '图片生成',
    color: '#3B82F6',
    icon: 'M3 4h18v16H3z',
    hasPreview: true,
    placeholder: '描述要生成的图片内容',
    models: ['Seedream 4.0', '即梦 3.0', 'Flux.1', 'SDXL'],
    ratios: ['9:16', '3:4', '1:1', '16:9'],
  },
  video: {
    label: '视频生成',
    color: '#8B5CF6',
    icon: 'M4 5h16v14H4zM10 9l6 3-6 3z',
    hasPreview: true,
    placeholder: '描述镜头运动与画面变化',
    models: ['MiniMax-H3', '可灵 2.0', '即梦视频', 'Wan 2.2'],
    ratios: ['9:16', '16:9', '1:1'],
    durations: [5, 10, 15],
  },
  audio: {
    label: '音频生成',
    color: '#F59E0B',
    icon: 'M9 18V6l10-2v12',
    hasPreview: true,
    placeholder: '要合成的台词或旁白',
    models: ['旁白男声', '旁白女声', '角色音色 A', '环境音'],
  },
  edit: {
    label: '智能剪辑',
    color: '#111827',
    icon: 'M6 4l12 8-12 8z',
    hasPreview: true,
    placeholder: '剪辑要求，例如：按分镜顺序拼接，去掉静帧超过 2 秒的镜头',
    models: ['自动成片', '卡点混剪'],
  },
};

const MODEL_OPTS = (list, current) => (list ?? [])
  .map((m) => `<option${m === current ? ' selected' : ''}>${m}</option>`).join('');

/**
 * 下拉里的可选项来自服务端真实能力，不在前端写死：
 *   imageModels    ← /api/v1/models 里筛出来的图片模型
 *   videoWorkflows ← ComfyUI 工作流（id 是真正提交的那个 ID）
 */
export const CATALOG = {
  imageModels: ['gpt-image-2.5-flare'],
  imageDefault: 'gpt-image-2.5-flare',
  videoWorkflows: [],   // [{ id, label }]
};

export function setModelCatalog({ imageModels, imageDefault, videoWorkflows }) {
  if (Array.isArray(imageModels) && imageModels.length) CATALOG.imageModels = imageModels;
  if (imageDefault) CATALOG.imageDefault = imageDefault;
  if (Array.isArray(videoWorkflows) && videoWorkflows.length) CATALOG.videoWorkflows = videoWorkflows;
}

/** 图片：直接是模型 ID；视频：值是工作流 ID，显示用 label */
function modelOptions(type, current) {
  if (type === 'image') {
    const cur = CATALOG.imageModels.includes(current)
      ? current
      : (CATALOG.imageDefault || CATALOG.imageModels[0]);
    return MODEL_OPTS(CATALOG.imageModels, cur);
  }
  if (type === 'video') {
    const list = CATALOG.videoWorkflows;
    if (!list.length) return '';
    const sel = current || list[0].id;
    return list.map((w) => `<option value="${w.id}"${w.id === sel ? ' selected' : ''}>${w.label}</option>`).join('');
  }
  return '';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** 新建节点时的默认数据 */
export function defaultNode(type, x, y) {
  const t = TYPES[type] ?? TYPES.text;
  return {
    type,
    x,
    y,
    title: t.label,
    prompt: '',
    model: (type === 'image' || type === 'video') ? '' : (t.models?.[0] ?? ''),
    ratio: t.ratios?.[0] ?? '',
    duration: t.durations?.[1] ?? '',
    status: 'idle',      // idle | running | done | error
    progress: 0,
    result: null,        // 运行后的产出 { kind, url }
  };
}

const el = (tag, cls, html) => { const x = document.createElement(tag); if (cls) x.className = cls; if (html != null) x.innerHTML = html; return x; };

const BADGE = {
  idle: '',
  running: '<span class="n-badge run">生成中</span>',
  done: '<span class="n-badge done">已完成</span>',
  error: '<span class="n-badge err">失败</span>',
};

/** 卡片完整 HTML */
export function nodeHTML(n) {
  const t = TYPES[n.type] ?? TYPES.text;
  const badge = BADGE[n.status] ?? '';
  const isGen = n.type === 'image' || n.type === 'video';

  if (isGen) return genNodeHTML(n, t, badge);

  // —— 文本 / 分镜等非生成节点 ——
  const body = el('div', 'n-body');
  if (n.type === 'text') {
    body.innerHTML = `<textarea class="n-area" data-f="text" placeholder="${esc(t.placeholder)}">${esc(n.text ?? '')}</textarea>`;
  } else {
    body.innerHTML = `<div class="n-empty-line">${esc(t.placeholder)}</div>`;
  }

  const d = el('div', 'node' + (sel === n.id ? ' sel' : ''));
  d.dataset.id = n.id;
  d.style.cssText = `left:${n.x}px;top:${n.y}px;width:${n.w}px`;
  d.appendChild(el('div', 'n-head',
    `<span class="tag ${n.type === 'text' ? 'txt' : 'img'}">${t.label}</span><span class="n-title">${esc(n.title)}</span>`));
  d.appendChild(body);
  d.appendChild(el('div', 'port in'));
  d.appendChild(el('div', 'port out'));
  d.appendChild(el('button', 'n-plus', '+'));
  d.querySelector('.n-plus').dataset.plus = 'out';
  return d;
}

/** 生成节点的预览区**内容**（不含 .n-preview 容器）
 *  容器统一由 genNodeHTML 提供，main.js 增量刷新时也只换 innerHTML，
 *  这样不会出现 `.n-preview` 套 `.n-preview` 的双层结构（会把内容压在一起）。
 */
export function genPreviewHTML(n, t) {
  const isVideo = n.type === 'video';
  // local 是转存到本机资产库之后的永久地址，优先用；远程链接只有 24 小时
  const src = n.result?.local || n.result?.url || '';

  if (src) {
    const inner = n.result.kind === 'video'
      ? `<video src="${esc(src)}" muted loop playsinline preload="metadata"></video><span class="play-badge">▶</span>`
      : `<img src="${esc(src)}" alt="" />`;
    return `${inner}<div class="prog"><i style="width:${n.progress || 0}%"></i></div>`;
  }

  if (n.uploadImage) {
    return `<img src="${esc(n.uploadImage)}" alt="" /><div class="prog"><i style="width:${n.progress || 0}%"></i></div>`;
  }

  if (n.status === 'error') {
    return `<div class="ph err">${svg('M12 9v4M12 17h.01')}<span>生成失败</span></div>
      <div class="prog"><i style="width:0%"></i></div>`;
  }

  // 空态：占位居中 + 底部一行试用按钮
  return `<div class="ph">${svg(t.icon)}<span>空${t.label}节点</span></div>
    <div class="n-try">
      <button data-try="img2img">⬆ 图生图</button>
      <button data-try="hd">🖼 图片高清</button>
    </div>
    <div class="prog"><i style="width:${n.progress || 0}%"></i></div>`;
}

/**
 * 生成类节点（图片 / 视频）：布局照搬 LibTV。
 * 大预览区在上（占大头）+ 底部参数面板（chips / 提示词 / 模型比例时长 / 发送）。
 * 选中时节点上方浮出工具条（下载 / 删除）。
 */
let sel = null;   // 由 main.js 通过 setSel 注入选中状态，渲染时用

export function setSel(v) { sel = v; }

function genNodeHTML(n, t, badge) {
  const isVideo = n.type === 'video';
  const hasResult = Boolean(n.result?.local || n.result?.url);
  const seq = n.seq ?? '';

  // ---- 预览区（渲染逻辑在下方 genPreviewHTML，含上传图/结果/错误） ----
  const pv = genPreviewHTML(n, t);

  // ---- 参考图 chip：@名称，点右侧 × 可移除（重新引用从「@」或「画布参考」再加） ----
  const refNames = n.refNames ?? [];
  const refCount = Math.max((n.refImages ?? []).length, refNames.length);
  const refChips = Array.from({ length: refCount }, (_, i) => {
    const nm = refNames[i] || `参考图 ${i + 1}`;
    return `<button class="chip ref" data-refdel="${i}" title="点击移除这条引用">@${esc(nm)}<b>×</b></button>`;
  }).join('');

  return `
    <div class="n-head" data-drag>
      <i class="n-type" style="background:${t.color}"></i>
      <span class="n-title">${esc(t.label)}${seq ? ` ${seq}` : ''}</span>
      <span class="n-badge-slot">${badge}</span>
    </div>
    <div class="n-switch">
      <button data-settype="image" class="${n.type === 'image' ? 'is-on' : ''}">图片</button>
      <button data-settype="video" class="${n.type === 'video' ? 'is-on' : ''}">视频</button>
    </div>
    <div class="n-preview" data-preview title="点击放大">${pv}</div>
    <div class="n-params">
      <div class="n-chips">
        <button data-chip="upload" title="上传本地图片作为参考">＋ 上传</button>
        <button data-chip="canvasref" title="引用画布上其他节点的结果">🖼 画布参考</button>
        <button data-chip="style" title="追加预设风格到提示词">🎨 风格</button>
        <button data-chip="skill" title="套用技能预设（自动填提示词和参数）">⚡ 技能</button>
        <span class="n-flex"></span>
        <button class="n-expand" data-expand title="放大查看">⛶</button>
      </div>
      ${refChips ? `<div class="n-refline">${refChips}</div>` : ''}
      <div class="n-prompt-wrap">
        <textarea class="n-prompt" data-f="prompt" title="双击可放大编辑" placeholder="可直接文字生图，或上传图片输入文字指令对图片进行编辑，如：将背景改为夜晚">${esc(n.prompt)}</textarea>
        <button class="n-prompt-zoom" data-pzoom="1" title="放大编辑（也可双击文本框）">⛶</button>
      </div>
      ${n.status === 'error' && n.error ? `<div class="n-error" title="${esc(n.error)}">${esc(n.error)}</div>` : ''}
      <div class="n-paramrow">
        <select class="n-pmodel" data-f="model">${modelOptions(n.type, n.model)}</select>
        <span class="n-psep"></span>
        <select class="n-pratio" data-f="ratio">
          ${(isVideo ? ['9:16', '16:9', '1:1'] : ['9:16', '3:4', '1:1', '16:9'])
            .map((x) => `<option${(n.ratio || '9:16') === x ? ' selected' : ''}>${x}</option>`).join('')}
        </select>
        ${isVideo ? `<select class="n-pdur" data-f="duration">
          ${(TYPES.video.durations ?? [5, 10, 15]).map((x) => `<option${(Number(n.duration) || 15) === x ? ' selected' : ''}>${x}</option>`).join('')}
        </select>` : ''}
        <span class="n-flex"></span>
        <button class="n-send ${n.status === 'running' ? 'is-run' : ''}" data-run
          title="${n.status === 'running' ? '生成中，进度见进度条' : '运行'}">${n.status === 'running' ? '生成中…' : '运行'}</button>
      </div>
    </div>
    <div class="n-tools">
      ${hasResult ? `<button data-dl title="下载到本地">${svg('M12 3v11M7.5 9.5l4.5 4.5 4.5-4.5M5 19h14')}</button>` : ''}
      <button data-dup title="复制这个节点">${svg('M8.5 8.5h10v10h-10z M5.5 14.5V4.5h9.5')}</button>
      <button data-del title="删除节点">${svg('M6 6l12 12M18 6L6 18')}</button>
    </div>
    <div class="port in" data-port="in"></div>
    <div class="port out" data-port="out"></div>
    <button class="n-plus" data-plus="out" title="从这里接一个节点（引用当前结果）">+</button>`;
}

export function previewHTML(n, t) {
  // 统一走 genPreviewHTML：包含 结果图/视频、上传图、mock、错误 全部分支
  return genPreviewHTML(n, t);
}

function svg(path) {
  return `<svg viewBox="0 0 24 24"><path d="${path}"/></svg>`;
}

/** 服务端返回 mock 时的占位图 */
export function mockPlaceholder(n) {
  const seed = [...n.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (seed * 37) % 360;
  return {
    kind: 'mock',
    url: '',
    mock: true,
    css: `linear-gradient(135deg,hsl(${hue} 46% 34%),hsl(${(hue + 48) % 360} 52% 62%) 60%,hsl(${(hue + 96) % 360} 40% 78%))`,
  };
}

/** 预设风格：点「风格」chip 循环切换，追加到提示词 */
export const STYLE_PRESETS = ['', '真实摄影质感', '电影级构图与光影', '动漫风格', '水墨画', '赛博朋克'];

/**
 * 技能预设：点节点上的「⚡ 技能」弹出，选中后自动填提示词 / 比例 / 时长。
 * needRefs = 需要几张参考图（用 @ 引用或「画布参考」挂上）；不满足会提示，不会拦住不跑。
 */
export const SKILLS = [
  {
    id: 'char3v', name: '角色三视图', type: 'image', icon: '🧍', ratio: '9:16', needRefs: 0,
    note: '白底正侧背三视角，用来锁人物',
    prompt: '同一角色的三视图：正面、侧面、背面，纯白背景，全身站姿，三张里的发型、脸型、服装完全一致，写实摄影风格，细节清晰',
  },
  {
    id: 'char-shot', name: '人物定妆照', type: 'image', icon: '📸', ratio: '9:16', needRefs: 0,
    note: '单人半身/全身剧照，光线干净',
    prompt: '写实人物定妆照：单人，自然站姿，浅景深，柔和侧光，纯色背景，面部特征清晰，电影质感，1920×1080 高清',
  },
  {
    id: 'scene', name: '场景空镜', type: 'image', icon: '🏠', ratio: '16:9', needRefs: 0,
    note: '没有人物的环境镜头',
    prompt: '写实室内场景空镜，无人物，黄昏暖光从窗口斜射进来，材质细节丰富，电影镜头感，横构图',
  },
  {
    id: 'composite', name: '剧照合成（人物+场景）', type: 'image', icon: '🎬', ratio: '9:16', needRefs: 1,
    note: '要 1 张参考图，把人物放进场景',
    prompt: '把参考图里的人物自然地放进这个场景：保持人物的脸型、发型、服装完全不变，补上场景光影和接触阴影，写实电影剧照质感',
  },
  {
    id: 'retouch', name: '局部微调（主体不变）', type: 'image', icon: '✏️', ratio: '9:16', needRefs: 1,
    note: '要 1 张参考图，只改描述的那一处',
    prompt: '保持参考图的主体、构图、人物长相与服装不变，只按描述做局部调整，其余部分不要改动，光影自然衔接',
  },
  {
    id: 'vid-single', name: '单图出片（首帧锁定）', type: 'video', icon: '🎞️', ratio: '9:16', duration: 10, needRefs: 1,
    note: '要 1 张参考图，人物和场景都跟着图走',
    prompt: '镜头缓慢推近，人物自然呼吸、轻微转头，背景光影稳定，写实电影感，动作克制不夸张',
  },
  {
    id: 'vid-multi', name: '多图参考出片', type: 'video', icon: '🎥', ratio: '9:16', duration: 15, needRefs: 2,
    note: '要 2 张以上（人物+场景），两者都锁住',
    prompt: '人物在场景中自然对话，镜头轻微横移，环境光随动作变化，写实电影质感，口型与台词节奏一致',
  },
];
