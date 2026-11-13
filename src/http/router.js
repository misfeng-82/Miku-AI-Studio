// 极简路由：支持 /path/:param 与查询串，方法不匹配返回 405
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1));
              return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '$',
    );
    this.routes.push({ method, regex, keys, handler });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    const pathOnly = pathname.split('?')[0];
    const pathMatches = this.routes.filter((r) => r.regex.test(pathOnly));
    if (!pathMatches.length) return { handler: null };
    const exact = pathMatches.find((r) => r.method === method);
    if (!exact) {
      return { handler: null, allowed: [...new Set(pathMatches.map((r) => r.method))] };
    }
    const m = exact.regex.exec(pathOnly);
    const params = {};
    exact.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { handler: exact.handler, params };
  }
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** 二进制下载（docx / pdf / zip / 图片）。filename 走 RFC 5987，中文文件名不会乱码。 */
export function sendBinary(res, status, buffer, {
  contentType = 'application/octet-stream',
  filename = '',
  inline = false,
} = {}) {
  const headers = {
    'content-type': contentType,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  };
  if (filename) {
    const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(filename);
    headers['content-disposition'] =
      `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
  }
  res.writeHead(status, headers);
  res.end(buffer);
}
