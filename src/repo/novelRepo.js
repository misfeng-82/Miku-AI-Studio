import { randomUUID } from 'node:crypto';
import { JsonStore } from './jsonStore.js';
import { notFound } from '../errors.js';
import { wordCount } from '../engine/novelGates.mjs';

/**
 * 小说作品仓（单本一文件 + 一份索引）
 *
 * 为什么和 projectRepo 分开存：
 *   项目（project）是「一次创作流程的容器」，带 crawl/script/storyboard 这些阶段；
 *   小说是「一本能写几十万字的书」，有自己的章节序列、伏笔台账与设定集。
 *   硬塞进同一个索引，作品库里会一半是剧本一半是小说，列表语义就脏了。
 *
 * 为什么一本一个文件而不是一个大数组：
 *   写到二十万字时单本 JSON 就有几百 KB，任何一次保存都重写整个数组会越来越慢；
 *   一本一文件只重写被改的那本。
 */
const store = new JsonStore();
const INDEX_KEY = 'novel-index';

// 和 projectRepo 同样的理由：脏 id 是「查不到」，不是服务器错误
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const DEFAULT_TARGET = 200000;
const DEFAULT_PER_CHAPTER = 3000;

export function createNovel(input = {}) {
  const now = new Date().toISOString();
  const book = {
    id: randomUUID(),
    title: String(input.title ?? '').trim() || '未命名长篇',
    genre: String(input.genre ?? '').trim(),
    logline: String(input.logline ?? '').trim(),
    audience: String(input.audience ?? '').trim() || '男频',
    tone: String(input.tone ?? '').trim(),
    style: String(input.style ?? '').trim(),
    forbidden: String(input.forbidden ?? '').trim(),
    targetWords: Number(input.targetWords) || DEFAULT_TARGET,
    wordsPerChapter: Number(input.wordsPerChapter) || DEFAULT_PER_CHAPTER,
    bible: null,
    outline: null,
    chapters: [],
    createdAt: now,
    updatedAt: now,
  };
  store.write(`novel-${book.id}`, book);
  return book;
}

/** 建完立刻进索引：调用方随后查列表必须能看到（与 projectRepo 同一处坑） */
export async function indexNovel(book) {
  await store.update(INDEX_KEY, (idx) => ({
    items: [...idx.items.filter((it) => it.id !== book.id), { id: book.id, title: book.title, createdAt: book.createdAt }],
  }), { items: [] });
}

export function getNovel(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw notFound(`小说 ${id} 不存在`);
  try {
    return migrateWordCount(store.read(`novel-${id}`));
  } catch (err) {
    if (err.code === 'NOT_FOUND') throw notFound(`小说 ${id} 不存在`);
    throw err;
  }
}

/**
 * 旧稿的字数是「含标点」的算法（4500 字里可能有一千个标点）。
 * 这里在读的时候按新口径重算一遍并打标记，下次保存时自然落盘。
 * 不做成阻塞式迁移脚本：书是用户数据，能就地算就别动文件。
 */
function migrateWordCount(book) {
  if (!book || book.countV2) return book;
  for (const c of book.chapters ?? []) {
    if (c?.text) {
      c.words = wordCount(c.text);
      c.countV2 = true;
    }
  }
  if (book.memory) {
    book.memory.totalChars = (book.chapters ?? []).reduce((n, c) => n + (c.words ?? 0), 0);
  }
  book.countV2 = true;
  return book;
}

export async function saveNovel(book) {
  book.updatedAt = new Date().toISOString();
  store.write(`novel-${book.id}`, book);
  await store.update(INDEX_KEY, (idx) => ({
    items: idx.items.map((it) => (it.id === book.id ? { ...it, title: book.title } : it)),
  }), { items: [] });
  return book;
}

export async function deleteNovel(id) {
  getNovel(id);
  await store.update(INDEX_KEY, (idx) => ({ items: idx.items.filter((it) => it.id !== id) }), { items: [] });
  // 只摘索引、不删正文文件：误删可找回，与项目仓的软删除保持一致
  return true;
}

export function listNovels() {
  const idx = store.read(INDEX_KEY, { items: [] });
  const out = [];
  for (const it of idx.items) {
    try {
      out.push(summary(getNovel(it.id)));
    } catch {
      // 索引里有、文件没了（手工删过 data 目录）：跳过这条，不让整个列表挂掉
    }
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

export function summary(book) {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const written = chapters.filter((c) => c?.text);
  const words = written.reduce((n, c) => n + (c.words ?? 0), 0);
  const scanned = written.filter((c) => typeof c.scan?.score === 'number');
  return {
    id: book.id,
    title: book.title,
    genre: book.genre,
    logline: book.logline,
    targetWords: book.targetWords,
    wordsPerChapter: book.wordsPerChapter,
    planned: book.outline?.chapters?.length ?? 0,
    written: written.length,
    words,
    avgScan: scanned.length
      ? Math.round((scanned.reduce((n, c) => n + c.scan.score, 0) / scanned.length) * 10) / 10
      : null,
    hasBible: Boolean(book.bible),
    hasOutline: Boolean(book.outline),
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}
