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

  const prevIdx = chapter.index - 1;
  const prev = (book.chapters ?? []).find((c) => c.index === prevIdx) ?? null;
  const memoryText = memoryToPrompt(book.memory ?? buildBookMemory(book.chapters ?? []), prev, {});

  const settings = book.settings ?? {};
  const user = `【作品】《${book.title}》${book.genre ? `｜${book.genre}` : ''}${book.audience ? `｜${book.audience}` : ''}
${settings.premise ? `一句话故事：${settings.premise}` : ''}

【人物（按 voice 说话，不得新造名字）】
${(settings.characters ?? []).map((c) => `- ${c.name}（${c.role || '角色'}）：要 ${c.want || '—'}；缺 ${c.flaw || '—'}；说话 ${c.voice || '—'}`).join('\n') || '（暂无人物表，按前文自行把握，不要起新名字）'}

【世界规则（不解释，只遵守）】
${(settings.world ?? []).map((w) => `- ${w.rule}${w.cost ? `（代价：${w.cost}）` : ''}`).join('\n') || '（无）'}

【连续性记忆】
${memoryText || '（这是第一章，没有前情）'}

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

  chapter.text = text;
  chapter.words = wordCount(text);
  chapter.updatedAt = new Date().toISOString();
  chapter.mem = analyzeChapter(chapter.title, text, { cast: settings.characters ?? [] });
  book.memory = buildBookMemory(book.chapters ?? []);
  await repo.saveNovel(book);

  logger.info('novel.compose', { id, chapterId, mode, words: chapter.words });
  return { chapter, added: clean.length, memory: book.memory };
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
