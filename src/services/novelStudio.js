/**
 * 小说写作台服务（照墨笔的「写作台」重做）
 *
 * 核心动作只有五个：
 *   建书 → 建章 → 存稿（自动算字数、提炼记忆）→ 续写 / 起草（模型）→ 导出
 * 与上一版最大的区别：**章节由用户自己写**，模型只在你要的时候接着写或起个头。
 * 上一个版本是「点一下生成一整章」，那更像批量生产稿件的工具，不像写作软件。
 *
 * 记忆、字数、排版清理都复用已有引擎：
 *   novelMemory（三级记忆）/ novelGates.wordCount（不计标点）/ textClean（引号内标点）
 */
import { complete } from '../agent/llm.js';
import { logger } from '../logger.js';
import { badRequest, notFound } from '../errors.js';
import * as repo from '../repo/novelRepo.js';
import { wordCount } from '../engine/novelGates.mjs';
import { analyzeChapter, buildBookMemory, memoryToPrompt } from '../engine/novelMemory.mjs';
import { tidyChapterBody } from '../engine/textClean.mjs';
import { analyzeText } from '../engine/deaiScan.mjs';
import { autoTidy } from '../engine/editorTools.mjs';
import { CHAPTER_SYSTEM } from '../assets/novelPrompts.js';

/* ============================ 书 ============================ */

export function listBooks() {
  return repo.listNovels();
}

export async function createBook(input = {}) {
  const title = String(input.title ?? '').trim();
  if (!title) throw badRequest('书名不能为空');
  const book = repo.createNovel({ ...input, title });
  await repo.indexNovel(book);
  return detail(book.id);
}

export function detail(id) {
  const book = repo.getNovel(id);
  return { book, memory: book.memory ?? null };
}

export async function removeBook(id) {
  return repo.deleteNovel(id);
}

export async function updateBook(id, patch = {}) {
  const book = repo.getNovel(id);
  if (patch.title !== undefined) book.title = String(patch.title).trim() || book.title;
  if (patch.track !== undefined && ['web-novel', 'short', 'screenplay'].includes(patch.track)) book.track = patch.track;
  if (patch.genre !== undefined) book.genre = String(patch.genre).trim();
  if (patch.audience !== undefined) book.audience = String(patch.audience).trim();
  if (patch.targetWords !== undefined) book.targetWords = Number(patch.targetWords) || book.targetWords;
  if (patch.settings && typeof patch.settings === 'object') {
    book.settings = {
      premise: patch.settings.premise ?? book.settings?.premise ?? '',
      characters: Array.isArray(patch.settings.characters) ? patch.settings.characters : (book.settings?.characters ?? []),
      world: Array.isArray(patch.settings.world) ? patch.settings.world : (book.settings?.world ?? []),
      outline: Array.isArray(patch.settings.outline) ? patch.settings.outline : (book.settings?.outline ?? []),
    };
  }
  await repo.saveNovel(book);
  return detail(id);
}

/* ============================ 章节 ============================ */

export async function addChapter(id, input = {}) {
  const book = repo.getNovel(id);
  const next = (book.chapters ?? []).reduce((n, c) => Math.max(n, c.index ?? 0), 0) + 1;
  const chapter = {
    id: `ch-${Date.now()}-${next}`,
    index: next,
    title: String(input.title ?? '').trim() || `第${next}章`,
    text: String(input.text ?? ''),
    words: wordCount(input.text ?? ''),
    mem: null,
    updatedAt: new Date().toISOString(),
  };
  book.chapters = [...(book.chapters ?? []), chapter].sort((a, b) => a.index - b.index);
  await repo.saveNovel(book);
  return { chapter, book };
}

/**
 * 存稿：文本、标题都可改；存完顺手重算字数与本章记忆。
 * 记忆是纯规则的（不花额度），所以每次保存都能算，不会拖慢打字。
 */
export async function saveChapter(id, chapterId, patch = {}) {
  const book = repo.getNovel(id);
  const chapter = (book.chapters ?? []).find((c) => c.id === chapterId);
  if (!chapter) throw notFound(`章节 ${chapterId} 不存在`);

  if (patch.title !== undefined) chapter.title = String(patch.title).trim() || chapter.title;
  if (patch.text !== undefined) {
    const tidied = tidyChapterBody(String(patch.text));
    chapter.text = tidied.text;
    chapter.tidy = tidied.changes;
  }
  chapter.words = wordCount(chapter.text ?? '');
  chapter.updatedAt = new Date().toISOString();
  chapter.mem = chapter.text ? analyzeChapter(chapter.title, chapter.text, { cast: book.settings?.characters ?? [] }) : null;

  book.memory = buildBookMemory(book.chapters ?? []);
  await repo.saveNovel(book);
  return { chapter, memory: book.memory };
}

export async function deleteChapter(id, chapterId) {
  const book = repo.getNovel(id);
  const before = (book.chapters ?? []).length;
  book.chapters = (book.chapters ?? []).filter((c) => c.id !== chapterId);
  if (book.chapters.length === before) throw notFound(`章节 ${chapterId} 不存在`);
  book.memory = buildBookMemory(book.chapters);
  await repo.saveNovel(book);
  return { ok: true };
}

/* ============================ 续写 / 起草 ============================ */

const CONTINUE_RULES = `从已有正文的最后一句接着写，不要把前面复述一遍，也不要重写开头。
保持同一场景与同一条叙事线；不要在结尾做总结。`;

/** 续写要求预设（对应墨笔的 AI_PRESETS） */
export const AI_PRESETS = Object.freeze([
  { k: 'conflict', t: '冲突升级', d: '加大矛盾，让局势更紧张' },
  { k: 'detail', t: '细节渲染', d: '补充环境、动作、心理细节' },
  { k: 'fast', t: '节奏加快', d: '砍掉冗余，推进剧情' },
  { k: 'hook', t: '结尾埋钩', d: '在段落结尾留下悬念' },
  { k: 'calm', t: '压低节奏', d: '收一收，写氛围与关系' },
]);

const PRESET_TEXT = {
  conflict: '这一段要加大矛盾：让阻力变强、代价变贵，人物必须当场做出选择。',
  detail: '这一段要多给具体细节：环境、动作、身体感受，少写概括性叙述。',
  fast: '这一段要加快节奏：砍掉铺垫与解释，直接推进事件，句子可短。',
  hook: '这一段结尾要留钩子：停在一个动作或一句没说完的话上，不要收束。',
  calm: '这一段要压低节奏：写氛围、关系与没说出口的话，动作变少。',
};

/** 覆盖正文前留一份快照（墨笔的「时光机」） */
const HIST_LIMIT = 20;
function pushHistory(chapter, label) {
  if (!chapter?.text?.trim()) return;
  if (!Array.isArray(chapter.history)) chapter.history = [];
  const last = chapter.history[chapter.history.length - 1];
  if (last && last.text === chapter.text) return;   // 内容没变不重复记
  chapter.history.push({ ts: Date.now(), text: chapter.text, title: chapter.title, label: label || '' });
  if (chapter.history.length > HIST_LIMIT) chapter.history.shift();
}

const DRAFT_RULES = `按「这一章要写什么」起头，直接进入动作、对话或异常，不要做背景介绍。`;

/**
 * 让模型在这一章末尾接着写 / 或从空白起草。
 * mode: 'continue' 接着写（默认）；'draft' 从头起草
 */
export async function composeChapter(id, chapterId, opts = {}) {
  const book = repo.getNovel(id);
  const chapter = (book.chapters ?? []).find((c) => c.id === chapterId);
  if (!chapter) throw notFound(`章节 ${chapterId} 不存在`);

  const mode = opts.mode === 'draft' ? 'draft' : 'continue';
  const words = Math.min(8000, Math.max(200, Number(opts.words) || 1200));
  const instruction = String(opts.instruction ?? '').trim();

  // 续写要求预设：宁可让模型看到一句具体的「这一段要干什么」，也不要只给一个标签
  const preset = PRESET_TEXT[String(opts.preset ?? '')] ?? '';
  const ctx = Math.min(5, Math.max(0, Number(opts.ctx) || 0));      // 关联前几章
  const pickedChars = Array.isArray(opts.chars) ? opts.chars.map(String).slice(0, 8) : [];

  const sorted = [...(book.chapters ?? [])].sort((a, b) => a.index - b.index);
  const pos = sorted.findIndex((c) => c.id === chapter.id);
  const prev = pos > 0 ? sorted[pos - 1] : null;
  // 「关联前文」按用户选的章数带最近几章的结尾片段（默认 1 章），控制长度与消耗
  const ctxChapters = ctx > 0 ? sorted.slice(Math.max(0, pos - ctx), pos) : (prev ? [prev] : []);
  const ctxText = ctxChapters
    .map((c) => (c.text ? `第${c.index}章结尾：${c.text.slice(-600)}` : ''))
    .filter(Boolean)
    .join('\n\n');
  const memoryText = memoryToPrompt(book.memory ?? buildBookMemory(book.chapters ?? []), prev, {});

  const settings = book.settings ?? {};
  const user = `【作品】《${book.title}》${book.genre ? `｜${book.genre}` : ''}${book.audience ? `｜${book.audience}` : ''}
${settings.premise ? `一句话故事：${settings.premise}` : ''}

${preset ? `【这一段的要求】${preset}` : ''}

【人物（按 voice 说话，不得新造名字）】
${(pickedChars.length
    ? (settings.characters ?? []).filter((c) => pickedChars.includes(c.name))
    : (settings.characters ?? [])).map((c) => `- ${c.name}（${c.role || '角色'}）：要 ${c.want || '—'}；缺 ${c.flaw || '—'}；说话 ${c.voice || '—'}`).join('\n') || '（暂无人物表，按前文自行把握，不要起新名字）'}

【世界规则（不解释，只遵守）】
${(settings.world ?? []).map((w) => `- ${w.rule}${w.cost ? `（代价：${w.cost}）` : ''}`).join('\n') || '（无）'}

【连续性记忆】
${memoryText || '（这是第一章，没有前情）'}

${ctxText ? `【前文结尾（最近 ${ctxChapters.length} 章）】\n${ctxText}\n` : ''}
【本章】第 ${chapter.index} 章《${chapter.title}》
${settings.outline?.find((o) => o.index === chapter.index)?.goal ? `本章目标：${settings.outline.find((o) => o.index === chapter.index).goal}` : ''}
${instruction ? `作者要求：${instruction}` : ''}
目标字数：约 ${words} 字
${mode === 'continue' ? CONTINUE_RULES : DRAFT_RULES}
${mode === 'continue' && chapter.text ? `\n【已有正文（从这里接着写，不要重复）】\n${chapter.text.slice(-1500)}` : ''}

【不得编造】只用这里给出或前文出现过的人物、地点、时间与数字；不确定就留白，不要补一段看起来合理但没依据的内容。

__TASK__: novelchapter
__PARAMS__: ${JSON.stringify({ title: book.title, index: chapter.index, words })}`;

  const raw = String(await complete({ system: CHAPTER_SYSTEM, user }) ?? '');
  const clean = tidyChapterBody(raw).text;

  const text = mode === 'continue' && chapter.text
    ? `${chapter.text.trimEnd()}\n\n${clean}`
    : clean;

  // 覆盖前留一份（起草会整段替换空章，续写是追加——追加也留，方便整段回退）
  pushHistory(chapter, mode === 'draft' ? 'AI 起草前' : 'AI 续写前');

  chapter.text = text;
  chapter.words = wordCount(text);
  chapter.updatedAt = new Date().toISOString();
  chapter.mem = analyzeChapter(chapter.title, text, { cast: settings.characters ?? [] });
  book.memory = buildBookMemory(book.chapters ?? []);
  await repo.saveNovel(book);

  logger.info('novel.compose', { id, chapterId, mode, words: chapter.words });
  return { chapter, added: clean.length, memory: book.memory };
}

/* ============================ 章名 ============================ */

const TITLE_SYSTEM = `你是给章节起名的编辑。只输出一个章名，不要任何解释。
要求：8 字以内；不带「第N章」；不用书名号、引号、句号；要具体（能看出这一章发生了什么），
不要用「转折」「危机」这类空词；可以用人、物、动作或一句话里的关键意象。`;

/** 给一章起名：有正文就按正文，没有就按设定与大纲里的目标 */
export async function suggestTitle(id, chapterId) {
  const book = repo.getNovel(id);
  const chapter = (book.chapters ?? []).find((c) => c.id === chapterId);
  if (!chapter) throw notFound(`章节 ${chapterId} 不存在`);

  const outline = (book.settings?.outline ?? []).find((o) => o.index === chapter.index);
  const body = (chapter.text ?? '').slice(0, 1200);
  const user = `【作品】《${book.title}》${book.genre ? `｜${book.genre}` : ''}
${book.settings?.premise ? `一句话故事：${book.settings.premise}` : ''}
【本章】第 ${chapter.index} 章${outline?.goal ? `｜目标：${outline.goal}` : ''}
${body ? `【正文开头】\n${body}` : '（这一章还没写正文，按目标起一个合适的章名）'}

只输出章名。

__TASK__: noveltitle
__PARAMS__: ${JSON.stringify({ index: chapter.index, title: book.title })}`;

  const raw = String(await complete({ system: TITLE_SYSTEM, user }) ?? '');
  const title = raw.replace(/[「」“”"《》\s]/g, '').replace(/^第?\d+章?/, '').slice(0, 12);
  if (!title) throw badRequest('模型没有给出章名，请重试');

  chapter.title = title;
  chapter.updatedAt = new Date().toISOString();
  await repo.saveNovel(book);
  logger.info('novel.title', { id, chapterId, title });
  return { chapter, title };
}

/**
 * 批量起名：只处理「还是默认名」的章节（第N章 / 空 / 未命名），已改过的不动。
 * 一次最多 20 章——再多就是一次几十次调用，费用和等待都不合适。
 */
export async function autoTitles(id) {
  const book = repo.getNovel(id);
  const targets = (book.chapters ?? [])
    .filter((c) => !c.title || /^第\d+章$/.test(c.title) || c.title === '未命名')
    .sort((a, b) => a.index - b.index)
    .slice(0, 20);
  if (!targets.length) return { updated: [], skipped: (book.chapters ?? []).length };

  const updated = [];
  for (const ch of targets) {
    try {
      const r = await suggestTitle(id, ch.id);
      updated.push({ index: ch.index, title: r.title });
    } catch (e) {
      logger.warn('novel.title.fail', { id, index: ch.index, reason: e.message });
    }
  }
  return { updated, skipped: (book.chapters ?? []).length - updated.length };
}

/* ============================ 体检 / 导出 ============================ */

/** 本章 AI 痕迹扫描（纯本地，不花额度） */
export function scanChapter(id, chapterId) {
  const book = repo.getNovel(id);
  const chapter = (book.chapters ?? []).find((c) => c.id === chapterId);
  if (!chapter) throw notFound(`章节 ${chapterId} 不存在`);
  const report = analyzeText(chapter.text ?? '');
  return { report };
}

/**
 * 一键整理：清 Markdown 符号 → 统一中文标点 → 智能排版。
 * 纯本地、不动字词；改完留一份历史，后悔可还原。
 */
export async function tidyChapter(id, chapterId) {
  const book = repo.getNovel(id);
  const chapter = (book.chapters ?? []).find((c) => c.id === chapterId);
  if (!chapter) throw notFound(`章节 ${chapterId} 不存在`);
  const r = autoTidy(chapter.text ?? '');
  if (!r.changed) return { chapter, changed: false };
  pushHistory(chapter, '整理排版前');
  chapter.text = r.text;
  chapter.words = wordCount(chapter.text);
  chapter.updatedAt = new Date().toISOString();
  chapter.mem = analyzeChapter(chapter.title, chapter.text, { cast: book.settings?.characters ?? [] });
  book.memory = buildBookMemory(book.chapters ?? []);
  await repo.saveNovel(book);
  return { chapter, changed: true };
}

/** 时光机：把某一章的正文还原到历史版本（当前内容也先留一份） */
export async function restoreChapter(id, chapterId, ts) {
  const book = repo.getNovel(id);
  const chapter = (book.chapters ?? []).find((c) => c.id === chapterId);
  if (!chapter) throw notFound(`章节 ${chapterId} 不存在`);
  const snap = (chapter.history ?? []).find((h) => Number(h.ts) === Number(ts));
  if (!snap) throw notFound('没有这个历史版本');
  pushHistory(chapter, '还原前');
  chapter.text = snap.text;
  chapter.title = snap.title || chapter.title;
  chapter.words = wordCount(chapter.text);
  chapter.updatedAt = new Date().toISOString();
  chapter.mem = analyzeChapter(chapter.title, chapter.text, { cast: book.settings?.characters ?? [] });
  book.memory = buildBookMemory(book.chapters ?? []);
  await repo.saveNovel(book);
  return { chapter };
}

export function exportBook(id) {
  const book = repo.getNovel(id);
  const chapters = [...(book.chapters ?? [])].sort((a, b) => a.index - b.index);
  const lines = [`# ${book.title}`, ''];
  if (book.settings?.premise) lines.push(`> ${book.settings.premise}`, '');

  const meta = [book.genre && `题材：${book.genre}`, book.audience && `读者：${book.audience}`,
    book.targetWords && `目标：${book.targetWords} 字`].filter(Boolean).join('　');
  if (meta) lines.push(meta, '');

  if (book.settings?.characters?.length) {
    lines.push('## 人物', '');
    for (const c of book.settings.characters) {
      lines.push(`**${c.name}**（${c.role || '角色'}）　要：${c.want || '—'}　缺：${c.flaw || '—'}${c.voice ? `　说话：${c.voice}` : ''}`, '');
    }
  }

  for (const c of chapters) {
    lines.push('---', '', `## 第${c.index}章 ${c.title}`, '', c.text || '_（空章）_', '');
  }

  return {
    filename: `${book.title}-${new Date().toISOString().slice(0, 10)}.md`,
    text: lines.join('\n'),
    chapters: chapters.length,
    words: chapters.reduce((n, c) => n + (c.words ?? 0), 0),
  };
}
