import { config } from './config.js';
import { logger } from './logger.js';
import { createApp, listen } from './app.js';
import { store } from './repo/jsonStore.js';
import { syncEnabled, pullLight, streamHeavy, pushAll, setSuppress } from './cloud/storeSync.js';

/**
 * 启动前把云端数据回灌到本地。
 *
 * 为什么在 listen 之前做：沙箱重建后本地是空的，如果先接流量，
 * 第一个请求可能读到「没有作品」，用户会以为数据丢了。
 * 但要设超时——云端连不上时不能让服务起不来（本地仍可用）。
 */
const withTimeout = (p, ms, label) => Promise.race([
  p,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms)),
]);

/** 把一批云端行写进本地 */
function applyRows(rows) {
  let n = 0;
  setSuppress(true);          // 写本地期间不回推，否则刚拉下来的 18MB 会再上传一遍
  try {
    for (const row of rows) {
      try { store.write(row.key, row.value); n += 1; } catch { /* 单条坏了不拖累整批 */ }
    }
  } finally {
    setSuppress(false);
  }
  return n;
}

async function hydrateFromCloud() {
  if (!syncEnabled()) return;
  try {
    const rows = await withTimeout(pullLight(), 8000, '轻量数据');
    if (!rows.length) {
      // 云端空、本地有：把现有作品推上去（首次接入的那一次）
      const local = store.list().map((k) => {
        try { return [k, store.read(k)]; } catch { return null; }
      }).filter(Boolean);
      if (local.length) {
        // 首次接入：把本地已有作品搬上云端。project-* 体积大，放后台，不挡启动
        const light = local.filter(([k]) => !k.startsWith('project-'));
        const heavy = local.filter(([k]) => k.startsWith('project-'));
        if (light.length) {
          const r = await withTimeout(pushAll(light), 8000, '首次上传');
          logger.info('cloud.db.seed', { pushed: r.pushed });
        }
        if (heavy.length) {
          setTimeout(() => pushAll(heavy)
            .then((r) => logger.info('cloud.db.seed.heavy', { pushed: r.pushed }))
            .catch((e) => logger.warn('cloud.db.seed.heavy.fail', { reason: e.message })), 1000);
        }
      }
      return;
    }
    const restored = applyRows(rows);
    logger.info('cloud.db.hydrate', { rows: rows.length, restored });
  } catch (err) {
    logger.warn('cloud.db.hydrate.fail', { reason: String(err.message).slice(0, 120), hint: '服务继续用本地数据启动' });
  }
}

await hydrateFromCloud();
const server = await listen(createApp());

// 重量数据（project-*）后台拉，拉到一条写一条：不挡启动，几秒后项目就自己出现了
if (syncEnabled()) {
  streamHeavy((rows) => applyRows(rows))
    .then((r) => logger.info('cloud.db.hydrate.heavy', { rows: r.rows }))
    .catch((e) => logger.warn('cloud.db.hydrate.heavy.fail', { reason: String(e.message).slice(0, 120) }));
}

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

