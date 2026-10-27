import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { Router, sendJson, sendText } from './http/router.js';
import {
  withRequestId, withSecurity, withCors, readJsonBody, serveStatic, errorHandler,
} from './http/middleware.js';
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
