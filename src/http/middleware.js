import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { config, isProduction } from '../config.js';
import { logger } from '../logger.js';
import { sendJson, sendText } from './router.js';
import { AppError, badRequest, internalError } from '../errors.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function withRequestId(req, res) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.id);
  req.log = logger.child(req.id);
}

export function withSecurity(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-xss-protection', '0');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  // HSTS 只在生产下发：本地是 http，发了会让浏览器强行跳 https，把开发环境搞坏。
  // 云平台（Render 等）由反向代理终止 TLS，对客户端来说确实是 https，此时该发。
  if (isProduction()) {
    res.setHeader('strict-transport-security', 'max-age=15552000; includeSubDomains');
  }
}

export function withCors(req, res) {
  const origin = req.headers.origin;
  // 生产环境禁用通配：只回显显式白名单里的来源
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  } else if (!origin) {
    res.setHeader('access-control-allow-origin', config.corsOrigins[0] ?? '*');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-request-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

const MAX_BODY = 8 * 1024 * 1024;

export async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'OPTIONS') return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw badRequest('请求体过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('请求体不是合法 JSON');
  }
}

export async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  // 归一化后仍以 .. 开头说明试图穿越目录
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const target = resolve(join(config.publicDir, safe));
  if (!target.startsWith(resolve(config.publicDir))) {
    sendText(res, 403, 'Forbidden');
    return true;
  }
  try {
    const buf = await readFile(target);
    const ext = extname(target);
    let body = buf;
    // HTML 入口的静态资源引用注入 mtime 版本：前端文件一改，URL 就变，
    // 浏览器必然重新拉取——不用手动硬刷，也不用人工维护版本号。
    if (ext === '.html') {
      let html = buf.toString('utf8');
      // favicon 必须一起进这个列表：浏览器的 favicon 缓存是独立存储、极其顽固，
      // 文件名不变就永远不重新取（Ctrl+R 也不一定管用）。加 mtime 版本号才能真正刷新。
      for (const asset of ['/app.js', '/styles.css', '/favicon.svg']) {
        try {
          const st = await stat(resolve(join(config.publicDir, asset.slice(1))));
          html = html.split(`${asset}"`).join(`${asset}?v=${Math.floor(st.mtimeMs)}"`);
        } catch { /* 资源不存在就跳过，不影响页面本身 */ }
      }
      body = Buffer.from(html, 'utf8');
    }
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': body.length,
      // 开发环境用 no-store：前端改完刷新即生效，不用手动硬刷。
      // 早先用 no-cache 时内置浏览器会拿 memory cache 里的旧 app.js，
      // 导致「代码已改、页面行为还是旧的」；生产环境仍走协商缓存省流量。
      'cache-control': isProduction() ? 'no-cache' : 'no-store',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function errorHandler(err, req, res) {
  const log = req.log ?? logger;
  if (err instanceof AppError) {
    if (err.status >= 500) log.error('request.failed', { code: err.code, message: err.message });
    else log.warn('request.rejected', { code: err.code, message: err.message });
    sendJson(res, err.status, { error: err.toJSON() });
    return;
  }
  const wrapped = internalError('服务器内部错误');
  log.error('request.crashed', { message: err?.message, stack: isProduction() ? undefined : err?.stack });
  // 非 AppError 一律不外泄原始信息
  sendJson(res, wrapped.status, { error: wrapped.toJSON() });
}
