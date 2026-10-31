import { randomUUID } from 'node:crypto';
import { JsonStore } from './jsonStore.js';
import { notFound } from '../errors.js';
import { wordCount } from '../engine/novelGates.mjs';

/**
 * 小说作品仓（照墨笔的模型重做）
 *
 * 一本书 =
 *   { id, title, track, targetWords,
 *     settings: { premise, characters[], world[], outline[] },   // 设定（可空，边写边补）
 *     chapters: [{ id, index, title, text, words, mem, updatedAt }],
 *     memory: { arc[], characters[], places[], foreshadow[], timeline[] },
 *     createdAt, updatedAt }
 *
 * 与上一版的差别：上一版把书当「生成流水线的产物」（设定门 → 章纲 → 逐章生成），
 * 这一版把书当「正在写的手稿」——章节可以先有正文再补设定，也可以只写一章就导出。
 * 写作软件本来就该这样（墨笔就是这么做的）。
 */
const store = new JsonStore();
const INDEX_KEY = 'novel-index';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function createNovel(input = {}) {
  const now = new Date().toISOString();
  const book = {
    id: randomUUID(),
    schema: 'studio-v2',
    title: String(input.title ?? '').trim() || '未命名作品',
    // 轨道：网文 / 短篇 / 剧本（墨笔的三条）
    track: ['web-novel', 'short', 'screenplay'].includes(input.track) ? input.track : 'web-novel',
    genre: String(input.genre ?? '').trim(),
    audience: String(input.audience ?? '').trim() || '男频',
    style: String(input.style ?? '').trim(),
    targetWords: Number(input.targetWords) || 200000,
    settings: {
      premise: String(input.premise ?? '').trim(),
      characters: [],
      world: [],
      outline: [],
    },
    chapters: [],
    memory: null,
    createdAt: now,
    updatedAt: now,
  };
  store.write(`novel-${book.id}`, book);
  return book;
}

export async function indexNovel(book) {
  await store.update(INDEX_KEY, (idx) => ({
    items: [...idx.items.filter((it) => it.id !== book.id), { id: book.id, title: book.title, createdAt: book.createdAt }],
  }), { items: [] });
}

export function getNovel(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw notFound(`作品 ${id} 不存在`);
  try {
    return migrate(store.read(`novel-${id}`));
  } catch (err) {
    if (err.code === 'NOT_FOUND') throw notFound(`作品 ${id} 不存在`);
    throw err;
  }
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
  return true;
}

export function listNovels() {
  const idx = store.read(INDEX_KEY, { items: [] });
  const out = [];
  for (const it of idx.items) {
    try {
      out.push(summary(getNovel(it.id)));
    } catch { /* 索引里有、文件没了：跳过，不让整个列表挂掉 */ }
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}

/**
 * 旧数据迁移：上一版的书有 bible / outline、章节只有 text。
 * 读到就转成新模型，不丢一个字（字数按新口径重算）。
 */
function migrate(book) {
  if (!book || book.schema === 'studio-v2') return book;

  const settings = book.settings ?? {
    premise: book.logline ?? book.bible?.promise?.sellingPoint ?? '',
    characters: (book.bible?.characters ?? []).map((c) => ({
      name: c.name, role: c.role, want: c.want, flaw: c.flaw, voice: c.voice,
    })),
    world: (book.bible?.world ?? []).map((w) => ({ rule: w.rule, cost: w.cost, bound: w.bound })),
    outline: (book.outline?.chapters ?? []).map((c) => ({
      index: c.index, title: c.title, goal: c.goal, conflict: c.conflict, hook: c.hook,
    })),
  };

  const chapters = (book.chapters ?? []).map((c, i) => ({
    id: c.id ?? `ch-${c.index ?? i + 1}`,
    index: c.index ?? i + 1,
    title: c.title ?? '',
    text: c.text ?? '',
    words: wordCount(c.text ?? ''),
    mem: c.memory ?? c.mem ?? null,
    updatedAt: c.writtenAt ?? book.updatedAt ?? new Date().toISOString(),
  }));

  return {
    ...book,
    schema: 'studio-v2',
    track: book.track ?? 'web-novel',
    settings,
    chapters,
    memory: book.memory ?? null,
  };
}

export function summary(book) {
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const written = chapters.filter((c) => c?.text);
  return {
    id: book.id,
    title: book.title,
    track: book.track,
    genre: book.genre ?? '',
    targetWords: book.targetWords,
    chapters: chapters.length,
    written: written.length,
    words: written.reduce((n, c) => n + (c.words ?? 0), 0),
    updatedAt: book.updatedAt,
    createdAt: book.createdAt,
    lastChapter: written.length ? (written[written.length - 1].title || `第${written.length}章`) : '',
  };
}

export { wordCount };
