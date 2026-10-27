// 引擎冒烟：确认从上游开源仓库接入的确定性脚本能被本项目正常 import 与调用
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// 夹具收在 scripts/fixtures/ 里，和 selftest.mjs 保持一致。
// 早先这里读的是项目外的 ../../repos/shuohao/...，那个目录不在打包范围内，
// 于是「把项目单独带走就再也跑不了」——原理由见 selftest.mjs 同一处注释。
const fixture = (p) => JSON.parse(readFileSync(resolve(here, 'fixtures', p), 'utf8'));

const { gateReport: outlineGates } = await import('../src/engine/outline.mjs');
const { gateReport: scriptGates, computeStats, renderHtml, seedFromOutline } = await import('../src/engine/script.mjs');

const o = fixture('渡口-outline.json');
const s = fixture('渡口-script.json');

const g1 = outlineGates(o);
const g2 = scriptGates(s, { outline: o });

console.log('outline 门数:', g1.length, '通过:', g1.filter((g) => g.ok).length);
console.log('script  门数:', g2.length, '通过:', g2.filter((g) => g.ok).length);
console.log('script 未过:', g2.filter((g) => !g.ok).map((g) => g.id).join(',') || '（全部通过）');

const seed = seedFromOutline(o, null);
console.log('seed 集数:', seed.episodes?.length, '顶层字段:', Object.keys(seed).join(','));

const stats = computeStats(s);
console.log('stats 集数:', stats.episodes?.length, '首集估算秒数:', stats.episodes?.[0]?.est);

const html = renderHtml(s, { outline: o });
console.log('renderHtml 长度:', html.length, '是否 HTML:', html.trimStart().startsWith('<!'));
