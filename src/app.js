import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';
import { Router, sendJson, sendText } from './http/router.js';
import {
  withRequestId, withSecurity, withCors, readJsonBody, serveStatic, errorHandler,
} from './http/middleware.js';
import { accessGate, handleAuth } from './http/auth.js';
import { withRateLimit } from './http/ratelimit.js';
import { api } from './routes/api.js';
import { runWithLlm, llmFromHeaders } from './agent/llmContext.js';
import { notFound } from './errors.js';

const router = api;

/* ============================================================
   无限画布子服务：独立 Express 进程（canvas/，端口 CANVAS_PORT=5180），
   主服务把手写代理 /canvas/* 转发过去。iframe 同源嵌入，无跨域问题。
   子进程拉起失败不影响主服务——画布页面会显示「服务未启动」。
   ============================================================ */
const CANVAS_PORT = Number(process.env.CANVAS_PORT || 5180);
const CANVAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'canvas');
const CANVAS_ENTRY = join(CANVAS_DIR, 'server.js');
let canvasProc = null;

export function ensureCanvasService() {
  if (canvasProc || !existsSync(CANVAS_ENTRY)) return;
  try {
    canvasProc = spawn(process.execPath, [CANVAS_ENTRY], {
      cwd: CANVAS_DIR,
      env: { ...process.env, PORT: String(CANVAS_PORT) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    canvasProc.stderr.on('data', (d) => {
      logger.warn('canvas.stderr', { line: String(d).slice(0, 200) });
    });
    canvasProc.on('exit', (code) => {
      canvasProc = null;
      logger.warn('canvas.exited', { code });
      // 自愈：非主动关闭的退出（崩溃/端口抢占）延迟后重新拉起
      if (code !== 0) setTimeout(() => ensureCanvasService(), 2000);
    });
  } catch (e) {
    logger.warn('canvas.spawnFailed', { message: e.message });
  }
}

function proxyToCanvas(req, res) {
  const proxied = httpRequest(
    {
      host: '127.0.0.1',
      port: CANVAS_PORT,
      path: req.url.replace(/^\/canvas/, '') || '/',
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${CANVAS_PORT}` },
    },
    (up) => {
      // 主站 withSecurity 给所有响应加了 X-Frame-Options: DENY，会连同源的
      // /canvas/ iframe 一起挡掉。代理响应需移除该头，画布本身由同源策略约束。
      res.removeHeader('x-frame-options');
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    },
  );
  proxied.on('error', () => {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<div style="padding:40px;font-family:sans-serif;color:#666">画布服务未启动。重启平台即可自动拉起；或手动运行 canvas/server.js。</div>');
  });
  req.pipe(proxied);
}

export function createApp() {
  const server = createServer(async (req, res) => {
    withRequestId(req, res);
    withSecurity(req, res);

    const started = Date.now();
    res.on('finish', () => {
      req.log.info('request.done', {
        method: req.method,
        path: req.url,
        status: res.statusCode,
        ms: Date.now() - started,
      });
    });

    try {
      if (withCors(req, res)) return;

      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      req.query = Object.fromEntries(url.searchParams.entries());
      req.app = { config };

      // 访问门禁：配置了 ACCESS_TOKEN 才生效，否则整段是空操作。
      // 放在静态资源之前，未授权访问连页面都拿不到（/health /ready 在内部放行）。
      if (accessGate(req, res, url.pathname)) return;

      // 登录端点单独走更严的限流，防暴力猜口令
      if (url.pathname === '/api/auth' && req.method === 'POST') {
        if (withRateLimit(req, res, { max: config.rateLimit.authMax, namespace: 'auth' })) return;
        req.body = await readJsonBody(req);
        const out = await handleAuth(req, res);
        if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
        return;
      }

      // 全局限流。健康检查不占配额——否则探活自己把额度吃掉，监控会误判成宕机。
      const isProbe = url.pathname === '/health' || url.pathname === '/ready';
      if (!isProbe && withRateLimit(req, res)) return;

      // 健康检查：给容器与监控系统用，不进业务路由
      if (url.pathname === '/health') {
        sendJson(res, 200, { status: 'ok', uptime: Math.round(process.uptime()) });
        return;
      }
      if (url.pathname === '/ready') {
        sendJson(res, 200, { status: 'ready' });
        return;
      }

      // 无限画布代理：/canvas 与 /canvas/* → 画布子服务（5180）
      if (url.pathname === '/canvas' || url.pathname.startsWith('/canvas/')) {
        // 必须保留查询串：/canvas/api/download?url=... 等接口依赖 query，
        // 只取 pathname 会让画布子服务收到空参数并报「url 不合法」。
        req.url = (url.pathname.slice('/canvas'.length) || '/') + url.search;
        proxyToCanvas(req, res);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        // 访客自带 Key：从请求头取出，挂到本次异步上下文（不落盘、不记日志）。
        // 服务层深处调模型时自动读到，不需要把 req 一层层往下传。
        const llmOverride = llmFromHeaders(req.headers);
        if (llmOverride) req.llm = { source: 'request', model: llmOverride.model || '(默认)' };
        return await runWithLlm(llmOverride, async () => {
        req.body = await readJsonBody(req);
        const { handler, params, allowed } = router.match(req.method, url.pathname);
        if (!handler) {
          if (allowed) {
            res.setHeader('allow', allowed.join(', '));
            throw notFound(`不支持的请求方法 ${req.method}`);
          }
          throw notFound(`接口不存在：${url.pathname}`);
        }
        req.params = params ?? {};
        const result = await handler(req, res);
        if (result !== undefined && !res.writableEnded) sendJson(res, 200, result);
        return;
        });
      }

      const served = await serveStatic(req, res, url.pathname);
      if (!served) {
        // 前端路由兜底：非 API 的未知路径一律回 index.html
        const fell = await serveStatic(req, res, '/index.html');
        if (!fell) sendText(res, 404, 'Not Found');
      }
    } catch (err) {
      errorHandler(err, req, res);
    }
  });

  return server;
}

export function listen(server = createApp()) {
  return new Promise((resolve) => {
    server.listen(config.port, config.host, () => {
      logger.info('server.started', { port: config.port, host: config.host, env: config.env });
      resolve(server);
    });
  });
}
