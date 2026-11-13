/* 导出服务：Markdown → Word(.docx) / PDF / 批量 ZIP
 *
 * 设计原则：
 * 1. 只依赖原始文本（小说/剧本导出本来就是 markdown），不做业务层改造，避免和现有服务耦合。
 * 2. 中文字体：Word 用系统字体名（不嵌入二进制），PDF 必须嵌入 TTF，否则中文变方块。
 *    字体优先 simhei.ttf（单文件，pdfkit 最稳），其次 msyh.ttc，都没有则退化为内置 Helvetica 并回报警告。
 * 3. 全部在内存里生成，不落临时文件——导出是"下载一次"的场景，不需要磁盘中转。
 */
import { existsSync } from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
} from 'docx';
import PDFDocument from 'pdfkit';
import { ZipArchive } from 'archiver';
import AdmZip from 'adm-zip';

/* ---------------- 中文字体探测 ---------------- */

const CJK_FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',          // 黑体，单 TTF，首选
  'C:/Windows/Fonts/msyh.ttc',            // 微软雅黑，TTC
  'C:/Windows/Fonts/simsun.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/System/Library/Fonts/PingFang.ttc',
];

let cachedFont;
export function findCjkFont() {
  if (cachedFont !== undefined) return cachedFont;
  const hit = CJK_FONT_CANDIDATES.find((p) => { try { return existsSync(p); } catch { return false; } });
  cachedFont = hit || null;
  return cachedFont;
}

/* ---------------- Markdown 行解析 ---------------- */

/** 把 markdown 拆成块：h1/h2/h3/p/quote/hr。只处理导出需要的少量语法。 */
export function parseMarkdown(md) {
  const blocks = [];
  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^---+$/.test(line.trim())) { blocks.push({ type: 'hr' }); continue; }
    if (/^###\s+/.test(line)) { blocks.push({ type: 'h3', text: clean(line.replace(/^###\s+/, '')) }); continue; }
    if (/^##\s+/.test(line)) { blocks.push({ type: 'h2', text: clean(line.replace(/^##\s+/, '')) }); continue; }
    if (/^#\s+/.test(line)) { blocks.push({ type: 'h1', text: clean(line.replace(/^#\s+/, '')) }); continue; }
    if (/^>\s*/.test(line)) { blocks.push({ type: 'quote', text: clean(line.replace(/^>\s*/, '')) }); continue; }
    if (/^(\*|-)\s+/.test(line)) { blocks.push({ type: 'p', text: clean(line.replace(/^(\*|-)\s+/, '· ')) }); continue; }
    blocks.push({ type: 'p', text: clean(line) });
  }
  return blocks;
}

/** 去掉 markdown 强调标记，保留文字。 */
function clean(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/* ---------------- Word ---------------- */

const WORD_FONT = 'Microsoft YaHei';

export async function markdownToDocx({ title, markdown, subtitle = '' }) {
  const blocks = parseMarkdown(markdown);
  const children = [];

  children.push(new Paragraph({
    children: [new TextRun({ text: title || '未命名', bold: true, size: 40, font: WORD_FONT })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
  }));

  if (subtitle) {
    children.push(new Paragraph({
      children: [new TextRun({ text: subtitle, size: 20, color: '666666', font: WORD_FONT })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 320 },
    }));
  }

  for (const b of blocks) {
    if (b.type === 'hr') {
      children.push(new Paragraph({
        children: [new TextRun({ text: '', size: 16 })],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
        spacing: { before: 240, after: 240 },
      }));
      continue;
    }
    if (b.type === 'h1') {
      children.push(new Paragraph({
        children: [new TextRun({ text: b.text, bold: true, size: 32, font: WORD_FONT })],
        spacing: { before: 320, after: 160 },
      }));
      continue;
    }
    if (b.type === 'h2') {
      children.push(new Paragraph({
        children: [new TextRun({ text: b.text, bold: true, size: 26, font: WORD_FONT })],
        spacing: { before: 280, after: 120 },
      }));
      continue;
    }
    if (b.type === 'h3') {
      children.push(new Paragraph({
        children: [new TextRun({ text: b.text, bold: true, size: 22, font: WORD_FONT })],
        spacing: { before: 200, after: 100 },
      }));
      continue;
    }
    if (b.type === 'quote') {
      children.push(new Paragraph({
        children: [new TextRun({ text: b.text, italics: true, size: 20, color: '555555', font: WORD_FONT })],
        indent: { left: 480 },
        spacing: { before: 80, after: 80 },
      }));
      continue;
    }
    children.push(new Paragraph({
      children: [new TextRun({ text: b.text, size: 21, font: WORD_FONT })],
      spacing: { line: 360, before: 40, after: 40 },
    }));
  }

  if (!children.length) children.push(new Paragraph({ children: [new TextRun({ text: '（空）', font: WORD_FONT })] }));

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: WORD_FONT, size: 21 } },
      },
    },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1247, right: 1247 } } }, children }],
  });

  return Packer.toBuffer(doc);
}

/* ---------------- PDF ---------------- */

export async function markdownToPdf({ title, markdown, subtitle = '' }) {
  const font = findCjkFont();
  const blocks = parseMarkdown(markdown);
  const PAGE_W = 595.28, PAGE_H = 841.89, MARGIN_X = 64, MARGIN_TOP = 64, MARGIN_BOTTOM = 64;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_X, right: MARGIN_X },
    info: { Title: title || '未命名', Creator: 'Miku AI 创作平台' },
    autoFirstPage: true,
  });

  if (font) doc.registerFont('cjk', font);
  const F = font ? 'cjk' : 'Helvetica';

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // 页脚：必须写在可绘制区之外又不能让 pdfkit 自动分页。
  // 教训：直接在 y = PAGE_H - MARGIN_BOTTOM + 24 写 text，pdfkit 判定溢出 → addPage
  // → 再触发 pageAdded → 再写页脚 → 无限递归，最终 zlib 压缩阶段栈溢出把进程打崩。
  // 所以这里临时把 bottom margin 置 0 + lineBreak:false，并加重入保护。
  let stamping = false;
  const stampFooter = () => {
    if (stamping) return;
    stamping = true;
    try {
      const oldBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font(F).fontSize(9).fillColor('#999999')
        .text('Miku AI 创作平台', MARGIN_X, PAGE_H - 34, { lineBreak: false, width: PAGE_W - MARGIN_X * 2 - 60 });
      doc.page.margins.bottom = oldBottom;
      // 页脚写完必须把光标挪回正文起点，否则正文会从页脚位置接着排版
      doc.x = MARGIN_X;
      doc.y = doc.page.margins.top;
    } finally {
      stamping = false;
    }
  };
  stampFooter();
  doc.on('pageAdded', stampFooter);

  doc.font(F).fontSize(22).fillColor('#111111').text(title || '未命名', { align: 'center' });
  doc.moveDown(0.6);

  if (subtitle) {
    doc.font(F).fontSize(10.5).fillColor('#666666').text(subtitle, { align: 'center' });
    doc.moveDown(1.2);
  } else {
    doc.moveDown(0.8);
  }

  const needSpace = (h) => doc.y + h > PAGE_H - MARGIN_BOTTOM;

  for (const b of blocks) {
    if (b.type === 'hr') {
      if (needSpace(24)) doc.addPage();
      doc.moveDown(0.4);
      const y = doc.y;
      doc.save().strokeColor('#DDDDDD').lineWidth(0.8)
        .moveTo(MARGIN_X, y).lineTo(PAGE_W - MARGIN_X, y).stroke().restore();
      doc.moveDown(0.6);
      continue;
    }
    if (b.type === 'h1') {
      if (needSpace(48)) doc.addPage();
      doc.moveDown(0.7);
      doc.font(F).fontSize(17).fillColor('#111111').text(b.text, { lineGap: 4 });
      doc.moveDown(0.4);
      continue;
    }
    if (b.type === 'h2') {
      if (needSpace(40)) doc.addPage();
      doc.moveDown(0.5);
      doc.font(F).fontSize(14).fillColor('#1A1A1A').text(b.text, { lineGap: 3 });
      doc.moveDown(0.3);
      continue;
    }
    if (b.type === 'h3') {
      if (needSpace(32)) doc.addPage();
      doc.moveDown(0.4);
      doc.font(F).fontSize(12).fillColor('#1A1A1A').text(b.text, { lineGap: 3 });
      doc.moveDown(0.25);
      continue;
    }
    if (b.type === 'quote') {
      if (needSpace(28)) doc.addPage();
      doc.font(F).fontSize(10.5).fillColor('#555555').text(b.text, { indent: 16, lineGap: 4 });
      doc.moveDown(0.25);
      continue;
    }
    if (needSpace(24)) doc.addPage();
    doc.font(F).fontSize(11).fillColor('#222222').text(b.text, { lineGap: 5.5 });
    doc.moveDown(0.28);
  }

  doc.end();
  const buf = await finished;
  return { buffer: buf, fontEmbedded: Boolean(font), fontPath: font };
}

/* ---------------- ZIP ---------------- */

/** 用 archiver 在内存里打一个 zip。files: [{ name, content(Buffer|string) }] */
export function buildZip(files, { comment = '' } = {}) {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    archive.on('data', (c) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') reject(err); });

    for (const f of files) {
      const name = String(f.name || 'file.txt').replace(/^\/+/, '');
      archive.append(typeof f.content === 'string' ? Buffer.from(f.content, 'utf8') : f.content, { name });
    }
    archive.append(Buffer.from(comment || ''), { name: '_README.txt' });
    archive.finalize();
  });
}

/** 读 zip 清单（adm-zip），用于校验导出包内容。 */
export function inspectZip(buffer) {
  const z = new AdmZip(buffer);
  return z.getEntries().map((e) => ({ name: e.entryName, size: e.header.size }));
}
