// 仓库密钥扫描：确认提交前没有把真实密钥带进去
//
// 为什么需要："我检查过没问题" 不可复核，而且下次改动很容易又把 Key 带回来。
// 这个脚本给一条可重复执行的命令，退出码直接可用作提交前卡口。
//
// 用法：
//   node scripts/secretscan.mjs              # 扫代码与文档（默认跳过 data/）
//   node scripts/secretscan.mjs --include-data   # 连 data/ 一起扫（检查迁移包用）
//
// 误报处理：有意保留的测试夹具，在那一行末尾加注释 `secretscan-allow`，例如
//   { apiKey: 'sk-test-fake-key-123456' } // secretscan-allow 测试夹具，非真实密钥
// 这样豁免是显式的、可审计的，而不是把整个文件排除掉。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const includeData = process.argv.includes('--include-data');

const SKIP_DIRS_ALWAYS = new Set(['.git', 'node_modules', '.probe']);
const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.html', '.css', '.bat', '.sh', '.example', '.yml', '.yaml', '.env', '']);
const MAX_BYTES = 2 * 1024 * 1024;

/* 高置信度密钥形态。宁可漏报宽泛字符串，也不要天天误报——误报多了就没人看了。 */
const PATTERNS = [
  { name: 'OpenAI/兼容 Key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Anthropic Key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub Token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub 细粒度 Token', re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: '私钥文件内容', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: '硬编码 Bearer', re: /\bBearer\s+[A-Za-z0-9._-]{30,}/ },
];

/* 字段级检查：只看「值非空、且不像掩码/占位」的密钥类字段 */
const NON_EMPTY_KEY_FIELD = /"(apiKey|api_key|accessToken|access_token|secret|clientSecret)"\s*:\s*"([^"]+)"/gi;
const PLACEHOLDER = /^(?:|your[-_ ].*|xxx+|\*+|-|sk-x+|replace.*|<.*>|changeme|example)$/i;

function isMaskedOrPlaceholder(v) {
  if (!v.trim()) return true;
  if (PLACEHOLDER.test(v)) return true;
  if (/\*{2,}/.test(v)) return true; // 形如 sk-a*******3456 的掩码
  return false;
}

const findings = [];
const scanned = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS_ALWAYS.has(entry)) continue;
      if (!includeData && entry === 'data' && dir === ROOT) continue;
      if (entry === 'oneoff') continue; // 一次性调试归档，不参与运行
      walk(full);
      continue;
    }
    if (st.size > MAX_BYTES) continue;
    const ext = extname(entry).toLowerCase();
    if (!SCAN_EXT.has(ext) && !entry.startsWith('.env')) continue;
    scanFile(full, rel);
  }
}

function scanFile(full, rel) {
  let text;
  try { text = readFileSync(full, 'utf8'); } catch { return; }
  // 二进制文件里出现这些形态多半是误判，跳过含 NUL 的文件
  if (text.includes('\u0000')) return;
  scanned.push(rel);

  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes('secretscan-allow')) return;
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        findings.push({ file: rel, line: i + 1, kind: p.name, sample: mask(m[0]) });
      }
    }
    NON_EMPTY_KEY_FIELD.lastIndex = 0;
    for (const m of line.matchAll(NON_EMPTY_KEY_FIELD)) {
      if (!isMaskedOrPlaceholder(m[2])) {
        findings.push({ file: rel, line: i + 1, kind: `非空字段 ${m[1]}`, sample: mask(m[2]) });
      }
    }
  });
}

function mask(s) {
  const v = String(s);
  if (v.length <= 8) return '****';
  return `${v.slice(0, 4)}…${v.slice(-3)}（${v.length} 字符）`;
}

walk(ROOT);

console.log(`扫描范围：${includeData ? '全部（含 data/）' : '代码与文档（跳过 data/）'}`);
console.log(`已检查 ${scanned.length} 个文件`);
console.log('');

if (!findings.length) {
  console.log('✓ 未发现明文密钥');
  process.exit(0);
}

console.log(`✗ 发现 ${findings.length} 处可疑内容：`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`    类型：${f.kind}`);
  console.log(`    样本：${f.sample}`);
}
console.log('');
console.log('处理方式：');
console.log('  1) 这是真实密钥 → 立刻删除，并在服务商后台吊销重发');
console.log('  2) 这是测试夹具 → 在该行末尾加注释 `secretscan-allow` 并说明原因');
process.exit(1);
