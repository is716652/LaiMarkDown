/**
 * FormatToolbar — MD 语法提示工具栏
 *
 * 设计原则：
 * 1. 纯展示 + 调用父组件传下来的 editor ref，不持有任何编辑器状态
 * 2. 不改 Editor 内部逻辑；只通过 EditorHandle 暴露的 wrapSelection / linePrefix / insertBlock 三个方法与编辑器交互
 * 3. 样式走 .format-toolbar-* 前缀，不污染 .toolbar / .tb-btn
 * 4. 按钮带 tooltip 显示对应语法模板，方便记不住的人对照抄
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  Bold, Italic, Strikethrough, Code, Code2,
  Heading1, Heading2, Heading3, Heading4, Heading5, Heading6,
  Quote, List, ListOrdered, ListChecks, Minus,
  Link, Image as ImageIcon, Table2, Hash, Pilcrow,
} from 'lucide-react';
import type { EditorHandle } from './Editor';

// 按钮基础类型
type BaseBtn = {
  id: string;
  title: string;          // tooltip 大标题
  syntax?: string;        // tooltip 副标题（语法示例）
  shortcut?: string;      // tooltip 副标题（快捷键）
  icon: React.ReactNode;
  action: (ed: EditorHandle) => void;
};

// 包裹类：选中文本就包裹，没选就插入占位并选中
const wrapBtns: BaseBtn[] = [
  {
    id: 'bold', title: '粗体', syntax: '**粗体**', shortcut: 'Ctrl+B',
    icon: <Bold size={14} />,
    action: (ed) => ed.wrapSelection('**', '**', '粗体文字'),
  },
  {
    id: 'italic', title: '斜体', syntax: '*斜体*', shortcut: 'Ctrl+I',
    icon: <Italic size={14} />,
    action: (ed) => ed.wrapSelection('*', '*', '斜体文字'),
  },
  {
    id: 'strike', title: '删除线', syntax: '~~删除~~',
    icon: <Strikethrough size={14} />,
    action: (ed) => ed.wrapSelection('~~', '~~', '删除文字'),
  },
  {
    id: 'inline-code', title: '行内代码', syntax: '`code`', shortcut: 'Ctrl+`',
    icon: <Code size={14} />,
    action: (ed) => ed.wrapSelection('`', '`', 'code'),
  },
  {
    id: 'link', title: '链接', syntax: '[文字](https://)', shortcut: 'Ctrl+K',
    icon: <Link size={14} />,
    action: (ed) => ed.wrapSelection('[', '](https://)', '链接文字'),
  },
];

// 行首前缀类：标题/引用/列表/任务
const prefixBtns: BaseBtn[] = [
  { id: 'h1', title: '一级标题', syntax: '# 标题', icon: <Heading1 size={14} />,
    action: (ed) => ed.linePrefix('# ') },
  { id: 'h2', title: '二级标题', syntax: '## 标题', icon: <Heading2 size={14} />,
    action: (ed) => ed.linePrefix('## ') },
  { id: 'h3', title: '三级标题', syntax: '### 标题', icon: <Heading3 size={14} />,
    action: (ed) => ed.linePrefix('### ') },
  { id: 'h4', title: '四级标题', syntax: '#### 标题', icon: <Heading4 size={14} />,
    action: (ed) => ed.linePrefix('#### ') },
  { id: 'h5', title: '五级标题', syntax: '##### 标题', icon: <Heading5 size={14} />,
    action: (ed) => ed.linePrefix('##### ') },
  { id: 'h6', title: '六级标题', syntax: '###### 标题', icon: <Heading6 size={14} />,
    action: (ed) => ed.linePrefix('###### ') },
  { id: 'quote', title: '引用', syntax: '> 引用', icon: <Quote size={14} />,
    action: (ed) => ed.linePrefix('> ') },
  { id: 'ul', title: '无序列表', syntax: '- 列表', icon: <List size={14} />,
    action: (ed) => ed.linePrefix('- ') },
  { id: 'ol', title: '有序列表', syntax: '1. 列表', icon: <ListOrdered size={14} />,
    action: (ed) => ed.linePrefix('1. ') },
  { id: 'task', title: '任务列表', syntax: '- [ ] 待办', icon: <ListChecks size={14} />,
    action: (ed) => ed.linePrefix('- [ ] ') },
];

// 块级模板类：代码块/表格/图片/分隔线
type BlockBtn = BaseBtn & {
  template: string;
  cursor: number;
  selectEnd?: number;
};
const blockBtns: BlockBtn[] = [
  {
    id: 'code-block', title: '代码块', syntax: '```\ncode\n```',
    icon: <Code2 size={14} />,
    template: '```\n在这里写代码\n```',
    cursor: 4,                  // 在 ``` 之后换行后
    selectEnd: 4 + 4,           // 选中"在这里写代码"
    action: (ed) => ed.insertBlock('```\n在这里写代码\n```', 4, 8),
  },
  {
    id: 'image', title: '图片', syntax: '![描述](https://)',
    icon: <ImageIcon size={14} />,
    template: '![图片描述](https://)',
    cursor: 2,                  // 在 ![ 之后
    selectEnd: 6,               // 选中"图片描述"
    action: (ed) => ed.insertBlock('![图片描述](https://)', 2, 6),
  },
  {
    id: 'table', title: '表格', syntax: '| 列1 | 列2 |\n| --- | --- |',
    icon: <Table2 size={14} />,
    template: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n',
    cursor: 2,                  // 第一个 | 之后
    selectEnd: 4,               // 选中"列1"
    action: (ed) => ed.insertBlock(
      '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n',
      2, 4,
    ),
  },
  {
    id: 'hr', title: '分隔线', syntax: '---',
    icon: <Minus size={14} />,
    template: '\n---\n',
    cursor: 5,                  // 末尾
    action: (ed) => ed.insertBlock('\n---\n', 5),
  },
];

type Props = {
  editorRef: React.RefObject<EditorHandle | null>;
};

export const FormatToolbar: React.FC<Props> = ({ editorRef }) => {
  const [headingOpen, setHeadingOpen] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭标题下拉
  useEffect(() => {
    if (!headingOpen) return;
    const onClick = (e: MouseEvent) => {
      if (headingRef.current && !headingRef.current.contains(e.target as Node)) {
        setHeadingOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [headingOpen]);

  const run = (action: (ed: EditorHandle) => void) => {
    const ed = editorRef.current;
    if (!ed) return;
    // 先 focus 编辑器，否则 wrapSelection 的 selection 取的是按钮上的位置
    ed.focus();
    // 微任务后执行 action（focus 完成后再 dispatch）
    Promise.resolve().then(() => action(ed));
  };

  return (
    <div className="format-toolbar" onMouseDown={(e) => e.preventDefault() /* 防止点按钮抢光标 */}>
      {/* 组 1：标题（下拉） */}
      <div className="ft-group" ref={headingRef}>
        <button
          className="ft-btn ft-btn-dropdown"
          title="标题（点击展开 H1-H6）"
          onClick={() => setHeadingOpen((o) => !o)}
        >
          <Heading1 size={14} />
          <span className="ft-caret">▾</span>
        </button>
        {headingOpen && (
          <div className="ft-popover">
            {prefixBtns.filter((b) => b.id.startsWith('h')).map((b) => (
              <button
                key={b.id}
                className="ft-popover-item"
                title={b.syntax}
                onClick={() => { setHeadingOpen(false); run(b.action); }}
              >
                {b.icon}
                <span>{b.title}</span>
                <code className="ft-popover-syntax">{b.syntax}</code>
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="ft-sep" />

      {/* 组 2：粗体/斜体/删除线/行内代码/链接 */}
      <div className="ft-group">
        {wrapBtns.map((b) => (
          <button
            key={b.id}
            className="ft-btn"
            title={`${b.title}${b.syntax ? `  ·  ${b.syntax}` : ''}${b.shortcut ? `  ·  ${b.shortcut}` : ''}`}
            onClick={() => run(b.action)}
          >
            {b.icon}
          </button>
        ))}
      </div>

      <span className="ft-sep" />

      {/* 组 3：引用/列表/任务 */}
      <div className="ft-group">
        {[
          prefixBtns.find((b) => b.id === 'quote')!,
          prefixBtns.find((b) => b.id === 'ul')!,
          prefixBtns.find((b) => b.id === 'ol')!,
          prefixBtns.find((b) => b.id === 'task')!,
        ].map((b) => (
          <button
            key={b.id}
            className="ft-btn"
            title={`${b.title}  ·  ${b.syntax}`}
            onClick={() => run(b.action)}
          >
            {b.icon}
          </button>
        ))}
      </div>

      <span className="ft-sep" />

      {/* 组 4：代码块/图片/表格/分隔线 */}
      <div className="ft-group">
        {blockBtns.map((b) => (
          <button
            key={b.id}
            className="ft-btn"
            title={`${b.title}  ·  ${b.syntax}`}
            onClick={() => run(b.action)}
          >
            {b.icon}
          </button>
        ))}
      </div>

      <span className="ft-sep" />

      {/* 组 5：提示 */}
      <div className="ft-hint">
        <Hash size={11} />
        <span>选中文字再点按钮可包裹</span>
      </div>
    </div>
  );
};
