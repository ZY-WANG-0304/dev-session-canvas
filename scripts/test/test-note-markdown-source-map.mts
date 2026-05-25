import assert from 'node:assert/strict';

import {
  createNoteMarkdownSourceMap,
  type NoteMarkdownSourceMap
} from '../../src/common/noteMarkdownSourceMap.ts';

type ExpectedTextOffset = {
  text: string;
  renderedOffset: number;
  sourceOffset: number;
};

function run(): void {
  assertTextOffsets(
    '# list\n\n- first line\n  second line',
    [
      {
        text: 'second line',
        renderedOffset: 0,
        sourceOffset: 23
      },
      {
        text: 'second line',
        renderedOffset: 5,
        sourceOffset: 28
      }
    ],
    '无序列表续行文本应映射到续行缩进之后的源码位置。'
  );

  assertTextOffsets(
    '# list\n\n1. first line\n   second line',
    [
      {
        text: 'second line',
        renderedOffset: 0,
        sourceOffset: 25
      },
      {
        text: 'second line',
        renderedOffset: 5,
        sourceOffset: 30
      }
    ],
    '有序列表续行文本应映射到续行缩进之后的源码位置。'
  );

  assertTextOffsets(
    '# list\n\n> > - first line\n> >   second line',
    [
      {
        text: 'second line',
        renderedOffset: 0,
        sourceOffset: 31
      },
      {
        text: 'second line',
        renderedOffset: 5,
        sourceOffset: 36
      }
    ],
    '嵌套 blockquote 列表续行应保留 quote marker 后的精确源码位置。'
  );

  assertTextOffsets(
    '***bold*** after\n\n___firm___ after',
    [
      {
        text: 'bold',
        renderedOffset: 0,
        sourceOffset: 3
      },
      {
        text: 'bold',
        renderedOffset: 2,
        sourceOffset: 5
      },
      {
        text: 'firm',
        renderedOffset: 0,
        sourceOffset: 21
      },
      {
        text: 'firm',
        renderedOffset: 2,
        sourceOffset: 23
      }
    ],
    '三重强调内容应映射到 emphasis/strong 标记内部的源码位置。'
  );

  assertTextOffsets(
    'A &amp; B after\nfoo\\_bar',
    [
      {
        text: 'B after',
        renderedOffset: 0,
        sourceOffset: 8
      },
      {
        text: 'foo_bar',
        renderedOffset: 3,
        sourceOffset: 19
      }
    ],
    '实体与反斜杠转义应映射到对应源码 token。'
  );

  assertTextOffsets(
    ['# 缩进代码定位', '', '    - item', '    foo_bar'].join('\n'),
    [
      {
        text: '- item\nfoo_bar',
        renderedOffset: 0,
        sourceOffset: 14
      },
      {
        text: '- item\nfoo_bar',
        renderedOffset: 9,
        sourceOffset: 27
      }
    ],
    '缩进代码块应按每一行剥离源码缩进后独立映射。'
  );

  assertTextOffsets(
    ['# 围栏代码定位', '', '```', '- item', 'foo_bar', '```'].join('\n'),
    [
      {
        text: '- item\nfoo_bar',
        renderedOffset: 0,
        sourceOffset: 14
      },
      {
        text: '- item\nfoo_bar',
        renderedOffset: 9,
        sourceOffset: 23
      }
    ],
    '无语言围栏代码块不应被误判为缩进代码块。'
  );

  assertBlockEnd(
    ['# 图片定位', '', '![架构图](https://cdn.example.com/arch.png)', '', '后续正文不应该成为光标落点。'].join('\n'),
    'image',
    48,
    '图片 fallback 应落到图片 Markdown 源码末尾。'
  );

  assertBlockEnd(
    ['# 公式定位', '', '$$', 'x^2 + y^2 = z^2', '$$', '', '后续正文不应该成为光标落点。'].join('\n'),
    'math',
    29,
    'display math fallback 应落到公式块源码末尾。'
  );
}


function assertTextOffsets(content: string, expected: ExpectedTextOffset[], message: string): void {
  const sourceMap = createNoteMarkdownSourceMap(content, {
    kind: 'none',
    body: content
  });
  for (const entry of expected) {
    const segment = findTextSegment(sourceMap, entry.text);
    assert.ok(segment, `${message} 未找到文本段 ${JSON.stringify(entry.text)}。`);
    assert.equal(
      segment.sourceOffsets[entry.renderedOffset],
      entry.sourceOffset,
      `${message} text=${JSON.stringify(entry.text)} renderedOffset=${entry.renderedOffset}`
    );
  }
}

function findTextSegment(sourceMap: NoteMarkdownSourceMap, text: string) {
  const segment = sourceMap.textSegments.find((entry) => entry.text.includes(text));
  if (!segment) {
    return null;
  }

  const segmentOffset = segment.text.indexOf(text);
  return {
    ...segment,
    sourceOffsets: segment.sourceOffsets.slice(segmentOffset, segmentOffset + text.length + 1)
  };
}

function assertBlockEnd(
  content: string,
  kind: NoteMarkdownSourceMap['blockRanges'][number]['kind'],
  expectedEnd: number,
  message: string
): void {
  const sourceMap = createNoteMarkdownSourceMap(content, {
    kind: 'none',
    body: content
  });
  const range = sourceMap.blockRanges.find((entry) => entry.kind === kind);
  assert.ok(range, `${message} 未找到 ${kind} block range。`);
  assert.equal(range.sourceEnd, expectedEnd, message);
}

run();
console.log('note markdown source map tests passed');
