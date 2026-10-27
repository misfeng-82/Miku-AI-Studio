import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

// 运行时设置存储：用户在网页里填的 LLM 配置落在这里。
// key 只进这个文件（已在 .gitignore），接口返回前端时掩码。

const FILE = config.settingsFile;

let cache = null;

function read() {
  if (cache) return cache;
  if (!existsSync(FILE)) { cache = {}; return cache; }
  try { cache = JSON.parse(readFileSync(FILE, 'utf8')) ?? {}; }
  catch { cache = {}; }
  return cache;
}

export function getSettings() {
  return read().llm ?? {};
}

export function saveSettings(llm) {
  const data = read();
  data.llm = llm;
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  cache = data;
}
