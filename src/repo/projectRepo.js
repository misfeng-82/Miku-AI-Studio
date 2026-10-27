import { randomUUID } from 'node:crypto';
import { store } from './jsonStore.js';
import { notFound, conflict } from '../errors.js';

const INDEX_KEY = 'projects-index';

// 画风预设统一取自 src/assets/stylePresets.js。
// 参考仓库 manga-studio 的教训：UI 下拉选项与提示词取用的 key 分两处维护，
// 结果国漫/韩漫等风格缺失，退化成把 id 字符串当风格词喂给模型。这里只留单一来源。
export { STYLE_PRESETS as VISUAL_STYLES } from '../assets/stylePresets.js';

export const STAGES = Object.freeze(['crawl', 'outline', 'script', 'evaluate', 'checkup', 'storyboard']);

export const STAGE_LABELS = Object.freeze({
  crawl: '抓取爆款',
  outline: '剧本生成',
  script: '剧本正文',
  evaluate: '剧本评估',
  checkup: '内容体检',
  storyboard: '剧本转分镜',
});

function emptyStage() {
  return { status: 'empty', data: null, updatedAt: null, note: '' };
}

export function newProject(input) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: input.name,
    source: input.source || '',
    genre: input.genre || '女频逆袭',
    visualStyle: input.visualStyle || 'jp-anime',
    episodes: input.episodes || 3,
    minutesPerEpisode: input.minutesPerEpisode || 2,
    seed: input.seed ?? 0,
    unifyStyle: input.unifyStyle !== false,
    stages: Object.fromEntries(STAGES.map((s) => [s, emptyStage()])),
    assets: { characters: [], scenes: [], props: [] },
    createdAt: now,
    updatedAt: now,
  };
}

export async function listProjects() {
  const idx = store.read(INDEX_KEY, { items: [] });
  const items = [];
  for (const meta of idx.items) {
    try {
      const p = store.read(`project-${meta.id}`);
      items.push(summary(p));
    } catch {
      // 索引里有、文件没了：跳过并向调用方暴露为脏索引项
      items.push({ id: meta.id, name: meta.name, missing: true });
    }
  }
  return items;
}

export async function createProject(input) {
  const p = newProject(input);
  store.write(`project-${p.id}`, p);
  // 必须 await：索引更新走的是串行队列，不等它落盘就返回，
  // 调用方紧接着「建完立刻查列表」会查不到，删除时还会误判成 404
  await store.update(INDEX_KEY, (idx) => ({
    items: [...idx.items, { id: p.id, name: p.name, createdAt: p.createdAt }],
  }), { items: [] });
  return p;
}

// 项目 id 在进存储层之前必须先校验。
// 早先 getProject 直接把 id 拼成 `project-${id}` 交给 store.read，
// 而 store.pathOf 只认 [A-Za-z0-9_-]——于是 /api/projects/..%2f..%2fetc%2fpasswd
// 这类脏 id 会在 pathOf 里抛 internalError，被兜成 500。
// 脏 id 的本质是「查不到这个项目」，就该是 404，不是服务器错误。
const PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function getProject(id) {
  if (typeof id !== 'string' || !PROJECT_ID_RE.test(id)) throw notFound(`项目 ${id} 不存在`);
  try {
    return store.read(`project-${id}`);
  } catch (err) {
    if (err.code === 'NOT_FOUND') throw notFound(`项目 ${id} 不存在`);
    throw err;
  }
}

export async function saveProject(p) {
  p.updatedAt = new Date().toISOString();
  store.write(`project-${p.id}`, p);
  // 同样必须 await：否则改名后立刻查列表可能还是旧名字
  await store.update(INDEX_KEY, (idx) => ({
    items: idx.items.map((it) => (it.id === p.id ? { ...it, name: p.name } : it)),
  }), { items: [] });
  return p;
}

// 阶段写入：只有这里能改 stage，保证状态流转集中、可审计
export async function setStage(id, stage, data, status = 'draft', note = '') {
  if (!STAGES.includes(stage)) throw conflict(`未知阶段 ${stage}`);
  return store.update(`project-${id}`, (p) => {
    p.stages[stage] = { status, data, note, updatedAt: new Date().toISOString() };
    p.updatedAt = new Date().toISOString();
    return p;
  });
}

export async function setAssets(id, assets) {
  return store.update(`project-${id}`, (p) => {
    p.assets = assets;
    p.updatedAt = new Date().toISOString();
    return p;
  });
}

export async function deleteProject(id) {
  // 软删除：只删索引项，正文文件保留在磁盘上，误删可找回。
  // 但索引里没有这一项时必须明确报 404——静默返回成功会让调用方以为真删掉了。
  // 注意这里只碰 INDEX_KEY，不拿 id 拼文件名，所以脏 id 最多是「查不到」，
  // 不会走到文件系统上（pathOf 的白名单校验也就不会被脏 id 触发成 500）。
  const exists = store.read(INDEX_KEY, { items: [] }).items.some((it) => it.id === id);
  if (!exists) throw notFound(`项目 ${id} 不存在`);
  await store.update(INDEX_KEY, (idx) => ({ items: idx.items.filter((it) => it.id !== id) }), { items: [] });
  return true;
}

export function summary(p) {
  const done = STAGES.filter((s) => p.stages?.[s]?.status === 'ready' || p.stages?.[s]?.status === 'draft').length;
  return {
    id: p.id,
    name: p.name,
    genre: p.genre,
    visualStyle: p.visualStyle,
    episodes: p.episodes,
    minutesPerEpisode: p.minutesPerEpisode,
    progress: Math.round((done / STAGES.length) * 100),
    score: p.stages?.evaluate?.data?.score ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
