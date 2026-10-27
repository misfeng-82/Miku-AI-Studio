/* 访问口令（可选的单口令门禁）
 *
 * 为什么需要：本应用没有任何账号体系，所有端点公开可读写。
 * 部署到公网后，任何拿到链接的人都能改设置、删作品。
 *
 * 设计取舍：
 *   - 不做账号体系（要用户表、注册、密码哈希、找回密码——与「能跑通 > 功能多」相悖）
 *   - 只做一层单口令：环境变量 ACCESS_TOKEN 配一个口令，访问一次后种 cookie
 *   - 口令留空 = 关闭门禁（本机开发/跑测试不受影响）
 *
 * 安全细节：
 *   - cookie 值不是口令本身，而是 HMAC-SHA256(口令, 固定串)，无法由 cookie 反推口令
 *   - 比较用 timingSafeEqual，避免通过响应时间逐字节猜口令
 *   - 口令错误时不区分「错误」与「格式不对」，统一文案 + 固定延迟
 *   - HttpOnly 防止 JS 读取；SameSite=Lax 防跨站提交；生产环境加 Secure
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { config, isProduction } from '../config.js';
import { sendJson } from './router.js';

const COOKIE_NAME = 'miku_access';
const COOKIE_HMAC_LABEL = 'miku-access-v1';
const MAX_AGE_SEC = 7 * 24 * 3600;

/** 门禁是否启用（口令非空才启用） */
export function accessEnabled() {
  return Boolean(config.accessToken);
}

/** cookie 应携带的值：口令的 HMAC，而非口令明文 */
function expectedCookieValue() {
  return createHmac('sha256', config.accessToken).update(COOKIE_HMAC_LABEL).digest('hex');
}

const sha256hex = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

/** 等长比较，避免时序侧信道 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const piece of raw.split(';')) {
    const idx = piece.indexOf('=');
    if (idx < 0) continue;
    if (piece.slice(0, idx).trim() === name) return piece.slice(idx + 1).trim();
  }
  return null;
}

/** 当前请求是否已通过门禁 */
export function isAuthorized(req) {
  if (!accessEnabled()) return true;
  const v = readCookie(req, COOKIE_NAME);
  if (!v) return false;
  return safeEqual(v, expectedCookieValue());
}

/* 未授权时给出的登录页：只做一件事——把口令提交到 /api/auth，成功后整页重载 */
const LOGIN_HTML = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>需要访问口令 · Miku AI创作平台</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;
       font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#18191c}
  .box{width:min(92vw,380px);background:#fff;border:1px solid #e6e8eb;border-radius:14px;padding:28px 26px;
       box-shadow:0 10px 30px rgba(0,0,0,.05)}
  h1{margin:0 0 6px;font-size:17px;letter-spacing:.2px}
  p.sub{margin:0 0 18px;color:#8a8f98;font-size:12.5px}
  label{display:block;font-size:12px;color:#5b6169;margin-bottom:6px}
  input{width:100%;height:40px;padding:0 12px;border:1px solid #dcdfe4;border-radius:9px;font-size:14px;outline:none}
  input:focus{border-color:#3b6ef6;box-shadow:0 0 0 3px rgba(59,110,246,.12)}
  button{margin-top:14px;width:100%;height:40px;border:0;border-radius:9px;background:#18191c;color:#fff;
         font-size:14px;cursor:pointer}
  button:disabled{opacity:.55;cursor:default}
  .err{margin-top:12px;min-height:18px;font-size:12.5px;color:#d1372b}
</style></head>
<body>
<form class="box" id="f">
  <h1>需要访问口令</h1>
  <p class="sub">这是私有工作台，输入口令后即可使用。口令由站点所有者在部署环境变量 <span style="font-family:ui-monospace,monospace">ACCESS_TOKEN</span> 中设置。</p>
  <label for="t">访问口令</label>
  <input id="t" type="password" autocomplete="current-password" autofocus />
  <button id="b" type="submit">进入</button>
  <div class="err" id="e"></div>
</form>
<script>
  var f = document.getElementById('f'), t = document.getElementById('t'),
      b = document.getElementById('b'), e = document.getElementById('e');
  f.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var v = t.value.trim();
    if (!v) { e.textContent = '请输入口令'; return; }
    b.disabled = true; e.textContent = '';
    try {
      var r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: v })
      });
      if (r.ok) { location.reload(); return; }
      var d = await r.json().catch(function () { return null; });
      e.textContent = (d && d.error && d.error.message) || '口令不正确';
    } catch (err) {
      e.textContent = '网络异常，请重试';
    }
    b.disabled = false;
  });
</script>
</body></html>`;

/* 带扩展名的静态资源不该返回登录页（浏览器会拿 HTML 当 JS 解析），直接 401 */
const ASSET_EXT = /\.(?:js|mjs|css|svg|png|jpe?g|webp|ico|json|map|txt|woff2?)$/i;

/**
 * 门禁中间件。返回 true 表示已经处理（调用方不要再往下走）。
 * 放行：/health /ready（容器探活必须能通）、/api/auth（登录入口本身）
 */
export function accessGate(req, res, pathname) {
  if (!accessEnabled()) return false;
  if (pathname === '/health' || pathname === '/ready' || pathname === '/api/auth') return false;
  if (isAuthorized(req)) return false;

  const wantsJson = pathname.startsWith('/api/') || ASSET_EXT.test(pathname);
  if (wantsJson) {
    sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: '需要访问口令' } });
    return true;
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(LOGIN_HTML);
  return true;
}

/** POST /api/auth：校验口令并种 cookie。成功返回 {ok:true}，失败直接写 401。 */
export async function handleAuth(req, res) {
  if (!accessEnabled()) return { ok: true, accessGate: 'disabled' };

  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token) {
    sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: '请输入访问口令' } });
    return undefined;
  }

  // 先比哈希再比内容：两者都是定长字符串，timingSafeEqual 才成立
  if (!safeEqual(sha256hex(token), sha256hex(config.accessToken))) {
    // 固定延迟：拉平「错得早」与「错得晚」的时间差
    await new Promise((r) => setTimeout(r, 300));
    sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: '口令不正确' } });
    return undefined;
  }

  const parts = [
    `${COOKIE_NAME}=${expectedCookieValue()}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (isProduction()) parts.push('Secure');
  res.setHeader('set-cookie', parts.join('; '));
  return { ok: true };
}

/** 供测试使用：清掉某个请求的 cookie（不参与运行时逻辑） */
export function clearAccessCookie(res) {
  res.setHeader('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

export { COOKIE_NAME, LOGIN_HTML };
