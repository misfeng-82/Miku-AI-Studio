/**
 * 按请求隔离的模型配置（AsyncLocalStorage）
 *
 * 为什么需要它：模型调用发生在服务层深处（novelStudio / scriptService …），
 * 那里拿不到 req。但又必须让「每个访客用自己的 Key」成立，
 * 所以用 ALS 把本次请求携带的模型配置挂到当前的异步上下文里，
 * 服务层调 complete() 时自然读到，不需要把 req 一层层传下去。
 *
 * 一条硬规矩：这里的 Key 只存在于本次请求的内存中——
 * 不写文件、不写日志、不回显。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/** 在给定的模型配置下执行 fn（fn 内部的所有异步调用都能读到） */
export function runWithLlm(llm, fn) {
  return storage.run({ llm }, fn);
}

/** 取本次请求的模型配置；没有则返回 null */
export function currentLlm() {
  return storage.getStore()?.llm ?? null;
}

/**
 * 从请求头解析访客自带的模型配置。
 * 三个头都齐全才算数——只填一半就当成「没填」，避免半套配置把请求打歪。
 */
export function llmFromHeaders(headers = {}) {
  const apiKey = String(headers['x-llm-key'] ?? '').trim();
  const baseUrl = String(headers['x-llm-base'] ?? '').trim();
  if (!apiKey || !baseUrl) return null;
  return {
    apiKey,
    baseUrl,
    model: String(headers['x-llm-model'] ?? '').trim(),
    reasoning: String(headers['x-llm-reasoning'] ?? '').trim() || 'auto',
    temperature: Number(headers['x-llm-temperature']) || 0.85,
    maxTokens: Number(headers['x-llm-maxtokens']) || 8000,
    style: 'openai',
    enabled: true,
  };
}
