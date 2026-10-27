import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { Router, sendJson, sendText } from './http/router.js';
import {
  withRequestId, withSecurity, withCors, readJsonBody, serveStatic, errorHandler,
} from './http/middleware.js';
import { accessGate, handleAuth } from './http/auth.js';
import { withRateLimit } from './http/ratelimit.js';
import { api } from './routes/api.js';
import { notFound } from './errors.js';

const router = api;

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

      if (url.pathname.startsWith('/api/')) {
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
