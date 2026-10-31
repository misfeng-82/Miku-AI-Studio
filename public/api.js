// 类型化 API 客户端：同源 Base URL，4xx 不重试、5xx 最多重试 3 次，网络失败提示离线
const MAX_RETRIES = 3;

const MESSAGES = {
  VALIDATION: '提交的内容不合规范，请检查后重试',
  BAD_REQUEST: '请求有误，请检查输入',
  NOT_FOUND: '要访问的内容不存在',
  CONFLICT: '当前状态不允许这个操作，可能缺少前置数据',
  UPSTREAM: '上游服务出错，请稍后再试',
  RATE_LIMITED: '操作太频繁了，歇一会儿再试',
  INTERNAL: '服务器出了点问题',
};

async function request(method, path, body, attempt = 1) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (attempt < MAX_RETRIES) return request(method, path, body, attempt + 1);
    throw new Error('连不上服务器，请确认服务已启动');
  }

  if (res.status >= 500 && attempt < MAX_RETRIES) {
    await new Promise((r) => setTimeout(r, 300 * attempt));
    return request(method, path, body, attempt + 1);
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok) {
    // 服务端消息优先：它比通用映射更具体（如「还没有接入模型：点右上角…」）
    // 通用映射只在服务端没给 message 时兜底
    const err = new Error(data?.error?.message || MESSAGES[data?.error?.code] || '操作失败');
    err.code = data?.error?.code ?? 'INTERNAL';
    err.details = data?.error?.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  del: (p) => request('DELETE', p),

  meta: () => request('GET', '/api/meta'),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (b) => request('PUT', '/api/settings', b),
  testSettings: (b) => request('POST', '/api/settings/test', b),
  clearSettings: () => request('DELETE', '/api/settings'),
  styles: () => request('GET', '/api/styles'),
  templates: (target) => request('GET', `/api/templates${target ? `?target=${target}` : ''}`),
  fillTemplate: (id, vars) => request('POST', `/api/templates/${id}/fill`, { vars }),

  hot: (limit, genre, refresh) => request('GET', `/api/hot?limit=${limit}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}${refresh ? '&refresh=1' : ''}`),
  analyzeHot: (hot) => request('POST', '/api/hot/analyze', hot),
  split: (text) => request('POST', '/api/split', { text }),

  // 剧本生成（都市涅槃标准稿 · 三段式）：story → outline → episode → assemble
  genStory: (b) => request('POST', '/api/script-gen/story', b),
  genOutline: (b) => request('POST', '/api/script-gen/outline', b),
  genEpisode: (b) => request('POST', '/api/script-gen/episode', b),
  genAssemble: (b) => request('POST', '/api/script-gen/assemble', b),
  evaluate: (b) => request('POST', '/api/evaluate', b),
  checkup: (b) => request('POST', '/api/checkup', b),
  llmUsage: () => request('GET', '/api/llm/usage'),
  llmUsageReset: () => request('POST', '/api/llm/usage/reset', {}),
  llmModels: (b) => request('POST', '/api/llm/models', b),
  optimize: (b) => request('POST', '/api/optimize', b),
  analyzeCast: (b) => request('POST', '/api/cast/analyze', b),
  splitShots: (b) => request('POST', '/api/shots/split', b),
  shotsExport: (b) => request('POST', '/api/shots/export', b),
  assets: (b) => request('POST', '/api/assets', b),
  linebook: (b) => request('POST', '/api/linebook', b),
  export: (b) => request('POST', '/api/export', b),
  compare: (b) => request('POST', '/api/compare', b),
  stats: (b) => request('POST', '/api/stats', b),
  format: (b) => request('POST', '/api/format', b),
  polish: (b) => request('POST', '/api/polish', b),
  deaiScan: (b) => request('POST', '/api/deai/scan', b),
  deaiRewrite: (b) => request('POST', '/api/deai/rewrite', b),
  deaiRules: () => request('GET', '/api/deai/rules'),
  novels: () => request('GET', '/api/novels'),
  novel: (id) => request('GET', `/api/novels/${id}`),
  novelCreate: (b) => request('POST', '/api/novels', b),
  novelPatch: (id, b) => request('PATCH', `/api/novels/${id}`, b),
  novelDelete: (id) => request('DELETE', `/api/novels/${id}`),
  novelAddChapter: (id, b) => request('POST', `/api/novels/${id}/chapters`, b),
  novelSaveChapter: (id, cid, b) => request('PUT', `/api/novels/${id}/chapters/${cid}`, b),
  novelDeleteChapter: (id, cid) => request('DELETE', `/api/novels/${id}/chapters/${cid}`),
  novelCompose: (id, cid, b) => request('POST', `/api/novels/${id}/chapters/${cid}/compose`, b),
  novelScan: (id, cid) => request('GET', `/api/novels/${id}/chapters/${cid}/scan`),
  novelExport: (id) => request('GET', `/api/novels/${id}/export`),
  titles: (b) => request('POST', '/api/titles', b),
  relations: (b) => request('POST', '/api/relations', b),

  projects: () => request('GET', '/api/projects'),
  createProject: (b) => request('POST', '/api/projects', b),
  project: (id) => request('GET', `/api/projects/${id}`),
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  crawl: (id, b) => request('POST', `/api/projects/${id}/crawl`, b),
  saveProjectScript: (id, b) => request('POST', `/api/projects/${id}/script`, b),
  reportUrl: (id) => `/api/projects/${id}/report`,
};
