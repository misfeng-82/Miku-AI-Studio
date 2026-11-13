/* SQLite 索引库（better-sqlite3）
 *
 * 定位：只做「索引 + 统计 + 导出流水」，不接管原有 JSON 存储。
 *   - 真正的作品/小说仍以 data/*.json 为准（repo 层不动），这里只是它们的只读投影。
 *   - 好处：作品变多后，列表/统计不用把上千个 JSON 全读进内存；删库也能随时重建。
 * 使用 WAL 模式，读写互不阻塞；索引数据可随时 rebuild。
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DB_PATH = resolve(process.cwd(), 'data', 'miku-index.db');

let db = null;

export function open() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      genre TEXT,
      episodes INTEGER,
      progress INTEGER,
      has_script INTEGER DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS novels (
      id TEXT PRIMARY KEY,
      title TEXT,
      chapters INTEGER,
      words INTEGER,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      target TEXT,
      filename TEXT,
      bytes INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      projects INTEGER,
      novels INTEGER
    );
  `);
  return db;
}

/** 用 repo 层拿到的摘要重建索引（幂等，可反复调用）。 */
export function sync({ projects = [], novels = [] } = {}) {
  const d = open();
  const now = new Date().toISOString();
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM projects').run();
    const insP = d.prepare('INSERT OR REPLACE INTO projects (id,name,genre,episodes,progress,has_script,updated_at) VALUES (?,?,?,?,?,?,?)');
    for (const p of projects) {
      insP.run(
        String(p.id ?? ''), String(p.name ?? ''), String(p.genre ?? ''),
        Number(p.episodes ?? 0) || 0, Number(p.progress ?? 0) || 0,
        p.hasScript ? 1 : 0, String(p.updatedAt ?? p.updated_at ?? now),
      );
    }
    d.prepare('DELETE FROM novels').run();
    const insN = d.prepare('INSERT OR REPLACE INTO novels (id,title,chapters,words,updated_at) VALUES (?,?,?,?,?)');
    for (const n of novels) {
      insN.run(
        String(n.id ?? ''), String(n.title ?? ''), Number(n.chapters ?? 0) || 0,
        Number(n.words ?? 0) || 0, String(n.updatedAt ?? n.updated_at ?? now),
      );
    }
    d.prepare('INSERT INTO sync_log (at,projects,novels) VALUES (?,?,?)').run(now, projects.length, novels.length);
  });
  tx();
  return { at: now, projects: projects.length, novels: novels.length };
}

/** 记录一次导出（谁导出、多大、什么时候）。 */
export function recordExport({ kind, target = '', filename = '', bytes = 0 }) {
  const d = open();
  d.prepare('INSERT INTO exports (kind,target,filename,bytes,created_at) VALUES (?,?,?,?,?)')
    .run(String(kind), String(target), String(filename), Number(bytes) || 0, new Date().toISOString());
}

export function listExports({ limit = 20 } = {}) {
  const d = open();
  const n = Math.min(200, Math.max(1, Number(limit) || 20));
  return d.prepare('SELECT kind,target,filename,bytes,created_at FROM exports ORDER BY id DESC LIMIT ?').all(n);
}

/** 汇总统计：直接 SQL 聚合，不再扫 JSON。 */
export function stats() {
  const d = open();
  const p = d.prepare('SELECT COUNT(*) c, COALESCE(SUM(episodes),0) eps, COALESCE(AVG(progress),0) avgp FROM projects').get();
  const n = d.prepare('SELECT COUNT(*) c, COALESCE(SUM(words),0) words, COALESCE(SUM(chapters),0) ch FROM novels').get();
  const e = d.prepare('SELECT COUNT(*) c, COALESCE(SUM(bytes),0) bytes FROM exports').get();
  const byGenre = d.prepare('SELECT genre, COUNT(*) c FROM projects GROUP BY genre ORDER BY c DESC').all();
  const lastSync = d.prepare('SELECT at,projects,novels FROM sync_log ORDER BY id DESC LIMIT 1').get() ?? null;
  return {
    db: DB_PATH,
    projects: { count: p.c, episodes: p.eps, avgProgress: Math.round(p.avgp) },
    novels: { count: n.c, words: n.words, chapters: n.ch },
    exports: { count: e.c, bytes: e.bytes },
    byGenre,
    lastSync,
  };
}

export function close() {
  if (db) { try { db.close(); } catch { /* 已关闭 */ } db = null; }
}
