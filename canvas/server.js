import express from 'express';
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

// ============================================================
// 无限画布 · 服务端
// 前端只管画布，真正的生成全部在这里：提交工作流 → 轮询 → 回传结果。
//
// 生成走 AutoDL Art 的 ComfyUI 工作流 API（文档：autodl.art/docs/api/comfyui_api/）
// 两个硬性前提，写在最前面，省得排查时绕圈：
//   1) 令牌必须是「令牌管理 → 创建令牌 → 分组选 ComfyUI」生成的那把，
//      普通 LLM 分组的令牌调这里一律 403 permission_denied。
//   2) results 里的资源链接只有 24 小时有效，要留的片子必须尽快下载。
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATA_DIR = join(__dirname, 'data');
const CONFIG_FILE = join(DATA_DIR, 'config.json');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// 界面里填过的配置存在 data/config.json，优先级高于 .env：
// 这样在画布上就能换令牌，不必每次都去改文件、重启。
function readSaved() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}
const SAVED = readSaved();

const CFG = {
  baseUrl: (process.env.AUTODL_BASE_URL || 'https://autodl.art').replace(/\/+$/, ''),
  // 视频走 ComfyUI 分组令牌；图片走 LLM 分组令牌（/api/v1/images/generations）
  token: SAVED.token || process.env.AUTODL_TOKEN || '',
  llmToken: SAVED.llmToken || process.env.AUTODL_LLM_TOKEN || '',
  imageModel: SAVED.imageModel || process.env.IMAGE_MODEL || 'gpt-image-2.5-flare',
  // 文生视频（无参考图）与多图多音频视频，两个工作流
  workflowText2Video: SAVED.workflowText2Video || process.env.WORKFLOW_TEXT2VIDEO || 'minimax_h3_lightx2v_no_pic',
  workflowRefVideo: SAVED.workflowRefVideo || process.env.WORKFLOW_REFVIDEO || 'minimax_h3_image_audio_to_video_v2_15s',
  workflowImage: process.env.WORKFLOW_IMAGE || '',
  resolution: SAVED.resolution || process.env.DEFAULT_RESOLUTION || '480p竖',
  duration: Number(SAVED.duration || process.env.DEFAULT_DURATION || 15),
  pollMs: Number(process.env.POLL_MS || 4000),
  timeoutMs: Number(process.env.TIMEOUT_MS || 900000),
  forceMock: process.env.FORCE_MOCK === '1',
};

const app = express();
app.use(express.json({ limit: '16mb' }));

/* ---------------- 底层：调 AutoDL ---------------- */

async function cfFetch(method, path, body, token = CFG.token) {
  const url = `${CFG.baseUrl}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(`连不上 ${CFG.baseUrl}：${e.name === 'AbortError' ? '超时' : e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }

  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    const hint = res.status === 401 || res.status === 403 || /permission|unauthor/i.test(msg)
      ? '（令牌分组不对：AutoDL 令牌管理里新建令牌，分组要选 ComfyUI）'
      : '';
    const err = new Error(`${msg}${hint}`);
    err.status = res.status;
    throw err;
  }
  if (json?.code && json.code !== 'Success') throw new Error(json.msg || `上游返回 ${json.code}`);
  return json;
}

const TASK_STATUS = { QUEUED: 'queued', RUNNING: 'running', SUCCESS: 'done', FAILED: 'error' };

function pickResults(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => {
    if (typeof it === 'string') return { type: guessType(it), url: it };
    const url = it?.url || it?.file_url || it?.video_url || it?.image_url;
    return url ? { type: it.type || guessType(url), url } : null;
  }).filter(Boolean);
}

function guessType(url) {
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return 'image';
  if (/\.(mp3|wav|m4a|aac)(\?|$)/i.test(url)) return 'audio';
  return 'file';
}

/* ---------------- 接口 ---------------- */

// 令牌有没有 ComfyUI 权限，得真问一次才知道：
// 查一个不存在的任务——能进业务层（404）= 有权限；401/403 = 分组不对。
let permCache = null;
async function probePermission() {
  if (permCache && Date.now() - permCache.at < 60000) return permCache;
  if (!CFG.token) {
    permCache = { ok: false, reason: 'no-token', message: '没有配置 AUTODL_TOKEN', at: Date.now() };
    return permCache;
  }
  try {
    await cfFetch('GET', '/api/v1/comfyui/comfyui_workflow/result/__probe__');
    permCache = { ok: true, message: '', at: Date.now() };
  } catch (e) {
    const st = e.status;
    const msg = e.message || '';
    // 只有「鉴权被拒」才算没权限。查一个不存在的任务，上游会回
    // {"code":"InternalError","msg":"工作流不可用"} —— 那是业务错误，
    // 说明请求已经过了鉴权、进到业务层，权限是通的。
    const denied = st === 401 || st === 403 || /permission_denied|does not have permission/i.test(msg);
    if (denied) {
      permCache = { ok: false, reason: 'no-comfyui', message: '令牌缺少 ComfyUI 分组权限', at: Date.now() };
    } else if (st === 404) {
      permCache = { ok: true, message: '', at: Date.now() };
    } else {
      permCache = { ok: true, message: msg, at: Date.now() };
    }
  }
  return permCache;
}

/** 界面里改令牌 / 工作流：保存后立刻探测一次权限，把结果直接回给前端 */
app.post('/api/config', async (req, res) => {
  const { token, llmToken, imageModel, workflowText2Video, workflowRefVideo, resolution, duration } = req.body || {};

  if (typeof token === 'string' && token.trim()) CFG.token = token.trim();
  if (typeof llmToken === 'string' && llmToken.trim()) CFG.llmToken = llmToken.trim();
  if (typeof imageModel === 'string' && imageModel.trim()) CFG.imageModel = imageModel.trim();
  if (typeof workflowText2Video === 'string' && workflowText2Video.trim()) CFG.workflowText2Video = workflowText2Video.trim();
  if (typeof workflowRefVideo === 'string' && workflowRefVideo.trim()) CFG.workflowRefVideo = workflowRefVideo.trim();
  if (typeof resolution === 'string' && resolution.trim()) CFG.resolution = resolution.trim();
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) CFG.duration = Number(duration);

  // 只把自己填过的字段落盘，token 存的是明文（本机文件，别外传）
  const saved = {
    token: CFG.token,
    llmToken: CFG.llmToken,
    imageModel: CFG.imageModel,
    workflowText2Video: CFG.workflowText2Video,
    workflowRefVideo: CFG.workflowRefVideo,
    resolution: CFG.resolution,
    duration: CFG.duration,
  };
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(saved, null, 2), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: `保存失败：${e.message}` });
  }

  permCache = null;                    // 令牌换了，权限结果必须重新问
  imgModelCache = null;                // 图片令牌换了，模型列表也要重拉
  const perm = await probePermission();
  res.json({
    ok: true,
    configured: Boolean(CFG.token),
    tokenMasked: CFG.token ? `${CFG.token.slice(0, 4)}…${CFG.token.slice(-4)}` : '',
    permission: { ok: perm.ok, reason: perm.reason || null, message: perm.message || '' },
    imageTokenMasked: CFG.llmToken ? `${CFG.llmToken.slice(0, 4)}…${CFG.llmToken.slice(-4)}` : '',
    imageReady: Boolean(CFG.llmToken),
    imageModel: CFG.imageModel,
    workflows: { text2video: CFG.workflowText2Video, refVideo: CFG.workflowRefVideo },
    ready: Boolean(CFG.token) && !CFG.forceMock && perm.ok,
  });
});

// 图片模型列表：直接问 /api/v1/models 里带 image 的那些，别在前端写死
let imgModelCache = null;
async function listImageModels() {
  if (imgModelCache && Date.now() - imgModelCache.at < 300000) return imgModelCache.list;
  const fallback = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'Qwen-Image', 'Z-Image-Turbo'];
  if (!CFG.llmToken) {
    imgModelCache = { list: fallback, at: Date.now() };
    return fallback;
  }
  try {
    const out = await cfFetch('GET', '/api/v1/models', null, CFG.llmToken);
    const ids = (out?.data ?? []).map((m) => m.id).filter((id) => /image/i.test(id));
    const list = ids.length ? ids : fallback;
    imgModelCache = { list, at: Date.now() };
    return list;
  } catch {
    imgModelCache = { list: fallback, at: Date.now() };
    return fallback;
  }
}

/** multipart 版（images/edits 图生图需要传文件） */
async function cfFetchForm(path, fd) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 600000);
  let res;
  try {
    res = await fetch(`${CFG.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.llmToken}` },
      body: fd,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(`连不上 ${CFG.baseUrl}：${e.name === 'AbortError' ? '超时' : e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (json?.code && json.code !== 'Success' && !json.data) throw new Error(json.msg || `上游返回 ${json.code}`);
  return json;
}

/** 图生图：dataURL/URL 的参考图 + 提示词 → images/edits → 出图 URL */
async function editImage({ prompt, refImage, model }) {
  if (!CFG.llmToken) throw new Error('没有配置图片令牌（AUTODL_LLM_TOKEN，LLM 分组）');
  let buf, mime = 'image/png';
  if (String(refImage).startsWith('data:')) {
    const m = String(refImage).match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (!m) throw new Error('参考图 dataURL 格式不正确');
    mime = m[1];
    buf = Buffer.from(m[2], 'base64');
  } else if (refImage.startsWith('/uploads/')) {
    // 本机上传的图：直接读盘，不用网络
    const p = join(DATA_DIR, 'uploads', refImage.replace('/uploads/', ''));
    if (!existsSync(p)) throw new Error('参考图文件不存在');
    mime = extname(p).slice(1) === 'jpg' ? 'image/jpeg' : `image/${extname(p).slice(1)}`;
    buf = readFileSync(p);
  } else {
    const r = await fetch(refImage, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`参考图下载失败（HTTP ${r.status}）`);
    mime = r.headers.get('content-type') || 'image/png';
    buf = Buffer.from(await r.arrayBuffer());
  }

  const fd = new FormData();
  fd.append('model', model || CFG.imageModel);
  fd.append('prompt', String(prompt).slice(0, 3000));
  fd.append('image', new Blob([buf], { type: mime }), 'reference.png');

  const out = await cfFetchForm('/api/v1/images/edits', fd);
  const item = out?.data?.[0];
  if (!item) throw new Error(`上游没有返回图片：${JSON.stringify(out).slice(0, 160)}`);
  const url = item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
  if (!url) throw new Error('上游返回里既没有 url 也没有 b64_json');
  return { type: 'image', url, model: model || CFG.imageModel };
}

// OpenAI 兼容的图片接口：同步返回，不用轮询。
// 尺寸必须能被 16 整除（1024x1536 / 1024x1024 / 1536x1024 都合规）。
async function generateImage({ prompt, ratio, model }) {
  if (!CFG.llmToken) throw new Error('没有配置图片令牌（AUTODL_LLM_TOKEN，LLM 分组）');
  const size = ratio === '1:1' ? '1024x1024' : ratio === '16:9' ? '1536x1024' : '1024x1536';
  const useModel = model || CFG.imageModel;
  const out = await cfFetch('POST', '/api/v1/images/generations', {
    model: useModel,
    prompt: String(prompt).slice(0, 3000),
    size,
    n: 1,
  }, CFG.llmToken);
  const item = out?.data?.[0];
  if (!item) throw new Error(`上游没有返回图片：${JSON.stringify(out).slice(0, 160)}`);
  const url = item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
  if (!url) throw new Error('上游返回里既没有 url 也没有 b64_json');
  return { type: 'image', url, size, model: useModel };
}

app.get('/api/status', async (req, res) => {
  const perm = await probePermission();
  const ready = Boolean(CFG.token) && !CFG.forceMock && perm.ok;
  res.json({
    configured: Boolean(CFG.token),
    tokenMasked: CFG.token ? `${CFG.token.slice(0, 4)}…${CFG.token.slice(-4)}` : '',
    imageTokenMasked: CFG.llmToken ? `${CFG.llmToken.slice(0, 4)}…${CFG.llmToken.slice(-4)}` : '',
    imageModel: CFG.imageModel,
    imageModels: await listImageModels(),
    videoWorkflows: [
      { id: CFG.workflowText2Video, label: '文生视频（无参考图）' },
      { id: CFG.workflowRefVideo, label: '图生视频（多图多音频）' },
    ],
    imageReady: Boolean(CFG.llmToken),
    baseUrl: CFG.baseUrl,
    forceMock: CFG.forceMock,
    permission: { ok: perm.ok, reason: perm.reason || null, message: perm.message || '' },
    workflows: {
      text2video: CFG.workflowText2Video,
      refVideo: CFG.workflowRefVideo,
      image: CFG.workflowImage || '(未配置)',
    },
    defaults: { resolution: CFG.resolution, duration: CFG.duration },
    ready,
  });
});

/**
 * 工作流的参数定义（input_rules）。
 *
 * 这份东西必须问服务端，不能靠猜：
 *   - 文生视频：prompt / duration / resolution / seed
 *   - 图生视频：上面这些 + ref_image_0..8 + ref_audio_0..2
 * 参考图**不是数组**，是 9 个独立字段，名字错了上游只回一句「存在未定义的参数」。
 * 接口：GET /api/v1/comfyui/workflows/{uuid} → data.input_rules
 */
const specCache = new Map();
async function getWorkflowSpec(workflowId) {
  const hit = specCache.get(workflowId);
  if (hit && Date.now() - hit.at < 300000) return hit.rules;
  const out = await cfFetch('GET', `/api/v1/comfyui/workflows/${encodeURIComponent(workflowId)}`);
  const rules = out?.data?.input_rules ?? {};
  specCache.set(workflowId, { rules, at: Date.now() });
  return rules;
}

/** 按 input_rules 的 type 把用户输入映射到真实字段名 */
function buildWorkflowBody(rules, { prompt, refImages = [], refAudios = [], duration, resolution, seed }) {
  const keys = Object.keys(rules);
  const has = (k) => keys.includes(k);
  const body = {};

  if (has('prompt')) body.prompt = String(prompt).slice(0, 20000);

  // 图片：按字段名排序（ref_image_0, ref_image_1 …）依次填，多出来的忽略
  const imgKeys = keys.filter((k) => rules[k].type === 'image').sort();
  // AutoDL 云端要下载这些图，dataURL/内网地址它够不到，只传 http(s) 公网链接
  refImages.filter((u) => /^https?:\/\//i.test(u)).slice(0, imgKeys.length)
    .forEach((url, i) => { body[imgKeys[i]] = url; });

  const audKeys = keys.filter((k) => rules[k].type === 'audio').sort();
  (refAudios ?? []).slice(0, audKeys.length).forEach((url, i) => { body[audKeys[i]] = url; });

  if (has('duration')) {
    const r = rules.duration;
    const want = Number(duration) || r.default || 5;
    body.duration = Math.min(r.max ?? 15, Math.max(r.min ?? 1, Math.round(want)));
  }
  if (has('resolution') && resolution) body.resolution = resolution;
  if (has('seed')) body.seed = Number(seed) || Math.floor(Math.random() * 1e15);

  // 必填项没给就早点报，别让上游甩一句看不懂的话
  for (const [k, r] of Object.entries(rules)) {
    if (r.required && (body[k] === undefined || body[k] === '')) {
      throw new Error(`工作流缺少必填参数：${k}`);
    }
  }
  return body;
}

/** 提交生成任务：{ kind: 'video'|'image', prompt, refImages[], refAudios[], resolution, duration } */
app.post('/api/generate', async (req, res) => {
  try {
    const { kind = 'video', prompt, refImages = [], refAudios = [], resolution, duration } = req.body || {};
    if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: '缺少提示词' });

    if (CFG.forceMock) {
      return res.json({ taskId: `mock_${Date.now().toString(36)}`, mock: true, reason: 'FORCE_MOCK=1' });
    }

    // 图片：同步接口，一次请求就出图
    if (kind === 'image') {
      if (!CFG.llmToken) {
        return res.status(400).json({ error: '没有配置图片令牌：接 API 里填 LLM 分组的令牌（图片走 /api/v1/images/generations）' });
      }
      // 带参考图 → 图生图（images/edits）；没有 → 文生图（images/generations）
      const refImage = typeof req.body.refImage === 'string' && req.body.refImage ? req.body.refImage : null;
      // OpenAI 系模型（gpt-image-2）对中文审核极敏感，中性词也会误拦；
      // 被拦时自动换下一个图片模型重试，把列表全试一遍才报错。
      const imgList = await listImageModels();
      const picked = typeof req.body.model === 'string' && req.body.model.trim() ? req.body.model.trim() : CFG.imageModel;
      const candidates = [picked, ...imgList.filter((mm) => mm !== picked)];
      const tryOnce = async (mm) => refImage
        ? await editImage({ prompt: prompt || '按参考图生成', refImage, model: mm })
        : await generateImage({ prompt, ratio: req.body.ratio, model: mm });

      let img = null;
      let lastErr = null;
      for (const mm of candidates) {
        try {
          img = await tryOnce(mm);
          break;
        } catch (e) {
          if (/safety guidelines|restricted/i.test(e.message)) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }
          throw e;    // 非审核错误（网络/参数）直接抛
        }
      }
      if (!img) throw lastErr || new Error('所有图片模型都被审核拦截，请换提示词措辞');
      return res.json({
        taskId: `img_${Date.now().toString(36)}`,
        done: true,
        mock: false,
        status: 'done',
        results: [img],
        model: img.model,
      });
    }

    if (!CFG.token) {
      return res.json({ taskId: `mock_${Date.now().toString(36)}`, mock: true, reason: '没有配置 ComfyUI 令牌' });
    }

    const hasRefs = Array.isArray(refImages) && refImages.length > 0;
    const picked = typeof req.body.model === 'string' && req.body.model.trim() ? req.body.model.trim() : '';

    // 关键：文生视频工作流不接收 images 参数，传了也会被丢掉。
    // 只要上游挂了参考图，就必须走图生视频工作流，否则「按参考图生成」是假的。
    let workflowId = picked || (hasRefs ? CFG.workflowRefVideo : CFG.workflowText2Video);
    let switched = false;
    if (hasRefs && workflowId === CFG.workflowText2Video && CFG.workflowRefVideo) {
      workflowId = CFG.workflowRefVideo;
      switched = true;
    }

    // 先问这个工作流要哪些参数，再按真实字段名组装
    const rules = await getWorkflowSpec(workflowId);
    const body = buildWorkflowBody(rules, {
      prompt, refImages, refAudios,
      duration, resolution: resolution || CFG.resolution,
    });

    const url = `/api/v1/comfyui/comfyui_workflow/${encodeURIComponent(workflowId)}`;
    let out;
    try {
      out = await cfFetch('POST', url, body);
    } catch (e) {
      if (/safety guidelines|restricted/i.test(e.message)) {
        await new Promise((r) => setTimeout(r, 1200));
        out = await cfFetch('POST', url, body);
      } else throw e;
    }
    const taskId = out?.data?.task_id;
    if (!taskId) throw new Error(`上游没有返回 task_id（${JSON.stringify(out).slice(0, 160)}）`);

    res.json({
      taskId, mock: false, workflowId,
      status: TASK_STATUS[out.data.status] || 'queued',
      refImages: hasRefs ? refImages.length : 0,
      refFields: Object.keys(body).filter((k) => k.startsWith('ref_image')),
      switchedToRef: switched,
    });
  } catch (e) {
    const code = e.status === 403 || e.status === 401 ? 403 : 502;
    res.status(code).json({ error: e.message, needComfyuiToken: code === 403 });
  }
});

/** 查一次任务（内部函数，供 /api/generate/:id 和 /wait 共用） */
async function queryTask(id) {
  if (String(id).startsWith('mock_')) {
    const started = parseInt(String(id).split('_')[1], 36) || Date.now();
    const el = Date.now() - started;
    if (el < 1500) return { taskId: id, status: 'queued', mock: true, results: [] };
    if (el < 4000) return { taskId: id, status: 'running', mock: true, results: [] };
    return {
      taskId: id, status: 'done', mock: true,
      results: [{ type: 'mock', url: '' }],
      message: '模拟结果（没有令牌或 FORCE_MOCK=1）：链路跑通了，但没有调用模型、没有产生费用。',
    };
  }
  const out = await cfFetch('GET', `/api/v1/comfyui/comfyui_workflow/result/${encodeURIComponent(id)}`);
  const d = out?.data;
  if (!d) { const e = new Error('任务不存在或已被清理'); e.status = 404; throw e; }
  const status = TASK_STATUS[d.status] || 'unknown';
  return {
    taskId: id,
    status,
    rawStatus: d.status,
    duration: d.duration ?? null,
    message: d.message || '',
    results: status === 'done' ? pickResults(d.results) : [],
  };
}

app.get('/api/generate/:taskId', async (req, res) => {
  try {
    res.json(await queryTask(req.params.taskId));
  } catch (e) {
    res.status(e.status === 404 ? 404 : 502).json({ error: e.message });
  }
});

/** 一次等到底：前端点「运行」只发这一个请求，进度靠按钮上的秒数提示 */
app.post('/api/generate/wait', async (req, res) => {
  const { taskId } = req.body || {};
  if (!taskId) return res.status(400).json({ error: '缺少 taskId' });

  const t0 = Date.now();
  let lastError = null;
  while (Date.now() - t0 < CFG.timeoutMs) {
    try {
      const d = await queryTask(taskId);
      if (d.status === 'done' || d.status === 'error') return res.json({ ...d, elapsedMs: Date.now() - t0 });
      lastError = null;
    } catch (e) {
      lastError = e;                       // 单次失败不停，继续轮询；连续失败就抛出去
    }
    await new Promise((r) => setTimeout(r, CFG.pollMs));
  }
  if (lastError) return res.status(502).json({ error: lastError.message });
  res.json({ taskId, status: 'timeout', elapsedMs: Date.now() - t0, message: '等待超时，任务可能还在排队，稍后用 task_id 再查' });
});

/** 下载代理：把生成结果拉到本地，避免浏览器跨域与 24 小时过期 */
app.get('/api/download', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url 不合法' });
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!r.ok) return res.status(502).json({ error: `上游返回 ${r.status}` });
    const buf = Buffer.from(await r.arrayBuffer());

    // 文件名：优先从 URL 路径取，取不到就按时间戳补
    const pathname = new URL(url).pathname;
    const ext = (pathname.match(/\.(mp4|png|jpe?g|webp|mp3|wav)$/i)?.[1] || 'bin').toLowerCase();
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const name = `${stamp}_${Math.random().toString(36).slice(2, 6)}.${ext}`;

    // 顺手存一份到 data/output，别只让用户下到浏览器缓存里
    try {
      const dir = join(DATA_DIR, 'output');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), buf);
    } catch { /* 存盘失败不影响下载 */ }

    const type = ext === 'mp4' ? 'video/mp4' : ext === 'mp3' ? 'audio/mpeg' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    res.writeHead(200, {
      'content-type': type,
      'content-length': buf.length,
      'content-disposition': `attachment; filename="${name}"`,
    });
    res.end(buf);
  } catch (e) {
    res.status(502).json({ error: `下载失败：${e.message}` });
  }
});

// 开发期禁用缓存：代码改完刷新就生效，避免「明明修好了但界面还是旧的」
/** 上传图片落盘：dataURL → data/uploads/xxx.png → 返回本机 URL */
app.post('/api/upload', (req, res) => {
  const { data } = req.body || {};
  const m = String(data || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: '不是合法的图片数据' });
  const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
  if (!['png', 'jpg', 'webp'].includes(ext)) return res.status(400).json({ error: `不支持的格式 ${ext}` });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `${stamp}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  try {
    const dir = join(DATA_DIR, 'uploads');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), Buffer.from(m[2], 'base64'));
    res.json({ url: `uploads/${name}` });
  } catch (e) {
    res.status(500).json({ error: `保存失败：${e.message}` });
  }
});

app.use('/uploads', express.static(join(DATA_DIR, 'uploads')));

app.use(express.static(join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store'); },
}));

const PORT = Number(process.env.PORT) || 5180;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  无限画布 → http://127.0.0.1:${PORT}`);
  console.log(`  模型接入：${CFG.token ? `已配置（${CFG.token.slice(0, 4)}…${CFG.token.slice(-4)}）` : '未配置 AUTODL_TOKEN'}`);
  console.log(`  文生视频工作流：${CFG.workflowText2Video}`);
  console.log(`  图生视频工作流：${CFG.workflowRefVideo}\n`);
});
