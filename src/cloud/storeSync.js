/**
 * 本地 JSON ⇄ 云数据库 同步
 *
 * 目的：沙箱重建（重新发布）时作品不丢。
 * 做法：**本地优先、云端兜底**——
 *   · 启动时先从云端把每一条拉下来覆盖本地（沙箱是新的，本地通常是空的）
 *   · 每次写本地成功后，异步 upsert 到云端（不阻塞请求、失败只记日志）
 *
 * 为什么不做成「每次读都查云端」：仓储层是同步 API（`getNovel` 直接返回对象），
 * 改成全异步要动十几个文件，收益一样（本机单实例，本地就是最新）。
 *
 * 一条硬规矩：**settings / cloud 这类含密钥的键永不同步**。
 */
import { cloudClient, publicConfig } from './client.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

/** 不同步的键：含 API Key 或云服务自身配置 */
const NEVER_SYNC = /(^|[^a-z])(settings|cloud|usage)([^a-z]|$)|settings|cloud/i;

/**
 * 同步是否可用。
 *
 * USE_MOCK=1（测试）时**必须关掉**：否则跑 featuretest 会把 141 个用例的
 * 临时作品全塞进生产库；test 数据混进用户作品，是最难清的那种脏。
 */
export function syncEnabled() {
  if (config.llm.useMock) return false;
  return publicConfig() !== null;
}

const client = () => cloudClient();

/**
 * 拉取分两类，因为体积差 200 倍：
 *   · 轻量（小说、索引、榜单）几十 KB → 启动时阻塞拉完，保证第一个请求就有数据
 *   · 重量（project-*，含完整剧本与分镜，实测 18 MB / 10 秒）→ 启动后后台慢慢拉，
 *     否则服务会卡在启动阶段，平台探活直接判超时
 */
export async function pullLight() {
  const cloud = client();
  if (!cloud) return [];
  const { data, error } = await cloud.database
    .from('kv_store').select('key, value').not('key', 'like', 'project-%');
  if (error) throw new Error(error.message ?? '读取云数据库失败');
  return (data ?? []).filter((row) => row?.key && !NEVER_SYNC.test(row.key));
}

/**
 * 重量数据流式拉取：8 页并发，**每页一到就交给 onPage 落盘**。
 * 不攒到最后再写——那样用户要等 12 秒才能看到任何项目；
 * 流式以后第一批项目 ~3 秒就能点开。
 */
export async function streamHeavy(onPage, { pageSize = 16, pages = 8 } = {}) {
  const cloud = client();
  if (!cloud) return { rows: 0 };
  const seen = new Set();
  let total = 0;
  await Promise.all(Array.from({ length: pages }, async (_, i) => {
    const { data, error } = await cloud.database
      .from('kv_store').select('key, value').like('key', 'project-%')
      .order('updated_at', { ascending: false })   // 最近改过的项目先落地
      .range(i * pageSize, i * pageSize + pageSize - 1);
    if (error) throw new Error(error.message ?? '读取云数据库失败');
    const rows = (data ?? []).filter((r) => r?.key && !NEVER_SYNC.test(r.key) && !seen.has(r.key));
    for (const r of rows) seen.add(r.key);
    if (rows.length) { total += onPage(rows); }
  }));
  return { rows: total };
}

/** 一次性拉全部重量数据（脚本/测试用） */
export async function pullHeavy() {
  const all = [];
  await streamHeavy((rows) => { all.push(...rows); return rows.length; });
  return all;
}

/** 写一条（upsert） */
export async function pushOne(key, value) {
  if (NEVER_SYNC.test(key)) return;
  const cloud = client();
  if (!cloud) return;
  const { error } = await cloud.database
    .from('kv_store')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message ?? '写入云数据库失败');
}

/** 删一条（本地删除时调用） */
export async function removeOne(key) {
  if (NEVER_SYNC.test(key)) return;
  const cloud = client();
  if (!cloud) return;
  const { error } = await cloud.database.from('kv_store').delete().eq('key', key);
  if (error) throw new Error(error.message ?? '删除云数据失败');
}

/**
 * 把本地全量推上去（首次接入时把已有作品搬上去）。
 * 走批量 upsert，几百条以内一次就够。
 */
export async function pushAll(entries) {
  const cloud = client();
  if (!cloud) return { pushed: 0 };
  const rows = entries
    .filter(([key]) => !NEVER_SYNC.test(key))
    .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  if (!rows.length) return { pushed: 0 };
  const { error } = await cloud.database.from('kv_store').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error(error.message ?? '批量写入云数据库失败');
  return { pushed: rows.length };
}

/**
 * 单个键的写入队列：同一键 400ms 内的多次写入合并成一次，
 * 避免「打字自动保存」把云端打成筛子。
 */
const timers = new Map();
const pending = new Map();

/**
 * 回灌开关：从云端拉下来写本地时，必须关掉推送——
 * 否则「拉 139 行 → 写本地 → 每写一行又推回云端」，等于把 18MB 再上传一遍。
 */
let suppress = false;
export function setSuppress(v) { suppress = Boolean(v); }

export function queuePush(key, value) {
  if (suppress || !syncEnabled() || NEVER_SYNC.test(key)) return;
  pending.set(key, value);
  if (timers.has(key)) return;
  timers.set(key, setTimeout(async () => {
    timers.delete(key);
    const v = pending.get(key);
    pending.delete(key);
    if (v === undefined) return;
    try {
      await pushOne(key, v);
    } catch (err) {
      logger.warn('cloud.db.push.fail', { key, reason: String(err.message).slice(0, 120) });
    }
  }, 400));
}

export function queueRemove(key) {
  if (suppress || !syncEnabled() || NEVER_SYNC.test(key)) return;
  pending.delete(key);
  removeOne(key).catch((err) => logger.warn('cloud.db.remove.fail', { key, reason: String(err.message).slice(0, 120) }));
}
