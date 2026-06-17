/**
 * Markdown → DOCX 转换器（基于 docx 包）
 *
 * 支持的语法：
 * - 标题 H1-H6
 * - 段落
 * - 有序/无序/任务列表
 * - 引用块
 * - 代码块（含语言标识）
 * - 表格
 * - 分隔线
 * - 行内：**bold** / *italic* / `code` / [link](url)
 * - 块级数学公式 $$...$$ → 降级为代码块（LaTeX 文本）
 * - 行内数学公式 $...$ → 降级为斜体
 * - 围栏代码块 ```lang ... ``` 保留
 *
 * 降级：mermaid 流程图 → 代码块（源码）
 *       KaTeX 公式 → LaTeX 文本（无渲染）
 *       HTML 标签 → 转义为纯文本
 */
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  Packer,
  convertInchesToTwip,
  LevelFormat,
  ITableCellOptions,
} from 'docx';

// ---------- 主入口 ----------
export function markdownToDocxBuffer(markdown: string): Promise<Buffer> {
  const blocks = parseBlocks(markdown);
  const doc = new Document({
    creator: 'LaiMarkDown 2.0',
    title: 'Exported Document',
    styles: {
      default: {
        document: {
          run: { font: '宋体', size: 22 /* half-points → 11pt */ },
        },
        heading1: {
          run: { font: '黑体', size: 32, bold: true },
          paragraph: { spacing: { before: 240, after: 120 } },
        },
        heading2: {
          run: { font: '黑体', size: 28, bold: true },
          paragraph: { spacing: { before: 200, after: 100 } },
        },
        heading3: {
          run: { font: '黑体', size: 24, bold: true },
          paragraph: { spacing: { before: 160, after: 80 } },
        },
        heading4: {
          run: { font: '黑体', size: 22, bold: true },
          paragraph: { spacing: { before: 120, after: 60 } },
        },
        heading5: { run: { font: '黑体', size: 22, bold: true } },
        heading6: { run: { font: '黑体', size: 22, bold: true, italics: true } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.79),
              bottom: convertInchesToTwip(0.79),
              left: convertInchesToTwip(0.79),
              right: convertInchesToTwip(0.79),
            },
          },
        },
        children: blocks.flatMap((b) => blockToDocx(b)),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// ---------- Block 解析（流式状态机）----------
type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; content: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ checked: boolean | null; text: string }> }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | { kind: 'table'; rows: string[][] };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 跳过空行
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // 围栏代码块 ```
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾的 ```
      out.push({ kind: 'code', lang, content: buf.join('\n') });
      continue;
    }

    // 块级数学公式 $$...$$
    if (/^\$\$/.test(line)) {
      const buf: string[] = [line.replace(/^\$\$/, '')];
      i++;
      while (i < lines.length && !/\$\$\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        buf.push(lines[i].replace(/\$\$\s*$/, ''));
        i++;
      }
      out.push({ kind: 'code', lang: 'latex', content: buf.join('\n').trim() });
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push({ kind: 'heading', level: h[1].length as 1 | 2 | 3 | 4 | 5 | 6, text: h[2].trim() });
      i++;
      continue;
    }

    // 分隔线
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push({ kind: 'hr' });
      i++;
      continue;
    }

    // 引用块（连续 > 开头）
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push({ kind: 'quote', text: buf.join('\n').trim() });
      continue;
    }

    // 表格
    if (/^\s*\|.+\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const rows: string[][] = [];
      rows.push(splitTableRow(line));
      i += 2; // 跳过分隔行
      while (i < lines.length && /^\s*\|.+\|/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push({ kind: 'table', rows });
      continue;
    }

    // 列表（无序 / 有序 / 任务）
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: Array<{ checked: boolean | null; text: string }> = [];
      const re = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length && re.test(lines[i])) {
        const text = lines[i].replace(re, '$1');
        // 任务列表 - [ ] / - [x]
        const t = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (t) {
          items.push({ checked: t[1].toLowerCase() === 'x', text: t[2] });
        } else {
          items.push({ checked: null, text });
        }
        i++;
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }

    // 普通段落（连续非空行 = 一个段落；空行 / 块起始 = 段落结束）
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(\s*[-*_]){3,}\s*$/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*\|.+\|/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push({ kind: 'paragraph', text: buf.join('\n').trim() });
  }

  return out;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// ---------- Block → DOCX 节点 ----------
function blockToDocx(b: Block): (Paragraph | Table)[] {
  switch (b.kind) {
    case 'heading':
      return [
        new Paragraph({
          heading: headingLevel(b.level),
          children: parseInline(b.text),
        }),
      ];

    case 'paragraph':
      return [
        new Paragraph({
          children: parseInline(b.text),
        }),
      ];

    case 'hr':
      return [new Paragraph({ children: [new TextRun({ text: '────────────────────' })] })];

    case 'quote': {
      const lines = b.text.split('\n');
      return lines.map(
        (l) =>
          new Paragraph({
            indent: { left: convertInchesToTwip(0.3) },
            children: parseInline('│ ' + l),
          }),
      );
    }

    case 'code':
      // 代码块：单段多行 + 等宽字体 + 灰底
      return b.content.split('\n').map(
        (l) =>
          new Paragraph({
            shading: { type: ShadingType.SOLID, color: 'F4F4F5', fill: 'F4F4F5' },
            children: [
              new TextRun({ text: l || ' ', font: 'Consolas', size: 20 }),
            ],
          }),
      );

    case 'list': {
      const out: Paragraph[] = [];
      for (let idx = 0; idx < b.items.length; idx++) {
        const it = b.items[idx];
        const prefix = b.ordered
          ? `${idx + 1}. `
          : it.checked === true
          ? '☑ '
          : it.checked === false
          ? '☐ '
          : '• ';
        out.push(
          new Paragraph({
            indent: { left: convertInchesToTwip(0.3) },
            children: [
              new TextRun({ text: prefix, bold: true }),
              ...parseInline(it.text),
            ],
          }),
        );
      }
      return out;
    }

    case 'table': {
      if (b.rows.length === 0) return [];
      const rows = b.rows.map(
        (cells, rowIdx) =>
          new TableRow({
            children: cells.map(
              (cell) =>
                new TableCell({
                  width: { size: 100 / b.rows[0].length, type: WidthType.PERCENTAGE },
                  shading:
                    rowIdx === 0
                      ? { type: ShadingType.SOLID, color: 'F4F4F5', fill: 'F4F4F5' }
                      : undefined,
                  children: [
                    new Paragraph({
                      children: parseInline(cell),
                    }),
                  ],
                }),
            ),
          }),
      );
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
        }),
      ];
    }
  }
}

function headingLevel(n: 1 | 2 | 3 | 4 | 5 | 6) {
  return [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ][n - 1];
}

// ---------- Inline 解析 ----------
// 支持：**bold** / *italic* / `code` / [text](url) / $...$（降级为斜体）
function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let i = 0;
  let buf = '';
  const flush = (extra?: Partial<TextRun>) => {
    if (buf.length > 0) {
      runs.push(new TextRun({ text: buf, ...extra }));
      buf = '';
    }
  };

  while (i < text.length) {
    // 行内数学 $...$（非贪婪、不跨行）
    if (text[i] === '$' && text[i + 1] !== '$') {
      const end = text.indexOf('$', i + 1);
      if (end > i + 1) {
        flush();
        runs.push(new TextRun({ text: text.slice(i + 1, end), italics: true, font: 'Cambria Math' }));
        i = end + 1;
        continue;
      }
    }

    // **bold**
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        runs.push(new TextRun({ text: text.slice(i + 2, end), bold: true }));
        i = end + 2;
        continue;
      }
    }

    // *italic*（注意避开 **）
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1) {
        flush();
        runs.push(new TextRun({ text: text.slice(i + 1, end), italics: true }));
        i = end + 1;
        continue;
      }
    }

    // `code`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        runs.push(new TextRun({ text: text.slice(i + 1, end), font: 'Consolas', size: 20 }));
        i = end + 1;
        continue;
      }
    }

    // [text](url) → text 蓝色（docx 中 link 复杂；用颜色代替）
    const link = text.slice(i).match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (link) {
      flush();
      runs.push(new TextRun({ text: link[1], color: '0563C1', underline: {} }));
      i += link[0].length;
      continue;
    }

    // ~~strike~~
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2);
      if (end > i + 2) {
        flush();
        runs.push(new TextRun({ text: text.slice(i + 2, end), strike: true }));
        i = end + 2;
        continue;
      }
    }

    buf += text[i];
    i++;
  }
  flush();
  return runs;
}
