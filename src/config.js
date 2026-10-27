import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '..');

function num(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`环境变量 ${name} 必须是数字，当前值：${raw}`);
  if (min !== undefined && v < min) throw new Error(`环境变量 ${name} 不能小于 ${min}，当前值：${v}`);
  if (max !== undefined && v > max) throw new Error(`环境变量 ${name} 不能大于 ${max}，当前值：${v}`);
  return v;
}

function str(name, def, allow) {
  const raw = process.env[name];
  const v = raw === undefined || raw === '' ? def : raw;
  if (allow && !allow.includes(v)) {
    throw new Error(`环境变量 ${name} 只能是 ${allow.join(' | ')}，当前值：${v}`);
  }
  return v;
}

const port = num('PORT', 8787, 1, 65535);
const dataDir = resolve(ROOT, str('DATA_DIR', 'data'));

// 数据目录必须存在：存储层所有写入都依赖它，缺失时启动即失败，避免运行中才炸
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

export const config = Object.freeze({
  env: str('NODE_ENV', 'development', ['development', 'test', 'production']),
  port,
  // 绑定地址：本机跑（没给 PORT）只监听 127.0.0.1，不暴露到局域网；
  // 云端/容器会注入 PORT，这时必须绑 0.0.0.0，否则反向代理连不进来。
  // 显式给了 HOST 就听 HOST，两条默认都只是兜底。
  host: str('HOST', process.env.PORT ? '0.0.0.0' : '127.0.0.1'),
  dataDir,
  publicDir: resolve(ROOT, 'public'),
  settingsFile: resolve(dataDir, 'settings.json'),

  // LLM 层：默认强制 mock，避免任何意外产生费用
  llm: Object.freeze({
    useMock: str('USE_MOCK', '0', ['0', '1']) === '1',
    baseUrl: str('LLM_BASE_URL', ''),
    apiKey: str('LLM_API_KEY', ''),
    model: str('LLM_MODEL', 'mock-1'),
    timeoutMs: num('LLM_TIMEOUT_MS', 30000, 1000, 600000),
    maxRetries: num('LLM_MAX_RETRIES', 3, 0, 10),
  }),

  // 抓取层：默认走内置真实剧目榜（assets/hotDramas.js），不发起任何外部请求
  crawl: Object.freeze({
    useMock: str('CRAWL_USE_MOCK', '1', ['0', '1']) === '1',
    endpoint: str('CRAWL_ENDPOINT', ''),
    timeoutMs: num('CRAWL_TIMEOUT_MS', 15000, 1000, 120000),
  }),

  // 任务执行器
  task: Object.freeze({
    maxAttempts: num('TASK_MAX_ATTEMPTS', 3, 1, 10),
    retryBackoffMs: num('TASK_RETRY_BACKOFF_MS', 500, 0, 60000),
  }),

  // 访问口令：留空 = 不启用门禁（本机开发与自动化测试的默认状态）。
  // 部署到公网必须设置，否则任何拿到链接的人都能改设置、删作品。
  accessToken: str('ACCESS_TOKEN', ''),

  // 限流：默认 300 次/分钟/IP。登录端点单独用更严的阈值防暴力猜口令。
  rateLimit: Object.freeze({
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60000, 1000, 3600000),
    max: num('RATE_LIMIT_MAX', 300, 1, 1000000),
    authMax: num('RATE_LIMIT_AUTH_MAX', 10, 1, 10000),
  }),

  corsOrigins: str('CORS_ORIGINS', `http://127.0.0.1:${port},http://localhost:${port}`)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});

export function isProduction() {
  return config.env === 'production';
}
