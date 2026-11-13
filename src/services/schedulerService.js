/* 定时任务（node-cron）
 *
 * 两个内置任务：
 *   - index-sync：每 10 分钟把作品/小说摘要同步进 SQLite 索引（纯本地，零风险）
 *   - hot-refresh：每周自动爬一次爆款榜单（周期由 CRAWL_CRON 决定，默认每周一 09:00；可能联网，失败只记录不影响服务）
 * 所有任务失败都被捕获并记录在状态里——定时任务不允许把主服务搞挂。
 */
import cron from 'node-cron';
import { logger } from '../logger.js';

const jobs = new Map();
let started = false;

/**
 * 注册并启动任务。
 * @param {Array<{id:string,name:string,cron:string,enabled?:boolean,run:Function}>} defs
 */
export function start(defs = []) {
  if (started) return list();
  started = true;
  for (const def of defs) {
    const state = {
      id: def.id,
      name: def.name,
      cron: def.cron,
      enabled: def.enabled !== false,
      runs: 0,
      failures: 0,
      lastRunAt: null,
      lastError: null,
      lastResult: null,
      task: null,
      runner: def.run,
    };
    jobs.set(def.id, state);
    if (!state.enabled) continue;
    if (!cron.validate(def.cron)) {
      state.enabled = false;
      state.lastError = `非法 cron 表达式：${def.cron}`;
      logger.warn('scheduler.invalid', { id: def.id, cron: def.cron });
      continue;
    }
    state.task = cron.schedule(def.cron, () => { execute(def.id, 'auto'); }, { scheduled: true });
    logger.info('scheduler.registered', { id: def.id, cron: def.cron });
  }
  return list();
}

/** 执行一个任务（自动触发或手动触发走同一条路径）。 */
export async function execute(id, trigger = 'manual') {
  const state = jobs.get(id);
  if (!state) throw new Error(`没有这个定时任务：${id}`);
  const at = new Date().toISOString();
  try {
    const result = await state.runner();
    state.runs += 1;
    state.lastRunAt = at;
    state.lastError = null;
    state.lastResult = summarize(result);
    logger.info('scheduler.run', { id, trigger, ok: true });
    return { ok: true, id, trigger, at, result: state.lastResult };
  } catch (e) {
    state.runs += 1;
    state.failures += 1;
    state.lastRunAt = at;
    state.lastError = e?.message ?? String(e);
    state.lastResult = null;
    logger.warn('scheduler.run.failed', { id, trigger, error: state.lastError });
    return { ok: false, id, trigger, at, error: state.lastError };
  }
}

/** 任务状态列表（给接口/界面看的）。 */
export function list() {
  return {
    started,
    jobs: [...jobs.values()].map((s) => ({
      id: s.id, name: s.name, cron: s.cron, enabled: s.enabled,
      runs: s.runs, failures: s.failures,
      lastRunAt: s.lastRunAt, lastError: s.lastError, lastResult: s.lastResult,
      // 下次触发时间：让界面能直接回答「这个每周任务什么时候跑」
      nextRun: s.enabled ? nextRunOf(s) : null,
    })),
  };
}

/** node-cron 的 ScheduledTask 有 getNextRun()；取不到就返回 null，不影响列表。 */
function nextRunOf(s) {
  try {
    const d = s.task?.getNextRun?.();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  } catch {
    return null;
  }
}

export function stop(id) {
  const s = jobs.get(id);
  if (!s) return false;
  s.task?.stop();
  s.enabled = false;
  logger.info('scheduler.stop', { id });
  return true;
}

export function startOne(id) {
  const s = jobs.get(id);
  if (!s) return false;
  s.task?.start();
  s.enabled = true;
  logger.info('scheduler.start', { id });
  return true;
}

export function shutdown() {
  for (const s of jobs.values()) { try { s.task?.stop(); } catch { /* 忽略 */ } }
  jobs.clear();
  started = false;
}

function summarize(r) {
  if (r === null || r === undefined) return null;
  if (typeof r === 'object') {
    const keys = Object.keys(r);
    if (keys.length <= 6) return r;
    return { keys: keys.slice(0, 6), _more: keys.length - 6 };
  }
  return String(r).slice(0, 200);
}
