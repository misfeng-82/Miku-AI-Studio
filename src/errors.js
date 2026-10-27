// 类型化错误体系：客户端只会看到 code + message，永远看不到堆栈与内部细节
export const ERROR_CODES = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION: 'VALIDATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM: 'UPSTREAM',
  INTERNAL: 'INTERNAL',
});

const STATUS_BY_CODE = Object.freeze({
  [ERROR_CODES.BAD_REQUEST]: 400,
  [ERROR_CODES.VALIDATION]: 422,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.UPSTREAM]: 502,
  [ERROR_CODES.INTERNAL]: 500,
});

export class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code in STATUS_BY_CODE ? code : ERROR_CODES.INTERNAL;
    this.status = STATUS_BY_CODE[this.code];
    // details 只放可安全外泄的结构化信息（字段名、门 id 等），绝不放堆栈
    this.details = details;
  }

  toJSON() {
    const out = { code: this.code, message: this.message };
    if (this.details) out.details = this.details;
    return out;
  }
}

export const badRequest = (m, d) => new AppError(ERROR_CODES.BAD_REQUEST, m, d);
export const validationError = (m, d) => new AppError(ERROR_CODES.VALIDATION, m, d);
export const notFound = (m, d) => new AppError(ERROR_CODES.NOT_FOUND, m, d);
export const conflict = (m, d) => new AppError(ERROR_CODES.CONFLICT, m, d);
export const upstreamError = (m, d) => new AppError(ERROR_CODES.UPSTREAM, m, d);
export const internalError = (m, d) => new AppError(ERROR_CODES.INTERNAL, m, d);

// --- 边界校验器：所有外部输入在进入服务层前必须过这一关 ---
export function requireString(value, field, { min = 1, max = 20000 } = {}) {
  if (typeof value !== 'string') {
    throw validationError(`字段 ${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) throw validationError(`字段 ${field} 不能为空`);
  if (trimmed.length > max) throw validationError(`字段 ${field} 长度不能超过 ${max} 个字符`);
  return trimmed;
}

export function optionalString(value, field, opts = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireString(value, field, opts);
}

export function requireInt(value, field, { min = 0, max = 1e9, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw validationError(`字段 ${field} 必填`);
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw validationError(`字段 ${field} 必须是整数`);
  if (n < min || n > max) throw validationError(`字段 ${field} 必须在 ${min} 到 ${max} 之间`);
  return n;
}

export function requireEnum(value, field, allowed, { fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw validationError(`字段 ${field} 必填`);
  }
  if (!allowed.includes(value)) {
    throw validationError(`字段 ${field} 只能是 ${allowed.join(' | ')}`, { allowed, got: value });
  }
  return value;
}

export function requireArray(value, field, { max = 500 } = {}) {
  if (!Array.isArray(value)) throw validationError(`字段 ${field} 必须是数组`);
  if (value.length > max) throw validationError(`字段 ${field} 最多 ${max} 项`);
  return value;
}
