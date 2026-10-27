/* 调用策略：把「什么错该重试、重几次、隔多久」从调用链里抽出来
 *
 * 为什么要单独一层：原先 completeJson 是无条件重试 —— 不管余额不足还是超时，
 * 一律重试 3 次。真实账本里 453 次调用有 120 次失败，其中：
 *   · 16 次「余额不足」→ 重试 3 次纯属浪费（这类错误重试一万次也不会好）
 *   · 17 次「超时」→ 同样的输入重试，大概率还是超时，只是再等 120 秒
 * 命中率因此长期停在 74%，而 token 被重试吃掉了大头。
 *
 * 设计原则：
 *   1. 只有「换个时间就可能好」的错误才重试（限流、5xx、网络抖动、JSON 没解析出来）
 *   2. 配置类错误（余额、鉴权、模型名、参数）一律立刻失败，并给出可执行的修复建议
 *   3. 超时最多再试 1 次——同一份超大输入重试，是拿时间换不到结果的赌博
 *   4. 重试之间必须退避（指数 + 抖动），否则就是把限流打成雪崩
 */

export const ERROR_KIND = Object.freeze({
  BALANCE: 'balance',     // 余额不足 / 配额用尽
  AUTH: 'auth',           // Key 无效、无权限
  MODEL: 'model',         // 模型名不存在
  REQUEST: 'request',     // 参数不合法（含上下文超限）
  RATE: 'rate',           // 429 限流
  SERVER: 'server',       // 5xx / 过载
  TIMEOUT: 'timeout',     // 本端超时
  TRANSPORT: 'transport', // 网络层失败
  PARSE: 'parse',         // 模型输出不是合法 JSON
  CONTENT: 'content',     // 输出为空 / 只有思维链
  UNKNOWN: 'unknown',
});

/** 各类错误的中文处置建议（直接展示给用户，避免"报错了但不知道怎么办"） */
const HINT = {
  [ERROR_KIND.BALANCE]: '账户余额不足：去服务商后台充值后再试，重试不会恢复额度',
  [ERROR_KIND.AUTH]: 'Key 无效或无权限：检查「接 API」里的 Key 与 Base URL 是否匹配',
  [ERROR_KIND.MODEL]: '模型名不存在：点「拉取模型列表」选一个真实可用的模型名',
  [ERROR_KIND.REQUEST]: '请求参数不被接受：多半是输入过长或参数越界，缩短输入再试',
  [ERROR_KIND.RATE]: '触发限流：已自动退避重试，若持续失败请降低并发或调大间隔',
  [ERROR_KIND.SERVER]: '服务商暂时不可用：已退避重试，仍失败请稍后再来',
  [ERROR_KIND.TIMEOUT]: '本端超时：重试同一份长输入通常还会超时，请缩短输入或调大超时',
  [ERROR_KIND.TRANSPORT]: '网络中断：检查网络或代理后重试',
  [ERROR_KIND.PARSE]: '模型没输出合法 JSON：已带「只输出 JSON」的提示重试',
  [ERROR_KIND.CONTENT]: '模型只输出了思维链、没有正文：调大最大 Token 或降低推理等级',
  [ERROR_KIND.UNKNOWN]: '未知错误：请查看服务端日志',
};

/** 从错误对象里取出分类所需的线索（llmClient 已经把 status/transient 放进 details） */
function readSignal(err) {
  const d = err?.details ?? {};
  const status = Number(d.status ?? err?.status ?? 0) || 0;
  const msg = String(err?.message ?? '');
  return { status, msg, transient: d.transient };
}

export function classifyError(err) {
  const { status, msg } = readSignal(err);

  // 按状态码优先判：这些是确定性的，跟消息内容无关
  if (status === 402) return rule(ERROR_KIND.BALANCE, 1, false);
  if (status === 401 || status === 403) return rule(ERROR_KIND.AUTH, 1, false);
  if (status === 404) return rule(ERROR_KIND.MODEL, 1, false);
  if (status === 400 || status === 413 || status === 422) return rule(ERROR_KIND.REQUEST, 1, false);
  if (status === 429) return rule(ERROR_KIND.RATE, 2, true);
  if (status >= 500) return rule(ERROR_KIND.SERVER, 2, true);

  // 无状态码时按消息判（网关常把业务错误塞进 200 或抛异常）
  if (/insufficient\s*balance|quota|余额不足|配额/i.test(msg)) return rule(ERROR_KIND.BALANCE, 1, false);
  if (/invalid.*api.?key|unauthor|无权限|鉴权/i.test(msg)) return rule(ERROR_KIND.AUTH, 1, false);
  if (/超时|timeout|aborted/i.test(msg)) return rule(ERROR_KIND.TIMEOUT, 2, true);
  if (/无法解析为 ?JSON|not valid json|unexpected token|JSON/i.test(msg)) return rule(ERROR_KIND.PARSE, 3, true);
  if (/只输出了思维链|内容为空|empty/i.test(msg)) return rule(ERROR_KIND.CONTENT, 2, true);
  if (/fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) return rule(ERROR_KIND.TRANSPORT, 2, true);

  return rule(ERROR_KIND.UNKNOWN, 1, false);
}

function rule(kind, maxAttempts, retryable) {
  return {
    kind,
    retryable,
    maxAttempts: retryable ? Math.max(1, maxAttempts) : 1,
    hint: HINT[kind],
  };
}

/**
 * 第 attempt 次失败后，等待多久再试。
 * 指数退避 + 抖动：固定间隔会让所有客户端在同一秒重试，把限流打成雪崩。
 */
export function backoffMs(attempt, kind) {
  const base = kind === ERROR_KIND.RATE ? 2000 : 800;
  const cap = 15000;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.random() * exp * 0.3;
  return Math.round(exp + jitter);
}

/** 解析失败时，下一轮追加的提示（不改 system，只加在 user 末尾，避免影响缓存键） */
export const JSON_REPAIR_HINT = '\n\n【上次输出无法解析为 JSON。请只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块】';

/** 熔断：同一任务连续失败到阈值就停，避免"60 集一路烧" */
export const BREAKER_THRESHOLD = 3;
