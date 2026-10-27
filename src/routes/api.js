import { Router, sendJson } from '../http/router.js';
import { logger } from '../logger.js';
import * as projects from '../repo/projectRepo.js';
import { requireString, requireInt, requireEnum, optionalString, conflict, badRequest } from '../errors.js';
import { STYLE_PRESETS, DEFAULT_STYLE_ID, stylePromptSuffix, styleGuardrail } from '../assets/stylePresets.js';
import { PROMPT_TEMPLATES, DESCRIPTION_DIMENSIONS, listTemplates, fillTemplate } from '../assets/promptLibrary.js';
import { FRAMEWORKS, DEFAULT_FRAMEWORK_ID, frameworkSpringPlan, springLabel, CARRY_OVER_MODES } from '../assets/storyFrameworks.js';
import { genreCatalog } from '../assets/genreLibrary.js';
import { VILLAIN_TIERS, RHYTHM_STAGES } from '../assets/storyStructure.js';
import { contentCheck } from '../engine/contentCheck.mjs';
import * as crawlService from '../services/crawlService.js';
import * as analyzeService from '../services/analyzeService.js';
import * as scriptService from '../services/scriptService.js';
import * as scriptGenService from '../services/scriptGenService.js';
import * as evaluateService from '../services/evaluateService.js';
import * as optimizeService from '../services/optimizeService.js';
import * as shotService from '../services/shotService.js';
import * as castService from '../services/castService.js';
import * as assetService from '../services/assetService.js';
import * as lineBookService from '../services/lineBookService.js';
import * as compareService from '../services/compareService.js';
import * as statsService from '../services/statsService.js';
import * as formatService from '../services/formatService.js';
import * as polishService from '../services/polishService.js';
import * as titleService from '../services/titleService.js';
import * as relationsService from '../services/relationsService.js';
import * as settingsRepo from '../repo/settingsRepo.js';
import { normalizeSettings, maskSettings, PRESETS, chatComplete } from '../agent/llmClient.js';
import * as llmClient from '../agent/llmClient.js';
import * as llmUsageRepo from '../repo/llmUsageRepo.js';
import { status as llmModeStatus } from '../agent/llm.js';

export const api = new Router();

// 控制器只做三件事：解析入参、调服务、格式化响应。业务规则一律在服务层。

/* ---------------- LLM 接入设置（网页里直接配，不改 .env） ---------------- */
api.get('/api/settings', async (req, res) => {
  const saved = settingsRepo.getSettings() ?? {};
  sendJson(res, 200, {
    settings: maskSettings(normalizeSettings({ ...saved })),
    status: llmModeStatus(),
    // baseUrl / model / reasoning 一起下发：切预设时前端直接用，不再在 app.js 里抄一份
    presets: PRESETS.map((p) => ({
      id: p.id, name: p.name, hint: p.hint, baseUrl: p.baseUrl, model: p.model, reasoning: p.reasoning ?? 'auto',
    })),
  });
});

api.put('/api/settings', async (req, res) => {
  const b = req.body ?? {};
  const saved = settingsRepo.getSettings() ?? {};
  // Key 只在「前端真的给了新值」时才覆盖。三种不覆盖的情况，缺一都会把存好的 Key 抹掉：
  //   ① body 里压根没带这个字段（只改推理等级这类请求）
  //   ② 带的是掩码（前端回填后没改动）
  //   ③ 带的是空串（用户清框想删除时才算，但这里保守起见也留原值——真要清请显式给 '-'）
  // 老写法 `String(b.apiKey ?? '')` 把 ① 和 ③ 都当成「改成空」，一次只发部分字段的
  // 保存请求就会静默清空 Key，而且界面上看不出来，直到调用时才报 401。
  const hasIncomingKey = b.apiKey !== undefined && b.apiKey !== null;
  const incomingKey = hasIncomingKey ? String(b.apiKey).trim() : '';
  // 显式清空：传 '-' 才真的把 Key 置空。
  // 上面注释一直这么写，但实现里没有——'-' 会被当成字面量 Key 存下来，
  // 于是用户永远删不掉已保存的 Key。这里补上，让注释与行为一致。
  const explicitClear = incomingKey === '-';
  const apiKey = explicitClear
    ? ''
    : ((!hasIncomingKey || incomingKey === '' || incomingKey.includes('*'))
      ? (saved.apiKey ?? '')
      : incomingKey);
  const merged = normalizeSettings({
    ...saved,
    ...b,
    apiKey,
    enabled: b.enabled !== undefined ? Boolean(b.enabled) : saved.enabled,
  });
  settingsRepo.saveSettings(merged);
  logger.info('settings.updated', { preset: merged.preset, model: merged.model, enabled: merged.enabled });
  sendJson(res, 200, {
    settings: maskSettings(merged),
    status: llmModeStatus(),
    message: merged.enabled ? '已接入：生成与续写将调用该模型' : '已保存；未启用时走本地引擎',
  });
});

// 测试连接：用当前保存的配置发一个最小请求
api.post('/api/settings/test', async (req, res) => {
  const saved = settingsRepo.getSettings() ?? {};
  const body = req.body ?? {};
  // 空 key 也要回退到已保存的：早先这里 body.apiKey ?? '' 把保存过的 key 覆盖成空串，
  // 于是「设置里明明有 key，测试连接却报还没有填」——合并方向应该是「缺字段才用存的」
  const incomingKey = String(body.apiKey ?? '');
  const cfg = normalizeSettings({
    ...saved,
    ...body,
    apiKey: incomingKey && !incomingKey.includes('*') ? incomingKey : (saved.apiKey ?? ''),
  });
  if (!cfg.apiKey) throw badRequest('还没有填 API Key');
  if (!cfg.baseUrl) throw badRequest('还没有填 Base URL');
  const t0 = Date.now();
  const { text, model } = await chatComplete(cfg, [{ role: 'user', content: '回复两个字：正常' }]);
  sendJson(res, 200, { ok: true, ms: Date.now() - t0, model, sample: text.slice(0, 40) });
});

/* ---------------- 模型用量与可用模型 ----------------
   用量只记元数据（时间/任务/模型/耗时/token/成败），不记 prompt 与返回正文。
   注意：/api/settings/test 故意不记——「测试连接」不该混进生成用量里。 */
api.get('/api/llm/usage', (req, res) => sendJson(res, 200, llmUsageRepo.summary()));

api.post('/api/llm/usage/reset', (req, res) => {
  llmUsageRepo.reset();
  logger.info('llm.usage.reset');
  sendJson(res, 200, { ok: true, message: '用量已清零' });
});

// 拉可用模型列表：能拉到就给下拉，拉不到前端继续允许手填
api.post('/api/llm/models', async (req, res) => {
  const b = req.body ?? {};
  const saved = settingsRepo.getSettings() ?? {};
  const cfg = normalizeSettings({
    ...saved,
    ...b,
    apiKey: String(b.apiKey ?? '').includes('*') ? (saved.apiKey ?? '') : String(b.apiKey ?? saved.apiKey ?? ''),
  });
  if (!cfg.baseUrl) throw badRequest('还没有填 Base URL');
  const items = await llmClient.listModels(cfg);
  sendJson(res, 200, { items, total: items.length });
});

/* ---------------- 元信息 ---------------- */
api.get('/api/health', async (req, res) => {
  sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()), env: req.app.config.env });
});

api.get('/api/meta', async (req, res) => {
  const llm = llmModeStatus();
  sendJson(res, 200, {
    styles: STYLE_PRESETS.map((s) => ({ id: s.id, label: s.label, group: s.group, prompt: s.prompt })),
    stages: projects.STAGES.map((id) => ({ id, label: projects.STAGE_LABELS[id] })),
    // modes 是既有形状，保留；llm 这层给前端报「接入的是哪个模型」
    modes: { llm: llm.mode, crawl: req.app.config.crawl.useMock ? 'mock' : 'live' },
    llm: { mode: llm.mode, model: llm.model, baseUrl: llm.baseUrl },
    gates: { outline: 14, script: 10 },
    formats: formatService.FORMATS,
    // 短剧框架：界面上的选择器直接用这张表渲染，别再在前端抄一份
    frameworks: FRAMEWORKS.map((f) => ({ id: f.id, label: f.label, hint: f.hint })),
    defaultFramework: DEFAULT_FRAMEWORK_ID,
    // 题材公式卡（genreFormulas）随剧本生成功能框一并下线：它只在生成页上显示
    // 「这一类题材怎么分段」，前端卡片已删，这里不再下发。
    // 题材库：32 个题材 + 大类/频道/时代/篇幅/爽点维度。前端选择器直接用这张表渲染，
    // 别在前端再抄一份中文字符串（抄了就会两边不一致）
    genres: genreCatalog(),
    // 结构维度：反派分层与节奏分段的名字，前端别自己抄一份
    structure: {
      villainTiers: VILLAIN_TIERS.map((t) => ({ id: t.id, label: t.label, role: t.role })),
      rhythmStages: RHYTHM_STAGES.map((s) => ({ id: s.id, label: s.label, task: s.task })),
    },
    templates: PROMPT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, target: t.target, description: t.description, variables: t.variables })),
  });
});

/* ---------------- 资产：画风与提示词库 ---------------- */
api.get('/api/styles', async (req, res) => {
  sendJson(res, 200, { items: STYLE_PRESETS });
});

api.get('/api/styles/:id/inject', async (req, res) => {
  const id = requireString(req.params.id, 'id', { max: 40 });
  sendJson(res, 200, { suffix: stylePromptSuffix(id), guardrail: styleGuardrail(id) });
});

api.get('/api/templates', async (req, res) => {
  const target = optionalString(req.query.target, 'target', { max: 20 });
  sendJson(res, 200, { items: listTemplates(target), dimensions: DESCRIPTION_DIMENSIONS });
});

api.post('/api/templates/:id/fill', async (req, res) => {
  const id = requireString(req.params.id, 'id', { max: 60 });
  sendJson(res, 200, { text: fillTemplate(id, req.body?.vars ?? {}) });
});

/* ---------------- 功能一：抓取爆款短剧集合 ---------------- */
api.get('/api/hot', async (req, res) => {
  const limit = requireInt(req.query.limit ?? 12, 'limit', { min: 1, max: 100, fallback: 12 });
  const genre = optionalString(req.query.genre, 'genre', { max: 40 }) ?? '';
  const hot = await crawlService.fetchHot({ limit, genre, refresh: req.query.refresh === '1' });
  sendJson(res, 200, { ...hot, analysis: analyzeService.analyzeHot(hot) });
});

// 独立使用：直接提交榜单数据做结构分析，不必先建项目
api.post('/api/hot/analyze', async (req, res) => {
  const hot = req.body?.hot ?? req.body;
  if (!hot || !Array.isArray(hot.items)) throw badRequest('需要 { items: [...] }');
  sendJson(res, 200, analyzeService.analyzeHot(hot));
});

// 独立使用：粘贴一段爆款剧本/简介，按行拆成钩子/爽点/情绪节拍表
api.post('/api/split', async (req, res) => {
  // 必须 ?? ''：optionalString 在字段缺失时返回 undefined（它的 fallback 选项不生效），
  // 直接 .trim() 会抛 TypeError，被 errorHandler 兜成 500——缺一个可选字段不该是服务器错误
  const text = optionalString(req.body?.text, 'text', { max: 20000 }) ?? '';
  if (!text.trim()) throw badRequest('需要 { text }，且不能为空');
  sendJson(res, 200, analyzeService.analyzeText(text));
});

/* ---------------- 功能二：AI 剧本生成（都市涅槃标准稿 · 三段式） ----------------
 * 2026-10-17 重建：早先的 /api/generate 整体下线过（git 8e39427），这次按开源项目
 * 的方法论重来——honolulu0/llm-script-factory（MIT）的六阶段流水线裁成三段，
 * zenstory-ai/drama-skills（MIT）的可拍摄性原则；格式契约见 src/assets/scriptSpec.js。
 *
 * 流程（每一步的产物都先返回给前端展示，用户确认了才走下一步）：
 *   story    → 梗概 + 人物小传
 *   outline  → 分集大纲（10 集一批，带前情串联；过大纲 14 门）
 *   episode  → 单集都市涅槃格式正文（过剧本 10 门，不过带诊断重修一轮）
 *   assemble → 整稿契影 + 大纲门/剧本门双体检，可直接存项目或送去评估
 */
api.post('/api/script-gen/story', async (req, res) => {
  const b = req.body ?? {};
  const story = await scriptGenService.generateStory({
    concept: requireString(b.concept, 'concept', { max: 2000 }),
    // genreId 是正路；genre 留着兼容老调用（只传中文题材名）
    genreId: optionalString(b.genreId, 'genreId', { max: 60 }),
    genre: optionalString(b.genre, 'genre', { max: 40 }),
    episodes: requireInt(b.episodes ?? 40, 'episodes', { min: 1, max: 100 }),
    variant: b.variant && typeof b.variant === 'object' ? b.variant : undefined,
    variantSeed: b.variantSeed === undefined ? undefined : requireInt(b.variantSeed, 'variantSeed', { min: 0 }),
    avoid: await recentAvoid(),
  });
  sendJson(res, 200, { story });
});

/**
 * 撞名黑名单：把最近几部作品的剧名与主角名收起来。
 * 服务端自己收，不靠前端传——换浏览器、清 localStorage 之后照样不会撞。
 */
async function recentAvoid(limit = 6) {
  try {
    const items = (await projects.listProjects()).slice(-limit).reverse();
    const out = [];
    for (const it of items) {
      if (it.missing) continue;
      let p;
      try { p = projects.getProject(it.id); } catch { continue; }
      const o = p?.stages?.outline?.data ?? p?.stages?.script?.data;
      if (o?.title) out.push(`《${o.title}》`);
      const names = (o?.characters ?? []).slice(0, 3).map((c) => c?.name).filter(Boolean);
      if (names.length) out.push(names.join('、'));
    }
    return out;
  } catch { return []; }
}

api.post('/api/script-gen/outline', async (req, res) => {
  const b = req.body ?? {};
  if (!b.story || typeof b.story !== 'object') throw badRequest('需要 story（先用 /api/script-gen/story 生成）');
  const outline = await scriptGenService.generateOutline({
    story: b.story,
    from: b.from ? requireInt(b.from, 'from', { min: 1 }) : 1,
    to: b.to ? requireInt(b.to, 'to', { min: 1 }) : undefined,
  });
  sendJson(res, 200, { outline });
});

api.post('/api/script-gen/episode', async (req, res) => {
  const b = req.body ?? {};
  if (!b.story || typeof b.story !== 'object') throw badRequest('需要 story');
  if (!b.outline || typeof b.outline !== 'object') throw badRequest('需要 outline（先用 /api/script-gen/outline 生成分集大纲）');
  const r = await scriptGenService.generateEpisode({
    story: b.story,
    outline: b.outline,
    ep: requireInt(b.ep, 'ep', { min: 1, max: 200 }),
    prevEnding: optionalString(b.prevEnding, 'prevEnding', { max: 500 }) ?? '',
  });
  sendJson(res, 200, r);
});

api.post('/api/script-gen/assemble', async (req, res) => {
  const b = req.body ?? {};
  if (!b.story || typeof b.story !== 'object') throw badRequest('需要 story');
  if (!b.outline || typeof b.outline !== 'object') throw badRequest('需要 outline');
  if (!Array.isArray(b.texts) || !b.texts.length) throw badRequest('需要 texts（逐集生成的正文数组）');
  const r = await scriptGenService.assemble({ story: b.story, outline: b.outline, texts: b.texts });
  sendJson(res, 200, r);
});

/* ---------------- 功能三：AI 剧本评估 ----------------
   两层：确定性 24 门（可复现）+ 大模型评审（懂戏），按 6:4 加权。
   模型层失败不阻断，响应里带 judgeError 说明原因。 */
api.post('/api/evaluate', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const report = await evaluateService.evaluateWithLLM(script, outline);
  if (b.projectId) {
    await projects.setStage(b.projectId, 'evaluate', report, 'draft', `${report.score} 分`);
  }
  sendJson(res, 200, report);
});

/* ---------------- 内容体检：结构与时长之外的那一半 ----------------
   现有 14+10+18 道门管「形状」，这个接口管「内容」：
   节奏定位 / 网文腔 / 水词 / 环境预算 / 集间承接。
   刻意做成**独立接口、只报告不拦截**——不动任何现有质量门的判定。 */
api.post('/api/checkup', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const report = contentCheck(script);
  // 附上每集的节奏定位，前端直接可读（模型没给就用框架兜底，保证有得看）
  const framework = outline?.framework ?? b.framework ?? DEFAULT_FRAMEWORK_ID;
  const plan = frameworkSpringPlan(framework, (script.episodes ?? []).length || (outline?.episodes ?? []).length || 1);
  report.episodes = (script.episodes ?? []).map((e, i) => ({
    ep: e.ep ?? i + 1,
    spring: ['press', 'release', 'both'].includes(e.spring) ? e.spring : plan[i],
    springLabel: springLabel(e.spring ?? plan[i]),
    declared: ['press', 'release', 'both'].includes(e.spring),
    carryFrom: e.carryFrom ?? '',
  }));
  if (b.projectId) {
    await projects.setStage(b.projectId, 'checkup', report, 'draft', `${report.score} 分`);
  }
  sendJson(res, 200, report);
});

api.get('/api/carry-over-modes', (req, res) => sendJson(res, 200, { items: CARRY_OVER_MODES }));

/* ---------------- 功能四：AI 剧本优化 ----------------
   两刀：确定性预修（机器改一定对的部分）+ 逐集模型精修（带门禁重修）。
   limit 控制这一次最多重写几集——逐集调用是花钱的，默认按「最烂的 8 集」修。 */
api.post('/api/optimize', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const r = await optimizeService.optimizeWithLLM({ script, outline, limit: b.limit });
  const payload = {
    mode: r.mode,
    before: pick(r.before),
    after: pick(r.after),
    script: r.script,
    changed: r.changed,
    rewritten: r.rewritten,
    targets: r.targets,
    skipped: r.skipped,
    note: r.note,
    advice: r.advice,
    llm: r.llm,
  };
  if (b.projectId) {
    const ok = r.rewritten.filter((x) => x.ok).length;
    await projects.setStage(b.projectId, 'script', r.script, 'draft', `重写 ${ok} 集 / 修 ${r.changed} 处`);
    await projects.setStage(b.projectId, 'evaluate', r.after, 'draft', `${r.after.score} 分`);
  }
  sendJson(res, 200, payload);
});

const pick = (r) => ({ score: r.score, passed: r.passed, total: r.total, dimensions: r.dimensions, problems: r.problems });

/* ---------------- 角色识别（确定性，不调模型） ----------------
   从剧本契约里抽出所有登场角色：名字、身份、别名、出场集/场、台词数、是否未命名。 */
api.post('/api/cast/analyze', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const cast = castService.analyzeCast(script, outline);
  sendJson(res, 200, { ...cast, block: castService.castPromptBlock(cast) });
});

/* ---------------- 功能五：分镜拆分（剧本 → 镜头表，调模型） ----------------
   一集一次调用：输入本集正文 + 大纲 + 人物编号；输出镜头表（含每镜提示词）。
   结构由 engine/shots.mjs 的 10 道门确定性校验，不过门带诊断重修一轮；
   模型不可用时降级到规则切镜（台词不丢），响应里 degraded 标出来。 */
api.post('/api/shots/split', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const ep = Math.max(1, Number(b.ep) || 1);
  const r = await shotService.splitEpisode({
    script, outline, ep,
    styleId: optionalString(b.styleId, 'styleId', { max: 40 }) ?? null,
    aspect: b.aspect === '16:9' ? '16:9' : '9:16',
  });
  if (b.projectId) {
    await projects.setStage(b.projectId, 'storyboard', r, 'draft', `第 ${ep} 集 · ${r.stats.shots} 镜${r.passed ? '' : ' · 有门未过'}`);
  }
  sendJson(res, 200, r);
});

/* 导出：只格式化已有结果，不再调模型（导出不该再花一次钱） */
api.post('/api/shots/export', async (req, res) => {
  const b = req.body ?? {};
  if (!Array.isArray(b.segments) || !b.segments.length) throw badRequest('需要 segments（拆分结果）');
  const format = requireEnum(b.format ?? 'md', 'format', ['md', 'json'], { fallback: 'md' });
  const ep = Math.max(1, Number(b.ep) || 1);
  const text = format === 'json'
    ? shotService.boardJson({ ep, segments: b.segments, styleId: b.styleId, aspect: b.aspect })
    : shotService.boardMarkdown({ ep, segments: b.segments, styleId: b.styleId });
  sendJson(res, 200, { format, text, total: b.segments.length, shots: b.segments.reduce((n, s) => n + (s.shots?.length ?? 0), 0) });
});

/* ---------------- 附加功能：资产中心 / 台词本 / 续写 / 导出 ---------------- */
api.post('/api/assets', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  if (!outline) throw badRequest('资产中心需要 outline（角色与场景来自大纲）');
  sendJson(res, 200, assetService.buildAssets(outline, script, { styleId: b.visualStyle ?? DEFAULT_STYLE_ID }));
});

api.post('/api/linebook', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const book = lineBookService.buildLineBook(script, outline, b.cast ?? null);
  sendJson(res, 200, {
    ...book,
    formats: {
      csv: b.includeCsv ? lineBookService.toCsv(book) : undefined,
      performers: b.includeCsv ? lineBookService.toPerformerScript(book) : undefined,
    },
  });
});

// /api/continue（剧本续写）随剧本生成功能框一并下线。

api.post('/api/export', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const format = requireEnum(b.format ?? 'markdown', 'format', ['markdown', 'csv', 'performers'], { fallback: 'markdown' });
  if (format === 'markdown') {
    sendJson(res, 200, { format, text: scriptService.toMarkdown(script, outline) });
    return;
  }
  const book = lineBookService.buildLineBook(script, outline, b.cast ?? null);
  sendJson(res, 200, {
    format,
    text: format === 'csv' ? lineBookService.toCsv(book) : lineBookService.toPerformerScript(book),
  });
});

/* ---------------- 附加功能：对标 / 统计 / 格式 / 润色 / 标题 / 关系 ---------------- */
// 对标分析：自家剧本 vs 爆款榜单（可带 hot 或先用 /api/hot 抓一份）
api.post('/api/compare', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  let hot = b.hot ?? null;
  if (!hot?.items?.length) hot = await crawlService.fetchHot({ limit: 12, refresh: false });
  sendJson(res, 200, compareService.compareWithHot(script, hot));
});

// 统计报表
api.post('/api/stats', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  sendJson(res, 200, statsService.buildStats(script, outline));
});

// 格式转换
api.post('/api/format', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  const format = requireEnum(b.format ?? 'short-drama', 'format', formatService.FORMATS.map((f) => f.id), { fallback: 'short-drama' });
  const text = formatService.convertFormat(script, outline, format);
  sendJson(res, 200, { format, text, ext: formatService.FORMATS.find((f) => f.id === format)?.ext ?? 'txt' });
});

// 台词润色：单句或批量（数组）
api.post('/api/polish', async (req, res) => {
  const b = req.body ?? {};
  const lines = Array.isArray(b.lines) ? b.lines : (typeof b.line === 'string' ? [b.line] : null);
  if (!lines) throw badRequest('需要 { line } 或 { lines: [] }');
  const single = !Array.isArray(b.lines);
  const items = lines.map((l) => polishService.polishLine(typeof l === 'string' ? l : l.text ?? l.line ?? ''));
  sendJson(res, 200, single ? items[0] : { items, changed: items.filter((x) => x.changes.length).length, total: items.length });
});

// 爆款标题生成
api.post('/api/titles', async (req, res) => {
  const b = req.body ?? {};
  sendJson(res, 200, titleService.generateTitles({
    genre: optionalString(b.genre, 'genre', { max: 40 }) ?? '女频逆袭',
    keyword: optionalString(b.keyword, 'keyword', { max: 20 }) ?? '',
    hook: optionalString(b.hook, 'hook', { max: 100 }) ?? '',
    count: requireInt(b.count ?? 12, 'count', { min: 4, max: 40, fallback: 12 }),
  }));
});

// 人物关系图
api.post('/api/relations', async (req, res) => {
  const b = req.body ?? {};
  const { script, outline } = await resolveScript(b);
  sendJson(res, 200, relationsService.buildRelations(script, outline));
});

/* ---------------- 项目（用于保存与串联，非必需） ---------------- */
api.get('/api/projects', async (req, res) => {
  sendJson(res, 200, { items: await projects.listProjects() });
});

api.post('/api/projects', async (req, res) => {
  const b = req.body ?? {};
  const p = await projects.createProject({
    name: requireString(b.name, 'name', { max: 120 }),
    source: optionalString(b.source, 'source', { max: 20000 }) ?? '',
    genre: optionalString(b.genre, 'genre', { max: 40 }) ?? '女频逆袭',
    visualStyle: requireEnum(b.visualStyle ?? DEFAULT_STYLE_ID, 'visualStyle', STYLE_PRESETS.map((s) => s.id), { fallback: DEFAULT_STYLE_ID }),
    episodes: requireInt(b.episodes ?? 3, 'episodes', { min: 1, max: 60 }),
    minutesPerEpisode: requireInt(b.minutesPerEpisode ?? 2, 'minutesPerEpisode', { min: 1, max: 30 }),
  });
  sendJson(res, 201, projects.summary(p));
});

api.get('/api/projects/:id', async (req, res) => {
  sendJson(res, 200, projects.getProject(req.params.id));
});

api.delete('/api/projects/:id', async (req, res) => {
  await projects.deleteProject(req.params.id);
  sendJson(res, 200, { ok: true });
});

api.post('/api/projects/:id/crawl', async (req, res) => {
  const p = projects.getProject(req.params.id);
  const b = req.body ?? {};
  const hot = await crawlService.fetchHot({
    limit: requireInt(b.limit ?? 12, 'limit', { min: 1, max: 100, fallback: 12 }),
    genre: b.genre ?? p.genre,
    refresh: b.refresh === true,
  });
  const updated = await projects.setStage(p.id, 'crawl', {
    items: hot.items, analysis: analyzeService.analyzeHot(hot), fetchedAt: hot.fetchedAt,
  }, 'draft', `抓到 ${hot.items.length} 条`);
  sendJson(res, 200, projects.summary(updated));
});

/* 把外部剧本存进项目。剧本生成下线后，这是项目拿到剧本的唯一入口——
   之前是 /api/generate 顺手写回 stage，现在由调用方显式存一次。
   没有它，「新建项目 → 打开 → 跑任何一步」都会卡在「这个项目还没有剧本」上。 */
api.post('/api/projects/:id/script', async (req, res) => {
  const p = projects.getProject(req.params.id);
  const b = req.body ?? {};
  const script = b.script ?? (Array.isArray(b.episodes) ? { source: 'adhoc', episodes: b.episodes } : null);
  if (!script || !Array.isArray(script.episodes) || !script.episodes.length) {
    throw badRequest('需要 { script: { episodes: [...] } }，且至少 1 集');
  }
  if (b.outline && typeof b.outline === 'object') {
    await projects.setStage(p.id, 'outline', b.outline, 'draft', '载入的大纲');
  }
  const updated = await projects.setStage(p.id, 'script', script, 'draft', `${script.episodes.length} 集`);
  sendJson(res, 200, projects.summary(updated));
});

api.get('/api/projects/:id/report', async (req, res) => {
  const p = projects.getProject(req.params.id);
  const script = p.stages?.script?.data;
  if (!script) throw conflict('这个项目还没有剧本：先在「剧本创作 → 格式转换」载入一份');
  const html = scriptService.renderScriptReport(script, p.stages?.outline?.data ?? null);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html) });
  res.end(html);
});

/* ---------------- 内部工具 ---------------- */
async function resolveScript(b) {
  if (b.projectId) {
    const p = projects.getProject(b.projectId);
    const script = p.stages?.script?.data;
    if (!script) throw conflict('这个项目还没有剧本：先在「剧本创作 → 格式转换」载入一份，或直接提交 script');
    return { script, outline: p.stages?.outline?.data ?? null };
  }
  let script = b.script ?? null;
  if (!script && Array.isArray(b.episodes)) script = { source: 'adhoc', episodes: b.episodes };
  if (!script || !Array.isArray(script.episodes)) throw badRequest('缺少 script.episodes，或未提供 projectId');
  return { script, outline: b.outline ?? null };
}
