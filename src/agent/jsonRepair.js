// LLM 输出经常不是合法 JSON。这里做五级降级解析，能救回多少救多少。
// 思路移植自开源项目 Jellyfish 的 _load_json_like，按本项目需要改写。

function stripCodeFence(text) {
  if (typeof text !== 'string') return text;
  const m = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (m) return m[1].trim();
  return text.trim();
}

function firstJsonObject(text) {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function quoteBareKeys(text) {
  // { foo: 1 } -> { "foo": 1 }
  return text.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
}

function normalizeQuotes(text) {
  return text
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'");
}

function dropTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, '$1');
}

function parseLoose(text) {
  // 极小的 JSON 值解析：够用且不引入 eval
  let s = text.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  return undefined;
}

/**
 * 五级降级：直接解析 -> 剥离代码围栏 -> 抠第一个对象 -> 修引号/尾逗号 -> 单值兜底
 * 全部失败抛错，由调用方决定是否重试或降级为文本
 */
export function loadJsonLike(raw) {
  if (raw === null || raw === undefined) throw new Error('输入为空');
  if (typeof raw !== 'string') return raw;

  const attempts = [];

  try {
    return JSON.parse(raw);
  } catch (e) {
    attempts.push(['json.parse', e.message]);
  }

  let t = stripCodeFence(raw);
  try {
    return JSON.parse(t);
  } catch (e) {
    attempts.push(['strip-fence', e.message]);
  }

  const obj = firstJsonObject(t);
  if (obj) {
    try {
      return JSON.parse(obj);
    } catch (e) {
      attempts.push(['first-object', e.message]);
    }
    let repaired = dropTrailingCommas(normalizeQuotes(quoteBareKeys(obj)));
    try {
      return JSON.parse(repaired);
    } catch (e) {
      attempts.push(['repair', e.message]);
    }
  }

  const loose = parseLoose(t);
  if (loose !== undefined) return loose;

  throw new Error(`无法解析为 JSON：${attempts.map((a) => a.join('=')).join('; ')}`);
}

// 从自然语言里尽力抠出数组（用于解析模型返回的列表）
export function loadJsonArrayLike(raw, fallback = []) {
  try {
    const v = loadJsonLike(raw);
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (const key of ['items', 'data', 'list', 'result', 'results', 'episodes']) {
        if (Array.isArray(v[key])) return v[key];
      }
    }
  } catch {
    return fallback;
  }
  return fallback;
}
