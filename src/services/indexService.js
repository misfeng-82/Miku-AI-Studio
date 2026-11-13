/* 索引同步服务：把 repo 层的作品/小说摘要投影进 SQLite。
 *
 * 单独成文件的原因：接口层（api.js）和启动流程（server.js 的定时任务）都要用同一套映射，
 * 如果各自写一份，字段一改就漂移——一个说 chapters、一个说 chapterCount。
 */
import * as projectRepo from '../repo/projectRepo.js';
import * as studio from './novelStudio.js';
import * as indexDb from '../repo/indexDb.js';

export async function buildRows() {
  const projects = (await projectRepo.listProjects()).map((p) => ({
    id: p.id,
    name: p.name,
    genre: p.genre ?? '',
    episodes: p.episodes ?? 0,
    progress: p.progress ?? 0,
    hasScript: Boolean(p.hasScript ?? (Number(p.progress ?? 0) > 0)),
    updatedAt: p.updatedAt ?? p.createdAt ?? '',
  }));
  const novels = studio.listBooks().map((n) => ({
    id: n.id,
    title: n.title ?? '',
    chapters: n.chapters ?? 0,
    words: n.words ?? 0,
    updatedAt: n.updatedAt ?? '',
  }));
  return { projects, novels };
}

/** 重建索引并返回同步结果。幂等，可反复调用。 */
export async function syncNow() {
  const rows = await buildRows();
  return indexDb.sync(rows);
}
