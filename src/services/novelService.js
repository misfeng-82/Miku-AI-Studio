/**
 * 小说创作服务：设定集 → 章纲 → 逐章正文（每章过门）
 *
 * 链路来源：「绘梦」的 create-book / write-chapter 两条流水线，压成三个可单独重跑的动作：
 *   1) planBible   设定集（人物/世界/核心承诺）
 *   2) planOutline 章纲 + 伏笔台账 + 分卷
 *   3) writeChapter 单章正文 → 扫描 → 过门 → 不过带诊断重修一轮 → 落盘
 *
 * 三个动作分开暴露，是因为长篇写到第 40 章时，用户经常只改「这一章」或
 * 只重跑「大纲」，不该逼着他把整条链再走一遍（也白花钱）。
 *
 * 门禁全部是确定性的（engine/novelGates.mjs + 13 维 AI 痕迹扫描），
 * 模型只负责「写」，不负责「评判自己写得对不对」。
 */
import { complete, completeJson } from '../agent/llm.js';
import { logger } from '../logger.js';
import { badRequest, notFound } from '../errors.js';
import * as repo from '../repo/novelRepo.js';
import { analyzeText } from '../engine/deaiScan.mjs';
import { bookGates, chapterGates, readiness, wordCount } from '../engine/novelGates.mjs';
import {
  BIBLE_SYSTEM, bibleUser, OUTLINE_SYSTEM, outlineUser, CHAPTER_SYSTEM, chapterUser,
} from '../assets/novelPrompts.js';

/** 一章重写几次：第一次按规范写，第二次带门禁诊断修；再多就交给人 */
const REPAIR_ROUNDS = 1;
/** 章数上下限：太少的「长篇」不成立，太多一次生成会失控 */
const MIN_CHAPTERS = 6;
const MAX_CHAPTERS = 240;
/** 初稿的 AI 痕迹上限（定稿线是 40，初稿放宽，见「去 AI 味」工具） */
const DRAFT_SCAN = 55;

/* ============================ 立项 ============================ */

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

/** 删书：只摘索引，正文文件留在磁盘上（误删可找回，与项目仓口径一致） */
export async function removeBook(id) {
  return repo.deleteNovel(id);
}

/** 一本书的完整视图：书 + 设定门 + 就绪度（前端一次拿全，少跑一趟） */
export function detail(id) {
  const book = repo.getNovel(id);
  const gates = bookGates(book);
  return { book, gates, readiness: readiness(book) };
}

/* ============================ 设定集 ============================ */

/** 模型返回的 JSON 只信字段，不信结构：缺的补空、多的丢掉、类型不对的纠正 */
function normalizeBible(raw) {
  const promise = raw?.promise ?? {};
  const characters = (Array.isArray(raw?.characters) ? raw.characters : [])
    .filter((c) => c && String(c.name ?? '').trim())
    .slice(0, 12)
    .map((c) => ({
      name: String(c.name).trim(),
      role: String(c.role ?? '配角').trim(),
      want: String(c.want ?? '').trim(),
      flaw: String(c.flaw ?? '').trim(),
      voice: String(c.voice ?? '').trim(),
      arc: String(c.arc ?? '').trim(),
    }));
  const world = (Array.isArray(raw?.world) ? raw.world : [])
    .filter((w) => w && String(w.rule ?? '').trim())
    .slice(0, 12)
    .map((w) => ({
      rule: String(w.rule).trim(),
      cost: String(w.cost ?? '').trim(),
      bound: String(w.bound ?? '').trim(),
    }));
  return {
    promise: {
      sellingPoint: String(promise.sellingPoint ?? '').trim(),
      theme: String(promise.theme ?? '').trim(),
      ending: String(promise.ending ?? '').trim(),
    },
    characters,
    world,
    generatedAt: new Date().toISOString(),
  };
}

export async function planBible(id) {
  const book = repo.getNovel(id);
  const raw = await completeJson({ system: BIBLE_SYSTEM, user: bibleUser(book) });
  const bible = normalizeBible(raw);

  if (!bible.characters.length) throw badRequest('模型没有给出可用的人物档案，请重试一次');

  book.bible = bible;
  await repo.saveNovel(book);
  logger.info('novel.bible', { id, characters: bible.characters.length, world: bible.world.length });

  const gates = bookGates(book);
  return { bible, gates };
}

/* ============================ 章纲 ============================ */

/** 按目标字数推算章数，夹在合理区间里（模型自己算容易算飞） */
export function planChapters(book) {
  const per = Number(book.wordsPerChapter) || 3000;
  const target = Number(book.targetWords) || 200000;
  const want = Math.round(target / per);
  return Math.min(MAX_CHAPTERS, Math.max(MIN_CHAPTERS, want));
}

function normalizeOutline(raw, plan) {
  const chapters = (Array.isArray(raw?.chapters) ? raw.chapters : [])
    .map((c, i) => ({
      index: Number(c?.index) || i + 1,
      title: String(c?.title ?? `第${i + 1}章`).trim(),
      goal: String(c?.goal ?? '').trim(),
      conflict: String(c?.conflict ?? '').trim(),
      turn: String(c?.turn ?? '').trim(),
      hook: String(c?.hook ?? '').trim(),
      characters: Array.isArray(c?.characters) ? c.characters.map((x) => String(x).trim()).filter(Boolean) : [],
    }))
    .sort((a, b) => a.index - b.index);

  // 模型偶尔会跳号或重号：重排成连续章号，否则「写第 N 章」会对不上
  chapters.forEach((c, i) => { c.index = i + 1; });

  const total = chapters.length;
  const foreshadow = (Array.isArray(raw?.foreshadow) ? raw.foreshadow : [])
    .filter((f) => f && String(f.content ?? '').trim())
    .slice(0, 40)
    .map((f, i) => {
      const plant = Math.min(total, Math.max(1, Number(f.plantAt) || 1));
      const pay = Math.min(total, Math.max(plant + 1, Number(f.payoffAt) || total));
      return {
        id: String(f.id ?? `F${i + 1}`).trim(),
        content: String(f.content).trim(),
        plantAt: plant,
        payoffAt: pay,
        tier: Number(f.tier) || 2,
      };
    });

  const volumes = (Array.isArray(raw?.volumes) ? raw.volumes : [])
    .filter((v) => v && String(v.name ?? '').trim())
    .map((v, i) => ({
      name: String(v.name).trim(),
      from: Math.max(1, Number(v.from) || i * 10 + 1),
      to: Math.min(total, Number(v.to) || total),
      climax: String(v.climax ?? '').trim(),
    }));

  return { chapters, foreshadow, volumes, generatedAt: new Date().toISOString(), planned: plan };
}

export async function planOutline(id) {
  const book = repo.getNovel(id);
  if (!book.bible) throw badRequest('先出设定集（人物/世界观），再排章纲：没有人物就没有冲突');
  const plan = planChapters(book);
  const raw = await completeJson({ system: OUTLINE_SYSTEM, user: outlineUser(book, plan) });
  const outline = normalizeOutline(raw, plan);

  if (!outline.chapters.length) throw badRequest('模型没有给出章纲，请重试一次');

  book.outline = outline;
  await repo.saveNovel(book);
  logger.info('novel.outline', { id, chapters: outline.chapters.length, plan, foreshadow: outline.foreshadow.length });

  return { outline, gates: bookGates(book), plan };
}

/* ============================ 章节正文 ============================ */

/** 模型偶尔会把「# 第N章 标题」也吐出来，去掉，标题已经存在章纲里 */
function stripHeading(text) {
  return String(text ?? '')
    .replace(/^\s*#{1,3}\s*第\s*[\d一二三四五六七八九十]+\s*章[^\n]*\n+/, '')
    .replace(/^\s*以下是[^\n]*\n+/, '')
    .trim();
}

export async function writeChapter(id, index) {
  const book = repo.getNovel(id);
  if (!book.outline?.chapters?.length) throw badRequest('先排章纲，再写正文');

  const idx = Number(index);
  const entry = book.outline.chapters.find((c) => c.index === idx);
  if (!entry) throw notFound(`大纲里没有第 ${idx} 章`);

  const existing = (book.chapters ?? []).find((c) => c.index === idx);
  const prev = (book.chapters ?? []).find((c) => c.index === idx - 1) ?? null;

  let text = '';
  let scan = null;
  let gates = [];
  let error = '';

  for (let round = 0; round <= REPAIR_ROUNDS; round += 1) {
    const problems = round === 0 ? [] : gates.filter((g) => !g.ok).map((g) => ({ label: g.label, detail: g.detail }));
    const raw = await complete({
      system: CHAPTER_SYSTEM,
      user: chapterUser({ book, chapter: entry, prevText: prev?.text ?? '', problems }),
    });
    text = stripHeading(raw);
    if (wordCount(text) < 200) {
      error = '模型返回的正文过短，已丢弃这一版';
      logger.warn('novel.chapter.short', { id, index: idx, round, words: wordCount(text) });
      continue;
    }

    scan = analyzeText(text);
    const chapter = { index: idx, title: entry.title, text, words: wordCount(text), scan: { score: scan.score, grade: scan.grade }, gates: [] };
    gates = chapterGates({ book, chapter, prev, maxScan: DRAFT_SCAN });
    if (gates.every((g) => g.ok)) { error = ''; break; }
    error = gates.filter((g) => !g.ok).map((g) => g.label).join('、');
    logger.info('novel.chapter.gates', { id, index: idx, round, failed: gates.filter((g) => !g.ok).map((g) => g.id) });
  }

  if (!text) throw badRequest(error || '这一章没有写出可用正文，请重试');

  const chapter = {
    index: idx,
    title: entry.title,
    text,
    words: wordCount(text),
    scan: scan ? { score: scan.score, grade: scan.grade } : null,
    gates,
    report: scan ? { dimensions: scan.dimensions, issues: scan.issues, clicheTotal: scan.clicheTotal } : null,
    ok: gates.every((g) => g.ok),
    error,
    writtenAt: new Date().toISOString(),
  };

  book.chapters = [...(book.chapters ?? []).filter((c) => c.index !== idx), chapter].sort((a, b) => a.index - b.index);
  await repo.saveNovel(book);
  logger.info('novel.chapter.saved', { id, index: idx, words: chapter.words, score: chapter.scan?.score ?? null, ok: chapter.ok });

  return { chapter, gates, readiness: readiness(book) };
}

/** 已有章节换一版（用户不满意时重写同一章，不动别的） */
export async function rewriteChapter(id, index) {
  return writeChapter(id, index);
}

/* ============================ 导出 ============================ */

export function exportBook(id) {
  const book = repo.getNovel(id);
  const chapters = [...(book.chapters ?? [])].sort((a, b) => a.index - b.index);
  const lines = [];

  lines.push(`# ${book.title}`, '');
  if (book.logline) lines.push(`> ${book.logline}`, '');
  const meta = [book.genre && `题材：${book.genre}`, book.audience && `读者：${book.audience}`, `目标：${book.targetWords} 字`]
    .filter(Boolean).join('　');
  if (meta) lines.push(meta, '');

  if (book.bible?.characters?.length) {
    lines.push('## 人物', '');
    for (const c of book.bible.characters) {
      lines.push(`**${c.name}**（${c.role}）　要：${c.want || '—'}　缺：${c.flaw || '—'}${c.voice ? `　说话：${c.voice}` : ''}`, '');
    }
  }
  if (book.bible?.world?.length) {
    lines.push('## 世界规则', '');
    for (const w of book.bible.world) lines.push(`- ${w.rule}${w.cost ? `（代价：${w.cost}）` : ''}`);
    lines.push('');
  }
  if (book.outline?.foreshadow?.length) {
    lines.push('## 伏笔台账', '', '| ID | 内容 | 埋设 | 回收 |', '|---|---|---|---|');
    for (const f of book.outline.foreshadow) lines.push(`| ${f.id} | ${f.content} | 第${f.plantAt}章 | 第${f.payoffAt}章 |`);
    lines.push('');
  }

  if (!chapters.length) lines.push('## 正文', '', '_（还没有写正文）_');
  for (const c of chapters) {
    lines.push('---', '', `## 第${c.index}章 ${c.title}`, '', c.text, '');
  }

  const words = chapters.reduce((n, c) => n + (c.words ?? 0), 0);
  return {
    filename: `${book.title}-${new Date().toISOString().slice(0, 10)}.md`,
    text: lines.join('\n'),
    chapters: chapters.length,
    words,
  };
}
