import { config } from './config.js';
import { logger } from './logger.js';
import { createApp, listen } from './app.js';

const server = await listen(createApp());

// 优雅停机：先停止收新连接，再给在途请求一个收尾窗口，最后强制关闭
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('server.shutdown', { signal });

  server.close(() => {
    logger.info('server.closed');
    process.exit(0);
  });

  const GRACE_MS = 10_000;
  setTimeout(() => {
    logger.warn('server.shutdown.forced', { reason: '超过优雅停机窗口' });
    process.exit(1);
  }, GRACE_MS).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => {
  logger.error('process.unhandledRejection', { message: err?.message });
});
process.on('uncaughtException', (err) => {
  logger.error('process.uncaughtException', { message: err?.message });
  shutdown('uncaughtException');
});

logger.info('server.ready', { url: `http://${config.host}:${config.port}` });

// 线上漏设 NODE_ENV 是很容易犯的错：容器注入 PORT 就自动绑 0.0.0.0，
// 但 env 仍是 development，结果是静态资源走 no-store 全量重下（不缓存），
// 堆栈也会进日志。不擅自改默认值——本地 PORT=8899 测试恰恰需要 no-store，
// 改成 production 反而会踩回「app.js 拿旧缓存」那个坑；所以这里只显式喊一声。
if (config.env !== 'production' && config.host === '0.0.0.0') {
  logger.warn('server.env.exposed', {
    hint: '已绑定 0.0.0.0（对外暴露）但 NODE_ENV 不是 production；线上部署请设 NODE_ENV=production',
    env: config.env,
  });
}

