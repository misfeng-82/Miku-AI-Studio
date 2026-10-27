import { config } from './config.js';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const threshold = LEVELS[config.env === 'production' ? 'info' : 'debug'];

// 敏感字段一律打码：日志里绝不出现密钥、令牌与用户隐私
const REDACT_KEYS = new Set(['apiKey', 'api_key', 'password', 'token', 'authorization', 'cookie', 'secret']);

function redact(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

function emit(level, event, fields = {}) {
  if (LEVELS[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  };
  const sink = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  sink.write(JSON.stringify(line) + '\n');
}

export const logger = {
  debug: (event, fields) => emit('debug', event, fields),
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
  // 每个请求一个子日志器，requestId 贯穿全链路
  child(requestId) {
    return {
      debug: (event, fields) => emit('debug', event, { requestId, ...fields }),
      info: (event, fields) => emit('info', event, { requestId, ...fields }),
      warn: (event, fields) => emit('warn', event, { requestId, ...fields }),
      error: (event, fields) => emit('error', event, { requestId, ...fields }),
    };
  },
};
