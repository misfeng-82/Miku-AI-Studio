/* 聚焦探针：真模型四段式 + 组装门禁明细（smoke 的生成段跑细一点）。
 * 用法：node scripts/probe-gen-http.mjs（服务要在跑；会花一点模型钱） */
const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 忽略 */ }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data?.error?.message ?? text.slice(0, 200)}`);
  return data;
}

const CONCEPT = process.env.CONCEPT ?? '都市重生复仇：女主被闺蜜与未婚夫联手夺走公司，重生回到他们密谋窃取项目的酒会当晚。这一世她收起柔软，步步为营。';

const run = async () => {
  console.log('概念：', CONCEPT.slice(0, 40), '…');
  const story = (await call('POST', '/api/script-gen/story', { concept: CONCEPT, genre: '都市重生复仇', episodes: 10 })).story;
  console.log(`① 梗概人设：《${story.title}》${story.characters.length} 角色 — ${story.characters.map((c) => c.name + '｜' + c.role).join('、')}`);

  const outline = (await call('POST', '/api/script-gen/outline', { story, from: 1, to: 10 })).outline;
  const og = await call('POST', '/api/evaluate', { script: { source: 'x', episodes: [] }, outline });
  console.log(`② 分集大纲：${outline.episodes.length} 集 / ${outline.beats.length} 爽点 / 大纲门 ${og.passed}/${og.total}`);

  const texts = [];
  for (const ep of [1, 2]) {
    const r = await call('POST', '/api/script-gen/episode', { story, outline, ep, prevEnding: texts[ep - 2]?.slice(-100) ?? '' });
    texts.push(r.text);
    const failed = r.gates.filter((g) => !g.ok);
    console.log(`③ 第 ${ep} 集：${r.text.length} 字｜门 ${r.gates.length - failed.length}/${r.gates.length}${failed.length ? '｜未过 ' + failed.map((g) => g.id).join(',') : ''}`);
  }

  const full = await call('POST', '/api/script-gen/assemble', { story, outline, texts });
  const bad = full.gates.filter((g) => !g.ok);
  console.log(`④ 组装整稿：${full.script.episodes.length} 集｜门 ${full.gates.length - bad.length}/${full.gates.length}`);
  for (const g of bad) console.log(`   ✗ ${g.scope}:${g.id} — ${g.detail.slice(0, 120)}`);
  console.log(bad.length ? '=== 有门未过 ===' : '=== 全部门过 ===');
  process.exitCode = bad.length ? 1 : 0;
};

run().catch((e) => { console.error('探针崩了：', e.message); process.exitCode = 1; });
