// 依赖可用性自检：逐个真实加载，确认不是"装了但跑不起来"
const out = [];
const ok = (name, extra = '') => out.push(`OK   ${name}${extra ? ' — ' + extra : ''}`);
const bad = (name, e) => out.push(`FAIL ${name} — ${e.message}`);

try { const m = await import('docx'); ok('docx', `Document/Packer=${typeof m.Document}/${typeof m.Packer}`); } catch (e) { bad('docx', e); }
try { const m = await import('pdfkit'); ok('pdfkit', typeof m.default === 'function' ? 'ok' : 'ok'); } catch (e) { bad('pdfkit', e); }
// archiver 8.x 是纯 ESM，只有命名导出（ZipArchive 等），没有 default。
try {
  const m = await import('archiver');
  if (typeof m.ZipArchive !== 'function') throw new Error('缺少命名导出 ZipArchive');
  const zip = new m.ZipArchive({ zlib: { level: 9 } });
  const chunks = [];
  const done = new Promise((res, rej) => {
    zip.on('data', (c) => chunks.push(c));
    zip.on('end', res);
    zip.on('error', rej);
  });
  zip.append('hello', { name: 'a.txt' });
  zip.finalize();
  await done;
  ok('archiver', `ZipArchive=class, 内存打包 ${Buffer.concat(chunks).length}B`);
} catch (e) { bad('archiver', e); }
try { const m = await import('adm-zip'); ok('adm-zip', typeof m.default === 'function' ? 'class' : '?'); } catch (e) { bad('adm-zip', e); }
try { const m = await import('node-cron'); ok('node-cron', `validate=${typeof m.default?.validate}`); } catch (e) { bad('node-cron', e); }
try { const m = await import('openai'); ok('openai', typeof m.default === 'function' ? 'class' : '?'); } catch (e) { bad('openai', e); }
try {
  const m = await import('sharp');
  const sharp = m.default;
  const buf = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#E8EDF2' } }).png().toBuffer();
  ok('sharp', `v${sharp.versions?.sharp || sharp.version || '?'}, png ${buf.length}B`);
} catch (e) { bad('sharp', e); }
try {
  const m = await import('better-sqlite3');
  const Database = m.default;
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(a TEXT)');
  db.prepare('INSERT INTO t VALUES (?)').run('hello');
  const row = db.prepare('SELECT a FROM t').get();
  db.close();
  ok('better-sqlite3', `select=${row.a}`);
} catch (e) { bad('better-sqlite3', e); }

console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n通过 ${out.length - failed}/${out.length}`);
process.exit(failed ? 1 : 0);
