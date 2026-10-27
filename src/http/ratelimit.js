/* 按 IP 限流（固定窗口）
 *
 * 为什么需要：公网部署后，一个脚本就能刷爆生成类接口（每次都要跑引擎），
 * 也能用来暴力猜访问口令。这里给一层最低成本的闸。
 *
 * 取舍：
 *   - 进程内内存计数：单实例够用，重启即清零。多实例部署时每个实例各算各的
 *     （要精确全局配额得引入 Redis，与「零依赖」冲突，暂不做）
 *   - 固定窗口而非滑动窗口：实现简单、行为可预测；窗口边界会有轻微突刺，可接受
 */
import { config } from '../config.js';
import { sendJson } from './router.js';

/** ip -> { count, resetAt } */
const buckets = new Map();
const MAX_BUCKETS = 20_000;

/** 超过上限时丢掉最早的一批，防止被大量不同 IP 撑爆内存 */
function pruneIfNeeded(now) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [ip, b] of buckets) {
    if (now > b.resetAt) buckets.delete(ip);
  }
  // 清完还超，就从最早插入的开始丢（Map 保持插入顺序）
  let overflow = buckets.size - MAX_BUCKETS;
  for (const ip of buckets.keys()) {
    if (overflow-- <= 0) break;
    buckets.delete(ip);
  }
}

/** 真实客户端 IP：云平台（Render 等）会把来源放在 X-Forwarded-For 最左一跳 */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * 限流中间件。返回 true 表示已拦截（调用方不要再往下走）。
 * @param {{max?: number, windowMs?: number, namespace?: string}} opts
 *   覆盖默认阈值；namespace 用于隔离不同用途的计数，
 *   否则登录端点的严格额度会被普通请求提前吃掉（第 5 次就 429）。
 */
export function withRateLimit(req, res, opts = {}) {
  const max = opts.max ?? config.rateLimit.max;
  const windowMs = opts.windowMs ?? config.rateLimit.windowMs;
  const ns = opts.namespace ?? 'global';
  if (!max || max <= 0) return false;

  const now = Date.now();
  const key = `${ns}:${clientIp(req)}`;
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
    pruneIfNeeded(now);
  }
  b.count += 1;

  res.setHeader('x-ratelimit-limit', String(max));
  res.setHeader('x-ratelimit-remaining', String(Math.max(0, max - b.count)));

  if (b.count > max) {
    const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    res.setHeader('retry-after', String(retryAfter));
    sendJson(res, 429, {
      error: { code: 'RATE_LIMITED', message: `请求过于频繁，请 ${retryAfter} 秒后再试` },
    });
    return true;
  }
  return false;
}

/** 供测试使用：重置计数 */
export function resetRateLimit() {
  buckets.clear();
}
