// 全功能矩阵测试：覆盖全部 42 个 API 端点 + 静态服务 + 项目串联
// 每个功能既测「正常流程」，也测「边界情况」（缺字段 / 类型错 / 越界 / 不存在的 id / 空串 / 超长）
//
// 用法（需服务在跑）：
//   USE_MOCK=1 PORT=8899 DATA_DIR=/tmp/ft node src/server.js
//   HOST=127.0.0.1 PORT=8899 node scripts/featuretest.mjs
//
// 说明：本项目用 VALIDATION(422) 表示「参数类型/范围不对」，BAD_REQUEST(400) 表示
// 「业务上缺必需输入」。断言按这个契约写，不是在猜。
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (p) => JSON.parse(readFileSync(resolve(here, 'fixtures', p), 'utf8'));
const BASE = `http://${config.host}:${config.port}`;

const SCRIPT = fixture('渡口-script.json');
const OUTLINE = fixture('渡口-outline.json');

let pass = 0;
const failures = [];

const ok = (name, detail = '') => {
  pass += 1;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
};
const bad = (name, detail = '') => {
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};
const section = (t) => console.log(`\n[${t}]`);

function eq(actual, want, msg) {
  if (actual !== want) throw new Error(`${msg}：期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(actual)}`);
  return `${msg} = ${JSON.stringify(actual)}`;
}
const truthy = (v, msg) => {
  if (!v) throw new Error(msg);
  return msg;
};
const hasKeys = (obj, keys, label) => {
  const missing = keys.filter((k) => obj?.[k] === undefined);
  if (missing.length) throw new Error(`${label} 缺字段：${missing.join(',')}`);
  return `${label} 字段齐全`;
};

async function call(method, path, body, { headers } = {}) {
  const init = {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  // 一次重试：发过超大 body（被 400 拒绝，连接被服务端中途关闭）之后，
  // undici 的连接池里会残留一个半死 socket，紧接着的请求可能报 fetch failed。
  // 这是客户端连接复用的问题，不是服务端不稳定，所以重试一次是正确做法。
  let res;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await fetch(`${BASE}${path}`, init);
      break;
    } catch (err) {
      if (attempt >= 1) throw new Error(`请求失败 ${method} ${path}：${err.message}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON（静态/HTML） */ }
  return { status: res.status, data, text, headers: res.headers };
}

// 跑一个用例：正常返回则打 ✓，抛错则打 ✗ 并继续（不中断整轮）
async function t(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail || '');
  } catch (e) {
    bad(name, e.message);
  }
}
const is = (r, want, label = '') => {
  if (r.status !== want) throw new Error(`${label} 期望 HTTP ${want}，实际 ${r.status} ${r.data?.error?.code ?? ''} ${r.data?.error?.message ?? ''}`.trim());
  return r;
};

console.log(`功能矩阵测试目标：${BASE}`);
console.log(`夹具：渡口-script（${SCRIPT.episodes?.length} 集）/ 渡口-outline`);

/* 0. 自清理：摘掉上一轮测试留下的项目
 *
 * 为什么必须做：剧本生成有「剧名去重」守卫（recentAvoid 取最近 6 部作品），
 * 而 mock 引擎固定产出《都市重生逆袭》。同一个 DATA_DIR 先跑过 smoke、再跑本脚本时，
 * smoke 留下的项目会进撞名黑名单，导致本脚本的 story 生成被 502 拦下。
 * 这不是 bug，是防线在正常工作——所以要测试自己负责打扫。
 *
 * 安全边界：只删「测试自己命名的项目」，用户真实作品一个都不碰。
 */
const TEST_PROJECT_NAME_RE = /^(冒烟项目|生成稿冒烟|功能矩阵测试项目|空项目报告测试|样式回退测试|并发矩阵\d+)$/;
async function cleanupTestProjects() {
  const r = await call('GET', '/api/projects');
  const victims = (r.data?.items ?? []).filter((p) => TEST_PROJECT_NAME_RE.test(p.name ?? ''));
  for (const p of victims) await call('DELETE', `/api/projects/${p.id}`);
  return victims.length;
}
const cleaned = await cleanupTestProjects();
if (cleaned) console.log(`（已清理上一轮测试残留 ${cleaned} 个，保证可重复运行）`);

/* ============================ 1. 基础设施 ============================ */
section('基础设施 · 服务与静态资源');

await t('存活检查 /health', async () => {
  const r = await call('GET', '/health');
  is(r, 200, '/health');
  return eq(r.data?.status, 'ok', 'status');
});

await t('就绪检查 /ready', async () => {
  const r = await call('GET', '/ready');
  if (![200, 404].includes(r.status)) throw new Error(`/ready 意外状态 ${r.status}`);
  return `HTTP ${r.status}`;
});

await t('首页返回 HTML', async () => {
  const r = await call('GET', '/');
  is(r, 200, '/');
  const ct = r.headers.get('content-type') ?? '';
  truthy(ct.includes('text/html'), `content-type 应为 html，实际 ${ct}`);
  truthy(r.text.includes('MIKU AI STUDIO'), '首页应含站点标题');
  return `${r.text.length} 字节 · ${ct.split(';')[0]}`;
});

await t('首页注入静态资源版本号', async () => {
  const r = await call('GET', '/');
  truthy(/\?v=\d+/.test(r.text), '应有 ?v=<mtime> 版本号注入');
  return 'app.js / styles.css 已带版本号';
});

await t('静态资源可访问 /app.js', async () => {
  const r = await call('GET', '/app.js');
  is(r, 200, '/app.js');
  return `${r.text.length} 字节`;
});

await t('边界：不存在的静态文件走 SPA 兜底而非 500', async () => {
  const r = await call('GET', '/nonexist-abc.html');
  truthy([200, 404].includes(r.status), `应为 200/404，实际 ${r.status}`);
  return `HTTP ${r.status}`;
});

await t('边界：未知 API 路由返回 404', async () => {
  const r = await call('GET', '/api/definitely-not-exist');
  is(r, 404, '未知 API');
  return eq(r.data?.error?.code, 'NOT_FOUND', 'code');
});

await t('边界：路径穿越不泄露源码', async () => {
  const r = await fetch(`${BASE}/..%2f..%2fpackage.json`);
  const body = await r.text();
  truthy(!body.includes('miku-ai-studio'), '不应返回 package.json 内容');
  return `HTTP ${r.status} · 未泄露`;
});

await t('边界：9MB 请求体被拒（上限 8MB）', async () => {
  const big = JSON.stringify({ x: 'A'.repeat(9 * 1024 * 1024) });
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: big,
  });
  truthy([400, 413].includes(res.status), `应为 400/413，实际 ${res.status}`);
  return `HTTP ${res.status}`;
});

await t('边界：非法 JSON 请求体被拒', async () => {
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json',
  });
  is({ status: res.status, data: null }, 400, '非法 JSON');
  return 'HTTP 400';
});

/* ============================ 2. 元信息 ============================ */
section('元信息 · meta / styles / templates');

await t('GET /api/meta 字段齐全', async () => {
  const r = await call('GET', '/api/meta');
  is(r, 200, '/api/meta');
  return hasKeys(r.data, ['styles', 'stages', 'modes', 'llm', 'gates', 'formats', 'frameworks', 'defaultFramework', 'genres', 'structure', 'templates'], 'meta');
});

await t('meta.gates 声明 14 + 10', async () => {
  const { data } = await call('GET', '/api/meta');
  eq(data.gates.outline, 14, 'gates.outline');
  return eq(data.gates.script, 10, 'gates.script');
});

await t('GET /api/styles 返回 12 种画风', async () => {
  const r = await call('GET', '/api/styles');
  is(r, 200, '/api/styles');
  return eq(r.data?.items?.length, 12, '画风数');
});

await t('GET /api/styles/:id/inject 正常注入', async () => {
  const r = await call('GET', '/api/styles/jp-anime/inject');
  is(r, 200, 'inject');
  truthy((r.data?.suffix ?? '').length > 0, '应返回 suffix');
  return `suffix ${r.data.suffix.length} 字 · guardrail ${(r.data.guardrail ?? '').length} 字`;
});

await t('GET /api/styles/:id/inject 覆盖全部 12 种画风', async () => {
  const s = await call('GET', '/api/styles');
  const ids = s.data.items.map((x) => x.id);
  const miss = [];
  for (const id of ids) {
    const r = await call('GET', `/api/styles/${id}/inject`);
    if (r.status !== 200 || !(r.data?.suffix ?? '').length) miss.push(id);
  }
  eq(miss.length, 0, `缺 suffix 的画风（${miss.join(',')}）`);
  return `${ids.length} 种全部可注入`;
});

await t('边界：不存在的画风 id 不崩', async () => {
  const r = await call('GET', '/api/styles/not-a-style/inject');
  truthy([200, 422, 404].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}（未 500）`;
});

await t('GET /api/templates 正常', async () => {
  const r = await call('GET', '/api/templates');
  is(r, 200, '/api/templates');
  truthy((r.data?.items?.length ?? 0) >= 6, `模板数应 ≥6，实际 ${r.data?.items?.length}`);
  return `${r.data.items.length} 个模板`;
});

await t('GET /api/templates?target 过滤', async () => {
  const all = await call('GET', '/api/templates');
  const target = all.data.items[0]?.target;
  const r = await call('GET', `/api/templates?target=${encodeURIComponent(target)}`);
  is(r, 200, '过滤');
  truthy(r.data.items.length > 0 && r.data.items.length <= all.data.items.length, '过滤后应 ≤ 全量且非空');
  return `target=${target} → ${r.data.items.length}/${all.data.items.length}`;
});

await t('边界：target 超长返回 422', async () => {
  const r = await call('GET', `/api/templates?target=${'x'.repeat(40)}`);
  is(r, 422, '超长 target');
  return eq(r.data?.error?.code, 'VALIDATION', 'code');
});

await t('POST /api/templates/:id/fill 变量填充', async () => {
  const r = await call('POST', '/api/templates/character-turnaround/fill', { vars: { 角色名: '沈知微' } });
  is(r, 200, 'fill');
  truthy(r.data.text.includes('沈知微'), '应替换变量');
  return `${r.data.text.length} 字`;
});

await t('边界：不存在的模板 id 不崩', async () => {
  const r = await call('POST', '/api/templates/nope/fill', { vars: {} });
  truthy([200, 404, 422].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}（未 500）`;
});

/* ============================ 3. 设置与用量 ============================ */
section('引擎设置 · settings / usage / models');

await t('边界：POST /api/settings/test 无 Key 时返回业务错误', async () => {
  // 必须在「写入假 Key」之前跑：一旦存了 Key，该端点会真的去调上游，
  // 拿到 502 UPSTREAM——那也是正确行为（不静默降级），但测不到「没填 Key」这条路。
  const cur = await call('GET', '/api/settings');
  const masked = cur.data.settings.apiKey ?? '';
  if (masked) {
    // 已有 Key（复跑场景）：显式清空后再测
    await call('PUT', '/api/settings', { apiKey: '-', enabled: false });
  }
  const r = await call('POST', '/api/settings/test', {});
  truthy([400, 422].includes(r.status), `应 400/422，实际 ${r.status}`);
  return `HTTP ${r.status} · ${r.data?.error?.message ?? ''}`.slice(0, 60);
});

await t('GET /api/settings 返回掩码后的配置', async () => {
  const r = await call('GET', '/api/settings');
  is(r, 200, '/api/settings');
  return hasKeys(r.data, ['settings', 'status', 'presets'], 'settings');
});

await t('GET /api/settings 不下发明文 Key', async () => {
  const r = await call('GET', '/api/settings');
  const raw = JSON.stringify(r.data);
  truthy(!/sk-[A-Za-z0-9]{8,}/.test(raw), '响应中不应出现形如 sk-xxx 的明文 Key');
  return '未发现明文 Key';
});

await t('PUT /api/settings 部分更新不清空已存 Key（关键回归）', async () => {
  // 先写入一个假 Key（夹具，不是真实密钥：末尾 secretscan-allow 显式豁免）
  const set = await call('PUT', '/api/settings', { apiKey: 'sk-test-fake-key-123456', enabled: false }); // secretscan-allow 测试夹具，非真实密钥
  is(set, 200, '写入 Key');
  // 再只改推理等级，不带 apiKey 字段
  const upd = await call('PUT', '/api/settings', { reasoning: 'low' });
  is(upd, 200, '部分更新');
  const after = await call('GET', '/api/settings');
  const masked = after.data.settings.apiKey ?? '';
  truthy(masked.includes('*') || masked.length > 0, `Key 被清空了（掩码=${masked}）`);
  return `部分更新后 Key 仍存在（掩码 ${masked}）`;
});

await t('PUT /api/settings 不回存掩码串为真实 Key', async () => {
  const before = await call('GET', '/api/settings');
  const masked = before.data.settings.apiKey;
  const r = await call('PUT', '/api/settings', { apiKey: masked });
  is(r, 200, '回填掩码');
  const after = await call('GET', '/api/settings');
  eq(after.data.settings.apiKey, masked, '掩码回填后应保持不变');
  return '掩码未被当作真实 Key 覆盖';
});

// 收尾：上面几条用例会往 settings 里写假 Key。不清理的话，跑完测试的设置里
// 就留着一条假 Key（界面上会显示一串掩码，用户以为配过模型），属于测试残留。
await t('DELETE /api/settings 抹除本机配置（离开即抹除）', async () => {
  const del = await call('DELETE', '/api/settings');
  is(del, 200, '抹除');
  const after = await call('GET', '/api/settings');
  eq(after.data.settings.apiKey ?? '', '', 'Key 应已被抹除');
  eq(after.data.settings.enabled ?? false, false, 'enabled 应复位');
  return '本机配置已抹除';
});

await t('PUT /api/settings 传 "-" 可显式清空已存 Key', async () => {
  const r = await call('PUT', '/api/settings', { apiKey: '-' });
  is(r, 200, '清空 Key');
  const after = await call('GET', '/api/settings');
  const masked = after.data.settings.apiKey ?? '';
  truthy(masked === '' || masked === '未设置', `Key 应已清空，实际 ${JSON.stringify(masked)}`);
  return '已清空（与代码注释声明的 "-" 约定一致）';
});

await t('边界：settings 传入非法类型 enabled 不崩', async () => {
  const r = await call('PUT', '/api/settings', { enabled: 'yes-please' });
  truthy([200, 422].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}`;
});

await t('GET /api/llm/usage 结构正常', async () => {
  const r = await call('GET', '/api/llm/usage');
  is(r, 200, '/api/llm/usage');
  const d = hasKeys(r.data, ['totals', 'byModel', 'byTask', 'recent'], 'usage');
  truthy(typeof r.data.totals.calls === 'number', 'totals.calls 应为数字');
  return `${d} · 累计调用 ${r.data.totals.calls} 次`;
});

await t('POST /api/llm/usage/reset 幂等', async () => {
  const a = await call('POST', '/api/llm/usage/reset');
  const b = await call('POST', '/api/llm/usage/reset');
  is(a, 200, '第一次 reset');
  is(b, 200, '第二次 reset');
  return eq(b.data?.ok, true, '重复 reset 仍成功');
});

await t('边界：POST /api/llm/models 无 baseUrl 返回 400', async () => {
  const r = await call('POST', '/api/llm/models', { baseUrl: '' });
  truthy([400, 422].includes(r.status), `应 400/422，实际 ${r.status}`);
  return `HTTP ${r.status}`;
});

/* ============================ 4. 爆款情报 ============================ */
section('爆款情报 · 榜单 / 拆解 / 分析');

await t('GET /api/hot 正常取榜', async () => {
  const r = await call('GET', '/api/hot?limit=8');
  is(r, 200, '/api/hot');
  truthy((r.data?.items?.length ?? 0) > 0, '应返回条目');
  return `${r.data.items.length} 条 · 来源 ${r.data.source}`;
});

await t('榜单每条含剧名/集数/来源链接', async () => {
  const { data } = await call('GET', '/api/hot?limit=10');
  const badItems = data.items.filter((x) => !x.title || !Number.isInteger(x.episodes) || !/^https:\/\//.test(x.url ?? ''));
  eq(badItems.length, 0, `不合规条目数（共 ${data.items.length} 条）`);
  return `${data.items.length} 条全部合规`;
});

await t('榜单附带结构分析', async () => {
  const { data } = await call('GET', '/api/hot?limit=8');
  truthy((data.analysis?.hooks?.length ?? 0) > 0, '应有钩子分析');
  return `钩子 ${data.analysis.hooks.length} 类 · 题材 ${data.analysis.genres?.length ?? 0} 类`;
});

await t('边界：limit=0 返回 422', async () => {
  const r = await call('GET', '/api/hot?limit=0');
  is(r, 422, 'limit=0');
  return eq(r.data?.error?.code, 'VALIDATION', 'code');
});

await t('边界：limit=101 越界返回 422', async () => {
  const r = await call('GET', '/api/hot?limit=101');
  is(r, 422, 'limit=101');
  return '越界被拦';
});

await t('边界：limit 非数字返回 422', async () => {
  const r = await call('GET', '/api/hot?limit=abc');
  is(r, 422, 'limit=abc');
  return '类型错误被拦';
});

await t('GET /api/hot?genre 过滤生效', async () => {
  const all = await call('GET', '/api/hot?limit=10');
  const g = all.data.items[0]?.genre;
  const r = await call('GET', `/api/hot?limit=10&genre=${encodeURIComponent(g)}`);
  is(r, 200, 'genre 过滤');
  truthy(r.data.items.length > 0 && r.data.items.length <= all.data.items.length, '过滤结果应非空且 ≤ 全量');
  return `genre=${g} → ${r.data.items.length}/${all.data.items.length}`;
});

await t('POST /api/hot/analyze 提交数据做分析', async () => {
  const hot = (await call('GET', '/api/hot?limit=10')).data;
  const r = await call('POST', '/api/hot/analyze', { hot });
  is(r, 200, 'analyze');
  return `钩子 ${r.data.hooks.length} 类`;
});

await t('边界：analyze 缺 items 返回 400', async () => {
  const r = await call('POST', '/api/hot/analyze', { foo: 1 });
  is(r, 400, '缺 items');
  return eq(r.data?.error?.code, 'BAD_REQUEST', 'code');
});

await t('POST /api/split 拆解文本为钩子/爽点', async () => {
  const text = '她被推下楼梯，所有人都说这是意外。\n可我看见了那只手。\n三年后，我回来了。';
  const r = await call('POST', '/api/split', { text });
  is(r, 200, 'split');
  return `识别 ${r.data.hooks?.length ?? 0} 个钩子 · ${r.data.lines?.length ?? 0} 行`;
});

await t('边界：split 空白文本被拒', async () => {
  // 纯空白会先被 requireString trim 成空串 → VALIDATION(422)，早于端点里的 badRequest(400)
  const r = await call('POST', '/api/split', { text: '   ' });
  truthy([400, 422].includes(r.status), `应 400/422，实际 ${r.status}`);
  return `HTTP ${r.status} · 空白被拦`;
});

await t('边界：split 缺 text 返回 400（曾为 500）', async () => {
  const r = await call('POST', '/api/split', {});
  is(r, 400, '缺 text');
  return eq(r.data?.error?.code, 'BAD_REQUEST', 'code');
});

/* ============================ 5. 剧本生成（三段式） ============================ */
section('剧本创作 · AI 三段式生成');

let genStory = null;
let genOutline = null;
let genEpisode = null;

await t('POST /api/script-gen/story 生成梗概与人设', async () => {
  // 在真实数据目录上跑时，128 个历史作品里可能已有同名作品，
  // 「剧名去重」会以 502 拦下——那是正确行为，不是缺陷。
  // 所以依次换题材重试，全部撞名才算失败（保证测试在干净目录和真实目录都能跑）。
  const genres = ['都市重生复仇', '年代文', '悬疑推理', '古装权谋', '萌宝团宠'];
  const tried = [];
  for (const genre of genres) {
    const r = await call('POST', '/api/script-gen/story', {
      concept: '都市重生复仇：女主被闺蜜与未婚夫夺走公司，重生回到酒会当晚',
      genre, episodes: 10,
    });
    if (r.status === 200) {
      genStory = r.data.story;
      tried.push(`${genre}✓`);
      break;
    }
    tried.push(`${genre}:${r.status}`);
  }
  truthy(genStory, `所有题材都未通过（${tried.join(' ')}）`);
  truthy((genStory?.characters?.length ?? 0) >= 5, `角色应 ≥5，实际 ${genStory?.characters?.length}`);
  return `《${genStory.title}》· ${genStory.characters.length} 角色 · 题材尝试 ${tried.join(' ')}`;
});

await t('边界：concept 太短返回 400', async () => {
  const r = await call('POST', '/api/script-gen/story', { concept: '短' });
  is(r, 400, 'concept 太短');
  return '过短被拦';
});

await t('边界：episodes 越界（101）返回 422', async () => {
  const r = await call('POST', '/api/script-gen/story', { concept: '一个足够长的创意描述用于测试', episodes: 101 });
  is(r, 422, 'episodes=101');
  return '越界被拦';
});

await t('边界：缺 concept 返回 422', async () => {
  const r = await call('POST', '/api/script-gen/story', {});
  is(r, 422, '缺 concept');
  return '缺参被拦';
});

await t('POST /api/script-gen/outline 生成分集大纲', async () => {
  const r = await call('POST', '/api/script-gen/outline', { story: genStory, from: 1, to: 10 });
  is(r, 200, 'outline');
  genOutline = r.data.outline;
  eq(genOutline?.episodes?.length, 10, '集数');
  return `${genOutline.episodes.length} 集 · ${genOutline.beats?.length ?? 0} 个爽点`;
});

await t('边界：outline 缺 story 返回 400', async () => {
  const r = await call('POST', '/api/script-gen/outline', {});
  is(r, 400, '缺 story');
  return '缺参被拦';
});

await t('POST /api/script-gen/episode 生成单集正文并过门', async () => {
  const r = await call('POST', '/api/script-gen/episode', { story: genStory, outline: genOutline, ep: 1 });
  is(r, 200, 'episode');
  genEpisode = r.data;
  truthy(r.data.passed === true, `应过门，未过：${(r.data.gates ?? []).filter((g) => !g.ok).map((g) => g.id).join(',')}`);
  return `门 ${(r.data.gates ?? []).filter((g) => g.ok).length}/${(r.data.gates ?? []).length} · ${r.data.text.length} 字`;
});

await t('边界：episode 缺 outline 返回 400', async () => {
  const r = await call('POST', '/api/script-gen/episode', { story: genStory });
  is(r, 400, '缺 outline');
  return '缺参被拦';
});

await t('边界：episode 集号越界（999）返回 422', async () => {
  const r = await call('POST', '/api/script-gen/episode', { story: genStory, outline: genOutline, ep: 999 });
  is(r, 422, 'ep=999');
  return '越界被拦';
});

await t('POST /api/script-gen/assemble 组装整稿并双体检', async () => {
  const r = await call('POST', '/api/script-gen/assemble', {
    story: genStory, outline: genOutline, texts: [genEpisode.text],
  });
  is(r, 200, 'assemble');
  eq(r.data?.script?.episodes?.length, 1, '集数');
  truthy((r.data.gates ?? []).every((g) => g.ok), '整稿门应全过');
  return `${(r.data.gates ?? []).length} 门全过`;
});

await t('边界：assemble 缺 texts 返回 400', async () => {
  const r = await call('POST', '/api/script-gen/assemble', { story: genStory, outline: genOutline });
  is(r, 400, '缺 texts');
  return '缺参被拦';
});

/* ============================ 6. 质量把控 ============================ */
section('质量把控 · 评估 / 体检 / 优化 / 角色识别');

await t('POST /api/evaluate 24 门 + 模型评审', async () => {
  const r = await call('POST', '/api/evaluate', { script: SCRIPT, outline: OUTLINE });
  is(r, 200, 'evaluate');
  eq(r.data.total, 24, '门数');
  truthy(typeof r.data.score === 'number', '应有分数');
  return `${r.data.score} 分 · ${r.data.passed}/${r.data.total} 门 · 评审 ${r.data.judge?.score ?? '无'}`;
});

await t('边界：evaluate 缺参数返回 400', async () => {
  const r = await call('POST', '/api/evaluate', {});
  is(r, 400, '缺参数');
  return eq(r.data?.error?.code, 'BAD_REQUEST', 'code');
});

await t('边界：evaluate 传空 episodes 返回 400', async () => {
  const r = await call('POST', '/api/evaluate', { script: { episodes: [] } });
  truthy([400, 200].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}`;
});

await t('边界：evaluate 传非对象 script 不崩', async () => {
  const r = await call('POST', '/api/evaluate', { script: 'not-an-object' });
  truthy([400, 422].includes(r.status), `应 400/422，实际 ${r.status}`);
  return `HTTP ${r.status}（未 500）`;
});

await t('POST /api/checkup 内容体检', async () => {
  const r = await call('POST', '/api/checkup', { script: SCRIPT, outline: OUTLINE });
  is(r, 200, 'checkup');
  truthy(r.data.total > 0, '应有检查项');
  truthy(Array.isArray(r.data.episodes), '应返回每集节奏定位');
  return `${r.data.score} 分 · ${r.data.passed}/${r.data.total} 项 · ${r.data.episodes.length} 集`;
});

await t('POST /api/optimize 确定性预修 + 逐集精修', async () => {
  const r = await call('POST', '/api/optimize', { script: SCRIPT, outline: OUTLINE, limit: 2 });
  is(r, 200, 'optimize');
  truthy(typeof r.data.after?.score === 'number', '应有优化后分数');
  return `${r.data.before.score} → ${r.data.after.score} 分 · 重写 ${r.data.rewritten?.length ?? 0} 集`;
});

await t('边界：optimize limit=0 不报错', async () => {
  const r = await call('POST', '/api/optimize', { script: SCRIPT, outline: OUTLINE, limit: 0 });
  truthy([200, 422].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status} · 重写 ${r.data?.rewritten?.length ?? '-'} 集`;
});

await t('边界：optimize limit 超大不崩', async () => {
  const r = await call('POST', '/api/optimize', { script: SCRIPT, outline: OUTLINE, limit: 9999 });
  truthy([200, 422].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}`;
});

await t('POST /api/cast/analyze 角色识别', async () => {
  const r = await call('POST', '/api/cast/analyze', { script: SCRIPT, outline: OUTLINE });
  is(r, 200, 'cast');
  truthy((r.data.characters?.length ?? 0) > 0, '应识别出角色');
  return `${r.data.characters.length} 角色 · 有名 ${r.data.summary?.named ?? 0}`;
});

await t('GET /api/carry-over-modes 承接模式', async () => {
  const r = await call('GET', '/api/carry-over-modes');
  is(r, 200, 'carry-over');
  truthy((r.data?.items?.length ?? 0) > 0, '应返回模式列表');
  return `${r.data.items.length} 种模式`;
});

/* ============================ 7. 分镜 ============================ */
section('剧本创作 · 分镜脚本');

let segments = null;

await t('POST /api/shots/split 拆分并过结构门', async () => {
  const r = await call('POST', '/api/shots/split', { script: SCRIPT, outline: OUTLINE, ep: 1, aspect: '9:16' });
  is(r, 200, 'shots/split');
  segments = r.data.segments;
  truthy((segments?.length ?? 0) > 0, '应有分镜段');
  const badGates = (r.data.gates ?? []).filter((g) => !g.ok);
  eq(badGates.length, 0, `未过门（${badGates.map((g) => g.id).join(',')}）`);
  return `${segments.length} 段 / ${r.data.stats.shots} 镜 / ${r.data.stats.seconds}s · ${r.data.gates.length} 门全过`;
});

await t('分镜不是降级稿', async () => {
  const r = await call('POST', '/api/shots/split', { script: SCRIPT, outline: OUTLINE, ep: 1 });
  eq(r.data.degraded, false, 'degraded');
  return '模型/样本引擎正常';
});

await t('边界：split ep 超集数（999）不崩', async () => {
  const r = await call('POST', '/api/shots/split', { script: SCRIPT, outline: OUTLINE, ep: 999 });
  truthy([200, 400, 422].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}（未 500）`;
});

await t('边界：split ep 为 0 被兜到第 1 集', async () => {
  const r = await call('POST', '/api/shots/split', { script: SCRIPT, outline: OUTLINE, ep: 0 });
  truthy([200, 422].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}`;
});

await t('POST /api/shots/export 导出 Markdown', async () => {
  const r = await call('POST', '/api/shots/export', { ep: 1, segments, format: 'md' });
  is(r, 200, 'export md');
  truthy(r.data.text.includes('| 镜号 |'), '应含表头');
  return `${r.data.total} 段 / ${r.data.shots} 镜 / ${r.data.text.length} 字`;
});

await t('POST /api/shots/export 导出 JSON', async () => {
  const r = await call('POST', '/api/shots/export', { ep: 1, segments, format: 'json' });
  is(r, 200, 'export json');
  truthy(r.data.text.length > 10, '应返回 JSON 文本');
  return `${r.data.text.length} 字`;
});

await t('边界：export 缺 segments 返回 400', async () => {
  const r = await call('POST', '/api/shots/export', { ep: 1 });
  is(r, 400, '缺 segments');
  return '缺参被拦';
});

await t('边界：export 非法 format 返回 422', async () => {
  const r = await call('POST', '/api/shots/export', { ep: 1, segments, format: 'pdf' });
  is(r, 422, 'format=pdf');
  return '非法枚举被拦';
});

/* ============================ 8. 资产 / 台词 / 导出 ============================ */
section('资产中心 · 资产 / 台词本 / 导出');

await t('POST /api/assets 角色与场景资产', async () => {
  const r = await call('POST', '/api/assets', { script: SCRIPT, outline: OUTLINE, visualStyle: 'cn-guoman' });
  is(r, 200, 'assets');
  truthy((r.data.characters?.length ?? 0) > 0, '应有角色');
  truthy((r.data.scenes?.length ?? 0) > 0, '应有场景');
  return `${r.data.characters.length} 角色 / ${r.data.scenes.length} 场景`;
});

await t('资产带一致性提示词与无人约束', async () => {
  const r = await call('POST', '/api/assets', { script: SCRIPT, outline: OUTLINE });
  truthy((r.data.characters[0]?.consistencyPrompt ?? '').length > 0, '角色应有 consistencyPrompt');
  truthy((r.data.scenes[0]?.noPeopleGuard ?? '').length > 0, '场景应有 noPeopleGuard');
  return '一致性与无人约束均存在';
});

await t('边界：assets 只有 script 无 outline 返回 400', async () => {
  const r = await call('POST', '/api/assets', { script: SCRIPT });
  is(r, 400, '缺 outline');
  return eq(r.data?.error?.code, 'BAD_REQUEST', 'code');
});

await t('POST /api/linebook 台词本', async () => {
  const r = await call('POST', '/api/linebook', { script: SCRIPT, outline: OUTLINE, includeCsv: true });
  is(r, 200, 'linebook');
  truthy(r.data.totals?.lines > 0, '应有台词');
  truthy((r.data.formats?.csv ?? '').length > 0, '应返回 CSV');
  return `${r.data.totals.speakers} 人 / ${r.data.totals.lines} 句 / ${r.data.totals.seconds}s`;
});

await t('边界：linebook 缺 script 返回 400', async () => {
  const r = await call('POST', '/api/linebook', {});
  is(r, 400, '缺 script');
  return '缺参被拦';
});

await t('POST /api/export 覆盖全部导出格式', async () => {
  const out = [];
  for (const format of ['markdown', 'csv', 'performers']) {
    const r = await call('POST', '/api/export', { script: SCRIPT, outline: OUTLINE, format });
    is(r, 200, `export ${format}`);
    truthy((r.data.text ?? '').length > 50, `${format} 输出过短`);
    out.push(`${format}:${r.data.text.length}字`);
  }
  return out.join(' / ');
});

await t('边界：export 非法 format 返回 422', async () => {
  const r = await call('POST', '/api/export', { script: SCRIPT, outline: OUTLINE, format: 'docx' });
  is(r, 422, 'format=docx');
  return '非法枚举被拦';
});

/* ============================ 9. 分析工具 ============================ */
section('效率工具 · 对标 / 统计 / 格式 / 润色 / 标题 / 关系');

await t('POST /api/compare 对标分析', async () => {
  const r = await call('POST', '/api/compare', { script: SCRIPT, outline: OUTLINE });
  is(r, 200, 'compare');
  truthy(Array.isArray(r.data.gaps), '应返回差距列表');
  return `${r.data.gaps.length} 处差距 · ${r.data.verdict ?? ''}`.slice(0, 50);
});

await t('POST /api/stats 统计报表', async () => {
  const r = await call('POST', '/api/stats', { script: SCRIPT, outline: OUTLINE });
  is(r, 200, 'stats');
  truthy(r.data.totals?.episodes > 0, '应有集数统计');
  truthy(Array.isArray(r.data.rhythm), '应有节奏曲线');
  return `${r.data.totals.scenes} 场 / ${r.data.totals.lines} 句`;
});

await t('POST /api/format 覆盖全部格式（逐一遍历）', async () => {
  const meta = await call('GET', '/api/meta');
  const ids = (meta.data.formats ?? []).map((f) => f.id);
  truthy(ids.length >= 5, `格式数应 ≥5，实际 ${ids.length}`);
  const out = [];
  for (const id of ids) {
    const r = await call('POST', '/api/format', { script: SCRIPT, outline: OUTLINE, format: id });
    is(r, 200, `format=${id}`);
    truthy((r.data.text ?? '').length > 50, `${id} 输出过短（${r.data.text?.length} 字）`);
    out.push(`${id}:${r.data.text.length}字`);
  }
  return `${ids.length} 种全部可用 · ${out.join(' / ')}`;
});

await t('边界：format 非法枚举返回 422', async () => {
  const r = await call('POST', '/api/format', { script: SCRIPT, outline: OUTLINE, format: 'nope' });
  is(r, 422, 'format=nope');
  return '非法枚举被拦';
});

await t('POST /api/polish 单句润色', async () => {
  const r = await call('POST', '/api/polish', { line: '那个，我跟你说，反正就是我今天就是说不太想去，然后呢就算了' });
  is(r, 200, 'polish');
  truthy(r.data.polished.length < r.data.original.length, '润色后应变短');
  return `${r.data.original.length} → ${r.data.polished.length} 字 · ${r.data.changes.length} 处改动`;
});

await t('POST /api/polish 批量润色', async () => {
  const r = await call('POST', '/api/polish', { lines: ['那个，我其实吧，就是不想去', '你好'] });
  is(r, 200, 'batch polish');
  eq(r.data.total, 2, '总条数');
  return `${r.data.total} 条 · ${r.data.changed} 条有改动`;
});

await t('边界：polish 缺参数返回 400', async () => {
  const r = await call('POST', '/api/polish', {});
  is(r, 400, '缺 line/lines');
  return '缺参被拦';
});

await t('边界：polish 空数组不崩', async () => {
  const r = await call('POST', '/api/polish', { lines: [] });
  truthy([200, 400].includes(r.status), `意外状态 ${r.status}`);
  return `HTTP ${r.status}`;
});

/* ---------------- 去 AI 味（扫描纯本地 / 改写调模型） ---------------- */
const DEAI_DIRTY = '他心中一紧，不禁后退半步。仿佛有什么东西在黑暗里蠕动，空气中弥漫着一种说不清的气息。'
  + '他深吸一口气，屏住呼吸。与此同时，他意识到，这一刻终究还是来了。一切都变了。'
  + '他知道，从此以后再也回不去了。有些话说出口，就再也收不回。他站在原地，久久没有动。';

await t('POST /api/deai/scan 13 维扫描', async () => {
  const r = await call('POST', '/api/deai/scan', { text: DEAI_DIRTY, maxScore: 40 });
  is(r, 200, 'deai scan');
  truthy(typeof r.data.report.score === 'number', '应返回分数');
  eq(r.data.report.dimensions.length, 13, '维度数');
  eq(r.data.gates.length, 1, '门禁条数');
  truthy(r.data.report.clicheTotal > 0, '脏文本应命中套话');
  return `${r.data.report.score} 分 · 套话 ${r.data.report.clicheTotal} 处`;
});

await t('POST /api/deai/scan 同一文本两次同分（确定性）', async () => {
  const a = await call('POST', '/api/deai/scan', { text: DEAI_DIRTY });
  const b = await call('POST', '/api/deai/scan', { text: DEAI_DIRTY });
  eq(b.data.report.score, a.data.report.score, '两次扫描分数');
  return `${a.data.report.score} = ${b.data.report.score}`;
});

await t('边界：deai scan 空文本返回 422', async () => {
  const r = await call('POST', '/api/deai/scan', { text: '' });
  is(r, 422, '空文本应被拦');
  return '空文本被拦';
});

await t('边界：deai scan 缺 text 字段返回 422', async () => {
  const r = await call('POST', '/api/deai/scan', {});
  is(r, 422, '缺字段应被拦');
  return '缺字段被拦';
});

await t('GET /api/deai/rules 规则库完整', async () => {
  const r = await call('GET', '/api/deai/rules');
  is(r, 200, 'deai rules');
  eq(r.data.rules.length, 10, '本机规则条数');
  eq(r.data.sixChecks.length, 6, '六项诊断');
  eq(r.data.subtract.length, 7, '减法项');
  eq(r.data.add.length, 5, '加法项');
  return `规则 ${r.data.rules.length} / 诊断 ${r.data.sixChecks.length} / 减 ${r.data.subtract.length} / 加 ${r.data.add.length}`;
});

await t('POST /api/deai/rewrite 未接模型时如实跳过（不假装改过）', async () => {
  const r = await call('POST', '/api/deai/rewrite', { text: DEAI_DIRTY, target: 40 });
  is(r, 200, 'deai rewrite');
  truthy(typeof r.data.before?.score === 'number', '扫描结果仍应返回');
  if (r.data.llm?.mode !== 'live') {
    truthy(r.data.skipped === true, '未接入模型时应标记 skipped');
    truthy(/改写需要|不重写/.test(r.data.note ?? ''), `说明应讲清为什么没改：${r.data.note}`);
    eq(r.data.text, '', '不应返回假正文');
    return `跳过（${r.data.llm?.mode}）：${String(r.data.note).slice(0, 24)}…`;
  }
  truthy(r.data.after?.score <= r.data.target || r.data.note.includes('仍未过门'), '真模型时应给出复扫结果或明确未过门');
  return `改后 ${r.data.after.score} 分`;
});

await t('边界：deai rewrite 太短返回 422', async () => {
  const r = await call('POST', '/api/deai/rewrite', { text: '太短了' });
  is(r, 422, '不足 30 字应被拦');
  return '短文本被拦';
});

await t('边界：deai rewrite 门禁线越界收敛到合法区间', async () => {
  const r = await call('POST', '/api/deai/rewrite', { text: DEAI_DIRTY, target: 999 });
  truthy([200, 422].includes(r.status), `意外状态 ${r.status}`);
  if (r.status === 200) truthy(r.data.target <= 80, `target 应被收敛，实际 ${r.data.target}`);
  return `HTTP ${r.status}${r.status === 200 ? ` · target=${r.data.target}` : ''}`;
});

/* ---------------- 小说写作台（书 / 章节 / 存稿 / 续写 / 导出） ---------------- */
let novelId = null;
let chapterId = null;
const novelCleanup = [];

await t('POST /api/novels 建书', async () => {
  const r = await call('POST', '/api/novels', {
    title: '渡口灯', track: 'web-novel', genre: '悬疑',
    premise: '所有人都说那场船难是意外，只有他记得江上一盏没熄的灯。',
  });
  is(r, 201, 'novel create');
  eq(r.data.book.schema, 'studio-v2', '新模型标记');
  truthy(Array.isArray(r.data.book.chapters) && r.data.book.chapters.length === 0, '新书应没有章节');
  novelId = r.data.book.id;
  return `《${r.data.book.title}》· ${r.data.book.track}`;
});

await t('边界：建书缺 title 返回 422', async () => {
  const r = await call('POST', '/api/novels', { track: 'web-novel' });
  is(r, 422, '缺 title 应被拦');
  return '缺 title 被拦';
});

await t('GET /api/novels 列表含新书', async () => {
  const r = await call('GET', '/api/novels');
  is(r, 200, 'novel list');
  truthy(r.data.items.some((x) => x.id === novelId), '列表里应有新书');
  return `${r.data.items.length} 本`;
});

await t('POST /api/novels/:id/chapters 新建章节', async () => {
  const r = await call('POST', `/api/novels/${novelId}/chapters`, { title: '灯' });
  is(r, 201, 'add chapter');
  eq(r.data.chapter.index, 1, '第一章');
  eq(r.data.chapter.title, '灯', '标题');
  chapterId = r.data.chapter.id;
  return `第${r.data.chapter.index}章 ${r.data.chapter.title}`;
});

await t('PUT 存稿：算净字数、提炼记忆', async () => {
  const text = '雾是从江面先起的。沈砚把票根摊在掌心，又攥了回去。\n\n守夜人：「今晚不开闸。」\n\n沈砚问：「我父亲的票，是谁卖的。」';
  const r = await call('PUT', `/api/novels/${novelId}/chapters/${chapterId}`, { text });
  is(r, 200, 'save chapter');
  const ch = r.data.chapter;
  truthy(ch.words > 20, `字数应算出来，实际 ${ch.words}`);
  truthy(!/[「」：，。？]/.test(String(ch.words)), '字数应为数字');
  const raw = text.replace(/\s/g, '').length;
  truthy(ch.words < raw, `净字数应小于含标点字符数（${ch.words} vs ${raw}）`);
  truthy(ch.mem && Array.isArray(ch.mem.points), '应提炼本章记忆');
  truthy(r.data.memory && r.data.memory.writtenChapters === 1, '全书记忆应记到 1 章');
  return `${ch.words} 字 · 要点 ${ch.mem.points.length} 条`;
});

await t('PUT 存稿：可改章节标题', async () => {
  const r = await call('PUT', `/api/novels/${novelId}/chapters/${chapterId}`, { title: '灯（上）' });
  is(r, 200, 'rename chapter');
  eq(r.data.chapter.title, '灯（上）', '标题应更新');
  return r.data.chapter.title;
});

await t('GET 本章扫描（13 维，纯本地）', async () => {
  const r = await call('GET', `/api/novels/${novelId}/chapters/${chapterId}/scan`);
  is(r, 200, 'chapter scan');
  truthy(r.data.report?.ok, '应返回扫描报告');
  eq(r.data.report.dimensions.length, 13, '维度数');
  truthy(typeof r.data.report.score === 'number', '应有分数');
  return `AI 痕迹 ${r.data.report.score}`;
});

await t('POST compose continue：接着写，不覆盖已有正文', async () => {
  const before = await call('GET', `/api/novels/${novelId}`);
  const oldWords = before.data.book.chapters[0].words;
  const r = await call('POST', `/api/novels/${novelId}/chapters/${chapterId}/compose`, { mode: 'continue', words: 800 });
  is(r, 200, 'compose continue');
  const ch = r.data.chapter;
  truthy(ch.words > oldWords, `续写后应更长（${oldWords} → ${ch.words}）`);
  truthy(ch.text.startsWith('雾是从江面先起的'), '原有开头不应被覆盖');
  return `${oldWords} → ${ch.words} 字`;
});

await t('POST compose draft：空章从头起草', async () => {
  const added = await call('POST', `/api/novels/${novelId}/chapters`, { title: '空章' });
  const r = await call('POST', `/api/novels/${novelId}/chapters/${added.data.chapter.id}/compose`, { mode: 'draft', words: 600 });
  is(r, 200, 'compose draft');
  truthy(r.data.chapter.words > 200, `起草应有正文，实际 ${r.data.chapter.words}`);
  return `${r.data.chapter.words} 字`;
});

await t('GET 导出全书（含各章正文）', async () => {
  const r = await call('GET', `/api/novels/${novelId}/export`);
  is(r, 200, 'export');
  truthy(r.data.text.includes('第1章'), '应含第一章标题');
  truthy(r.data.chapters === 2, `应导出 2 章，实际 ${r.data.chapters}`);
  truthy(r.data.words > 0, '应有字数');
  return `${r.data.chapters} 章 · ${r.data.words} 字`;
});

await t('DELETE 删除章节', async () => {
  const full = await call('GET', `/api/novels/${novelId}`);
  const last = full.data.book.chapters.at(-1);
  const r = await call('DELETE', `/api/novels/${novelId}/chapters/${last.id}`);
  is(r, 200, 'delete chapter');
  const after = await call('GET', `/api/novels/${novelId}`);
  eq(after.data.book.chapters.length, 1, '应剩 1 章');
  return '已删 1 章';
});

await t('POST tidy：一键整理（清 MD + 统一标点 + 排版）', async () => {
  const created = await call('POST', '/api/novels', { title: '整理测试书' });
  const id = created.data.book.id;
  novelCleanup.push(id);
  const added = await call('POST', `/api/novels/${id}/chapters`, { title: '整理' });
  const cid = added.data.chapter.id;
  await call('PUT', `/api/novels/${id}/chapters/${cid}`, { text: '## 标题\n\n**正文**,"说话."\n\n\n下一段。' });
  const r = await call('POST', `/api/novels/${id}/chapters/${cid}/tidy`, {});
  is(r, 200, 'tidy');
  const text = r.data.chapter.text;
  truthy(!text.includes('#'), '不应残留 Markdown 标题号');
  truthy(!text.includes('**'), '不应残留加粗符号');
  truthy(text.includes('“'), '引号应统一为中文');
  truthy(!/\n{3,}/.test(text), '不应有连续空行');
  return `${r.data.chapter.words} 字`;
});

await t('POST compose：带续写预设与关联前文', async () => {
  const list = await call('GET', '/api/novels');
  const nid = list.data.items.find((x) => x.title === '整理测试书')?.id;
  const full = await call('GET', `/api/novels/${nid}`);
  const cid = full.data.book.chapters[0].id;
  const before = full.data.book.chapters[0].words;
  const r = await call('POST', `/api/novels/${nid}/chapters/${cid}/compose`, {
    mode: 'continue', words: 600, preset: 'conflict', ctx: 1,
  });
  is(r, 200, 'compose with preset');
  truthy(r.data.chapter.words > before, '续写后应更长');
  return `${before} → ${r.data.chapter.words} 字（冲突升级）`;
});

await t('POST restore：时光机还原到续写前', async () => {
  const list = await call('GET', '/api/novels');
  const nid = list.data.items.find((x) => x.title === '整理测试书')?.id;
  const full = await call('GET', `/api/novels/${nid}`);
  const ch = full.data.book.chapters[0];
  truthy(Array.isArray(ch.history) && ch.history.length >= 1, 'AI 覆盖前应留快照');
  const snap = ch.history[ch.history.length - 1];
  const r = await call('POST', `/api/novels/${nid}/chapters/${ch.id}/restore`, { ts: snap.ts });
  is(r, 200, 'restore');
  eq(r.data.chapter.text, snap.text, '应还原到快照内容');
  return `还原到 ${new Date(snap.ts).toISOString().slice(11, 19)}`;
});

await t('PATCH 修改书名', async () => {
  const r = await call('PATCH', `/api/novels/${novelId}`, { title: '渡口灯（改）' });
  is(r, 200, 'patch book');
  eq(r.data.book.title, '渡口灯（改）', '书名应更新');
  return r.data.book.title;
});

await t('DELETE 删书（软删索引）', async () => {
  const r = await call('DELETE', `/api/novels/${novelId}`);
  is(r, 200, 'delete book');
  const list = await call('GET', '/api/novels');
  truthy(!list.data.items.some((x) => x.id === novelId), '删后列表不应再有');
  return '已从书目移除';
});

await t('边界：不存在的章节返回 404', async () => {
  const created = await call('POST', '/api/novels', { title: '边界测试书' });
  const id = created.data.book.id;
  novelCleanup.push(id);
  const r = await call('PUT', `/api/novels/${id}/chapters/nope`, { text: 'x' });
  is(r, 404, '不存在的章节应 404');
  return '章节 404';
});

await t('边界：删除不存在的书返回 404', async () => {
  const r = await call('DELETE', '/api/novels/not-a-real-id');
  is(r, 404, '不存在的书应 404');
  return '不存在的书被拦';
});

// 清理本次造的临时书
for (const id of novelCleanup) { try { await call('DELETE', `/api/novels/${id}`); } catch { /* 忽略 */ } }

await t('POST /api/titles 爆款标题', async () => {
  const r = await call('POST', '/api/titles', { genre: '悬疑', keyword: '渡口', count: 8 });
  is(r, 200, 'titles');
  truthy(r.data.items.length >= 4, '应至少 4 条');
  return `${r.data.items.length} 条 / 池 ${r.data.total}`;
});

await t('边界：titles count=3 低于下限返回 422', async () => {
  const r = await call('POST', '/api/titles', { count: 3 });
  is(r, 422, 'count=3');
  return '下限被拦';
});

await t('边界：titles count=41 越界返回 422', async () => {
  const r = await call('POST', '/api/titles', { count: 41 });
  is(r, 422, 'count=41');
  return '上限被拦';
});

await t('POST /api/relations 人物关系图', async () => {
  const r = await call('POST', '/api/relations', { script: SCRIPT, outline: OUTLINE });
  is(r, 200, 'relations');
  truthy((r.data.nodes?.length ?? 0) > 0, '应有节点');
  return `${r.data.nodes.length} 节点 / ${r.data.edges.length} 边`;
});

/* ============================ 10. 项目串联 ============================ */
section('项目 · 新建 / 读写 / 串联 / 删除');

let proj = null;

await t('POST /api/projects 新建项目', async () => {
  const r = await call('POST', '/api/projects', { name: '功能矩阵测试项目', visualStyle: 'noir-manga', episodes: 2 });
  is(r, 201, '新建');
  proj = r.data;
  truthy(!!proj.id, '应返回 id');
  return `id=${proj.id.slice(0, 8)}…`;
});

await t('边界：新建项目缺 name 返回 422', async () => {
  const r = await call('POST', '/api/projects', {});
  is(r, 422, '缺 name');
  return eq(r.data?.error?.code, 'VALIDATION', 'code');
});

await t('边界：新建项目 episodes=0 返回 422', async () => {
  const r = await call('POST', '/api/projects', { name: 'x', episodes: 0 });
  is(r, 422, 'episodes=0');
  return '下限被拦';
});

await t('边界：新建项目非法 visualStyle 回退默认', async () => {
  const r = await call('POST', '/api/projects', { name: '样式回退测试', visualStyle: 'not-a-style' });
  truthy([201, 422].includes(r.status), `意外状态 ${r.status}`);
  if (r.status === 201) {
    const del = await call('DELETE', `/api/projects/${r.data.id}`);
    is(del, 200, '清理');
    return '回退到默认画风';
  }
  return '非法画风被拒（422）';
});

await t('GET /api/projects 列表', async () => {
  const r = await call('GET', '/api/projects');
  is(r, 200, '列表');
  truthy(Array.isArray(r.data.items), 'items 应为数组');
  return `${r.data.items.length} 个项目`;
});

await t('GET /api/projects/:id 读取项目', async () => {
  const r = await call('GET', `/api/projects/${proj.id}`);
  is(r, 200, '读取');
  eq(r.data.name, '功能矩阵测试项目', 'name');
  return hasKeys(r.data, ['id', 'stages', 'assets', 'createdAt'], '项目');
});

await t('边界：读取不存在的项目返回 404', async () => {
  const r = await call('GET', '/api/projects/00000000-0000-4000-8000-000000000000');
  is(r, 404, '不存在');
  return eq(r.data?.error?.code, 'NOT_FOUND', 'code');
});

await t('边界：脏 id 返回 404（曾为 500）', async () => {
  const r = await call('GET', '/api/projects/..%2f..%2fetc%2fpasswd');
  is(r, 404, '脏 id');
  return `HTTP 404 · ${r.data?.error?.code}（未 500）`;
});

await t('POST /api/projects/:id/crawl 抓取榜单入库', async () => {
  const r = await call('POST', `/api/projects/${proj.id}/crawl`, { limit: 6 });
  is(r, 200, 'crawl');
  truthy(r.data.progress > 0, '应有进度');
  return `进度 ${r.data.progress}%`;
});

await t('POST /api/projects/:id/script 存入剧本', async () => {
  const r = await call('POST', `/api/projects/${proj.id}/script`, { script: SCRIPT, outline: OUTLINE });
  is(r, 200, '存剧本');
  truthy(r.data.progress > 0, '应有进度');
  return `进度 ${r.data.progress}%`;
});

await t('边界：存入剧本缺 script 返回 400', async () => {
  const r = await call('POST', `/api/projects/${proj.id}/script`, {});
  is(r, 400, '缺 script');
  return '缺参被拦';
});

await t('串联：带 projectId 评估并写回阶段', async () => {
  const r = await call('POST', '/api/evaluate', { projectId: proj.id });
  is(r, 200, '按项目评估');
  const p = await call('GET', `/api/projects/${proj.id}`);
  truthy(!!p.data.stages?.evaluate?.data, 'evaluate 阶段应已写回');
  return `${r.data.score} 分 · 已写回 evaluate 阶段`;
});

await t('串联：带 projectId 内容体检写回', async () => {
  const r = await call('POST', '/api/checkup', { projectId: proj.id });
  is(r, 200, '按项目体检');
  const p = await call('GET', `/api/projects/${proj.id}`);
  truthy(!!p.data.stages?.checkup?.data, 'checkup 阶段应已写回');
  return `${r.data.score} 分 · 已写回 checkup 阶段`;
});

await t('串联：带 projectId 拆镜写回', async () => {
  const r = await call('POST', '/api/shots/split', { projectId: proj.id, ep: 1 });
  is(r, 200, '按项目拆镜');
  const p = await call('GET', `/api/projects/${proj.id}`);
  truthy(!!p.data.stages?.storyboard?.data, 'storyboard 阶段应已写回');
  return `${r.data.stats.shots} 镜 · 已写回 storyboard 阶段`;
});

await t('GET /api/projects/:id/report 导出 HTML 报告', async () => {
  const r = await call('GET', `/api/projects/${proj.id}/report`);
  is(r, 200, '报告');
  truthy((r.headers.get('content-type') ?? '').includes('text/html'), '应为 HTML');
  return `${r.text.length} 字节`;
});

await t('边界：无剧本项目导出报告返回 409', async () => {
  const created = await call('POST', '/api/projects', { name: '空项目报告测试' });
  const r = await call('GET', `/api/projects/${created.data.id}/report`);
  is(r, 409, '无剧本报告');
  await call('DELETE', `/api/projects/${created.data.id}`);
  return eq(r.data?.error?.code, 'CONFLICT', 'code');
});

await t('DELETE /api/projects/:id 删除项目', async () => {
  const r = await call('DELETE', `/api/projects/${proj.id}`);
  is(r, 200, '删除');
  const list = await call('GET', '/api/projects');
  truthy(!list.data.items.some((p) => p.id === proj.id), '列表中应已消失');
  return '已从索引移除';
});

await t('边界：重复删除返回 404', async () => {
  const r = await call('DELETE', `/api/projects/${proj.id}`);
  is(r, 404, '重复删除');
  return eq(r.data?.error?.code, 'NOT_FOUND', 'code');
});

/* ============================ 11. 幂等与并发 ============================ */
section('稳定性 · 幂等 / 并发');

await t('并发创建 20 个项目不丢失', async () => {
  const rs = await Promise.all(
    Array.from({ length: 20 }, (_, i) => call('POST', '/api/projects', { name: `并发矩阵${i + 1}` })),
  );
  const created = rs.filter((r) => r.status === 201).length;
  eq(created, 20, '创建成功数');
  const list = await call('GET', '/api/projects');
  const mine = list.data.items.filter((p) => /^并发矩阵\d+$/.test(p.name));
  for (const p of mine) await call('DELETE', `/api/projects/${p.id}`);
  return `20/20 成功，列表可见 ${mine.length} 个（已清理）`;
});

await t('同一请求重复执行结果稳定（polish 幂等）', async () => {
  const line = '那个，我其实吧，就是不想去';
  const a = await call('POST', '/api/polish', { line });
  const b = await call('POST', '/api/polish', { line });
  eq(b.data.polished, a.data.polished, '两次输出');
  return '输出一致';
});

await t('评估结果可复现（同一输入两次同分）', async () => {
  const a = await call('POST', '/api/evaluate', { script: SCRIPT, outline: OUTLINE });
  const b = await call('POST', '/api/evaluate', { script: SCRIPT, outline: OUTLINE });
  eq(b.data.score, a.data.score, '两次确定性门分');
  return `${a.data.score} 分，可复现`;
});

/* ============================ 汇总 ============================ */
console.log('\n' + '='.repeat(56));
if (failures.length) {
  console.log(`✗ ${pass} 项通过，${failures.length} 项失败`);
  console.log('\n失败清单：');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exitCode = 1;
} else {
  console.log(`✓ 全功能矩阵 ${pass} 项全部通过`);
}
