declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';

  interface MarkdownItTaskListsOptions {
    enabled?: boolean;
    label?: boolean;
    labelAfter?: boolean;
  }

  const markdownItTaskLists: (md: MarkdownIt, options?: MarkdownItTaskListsOptions) => void;
  export = markdownItTaskLists;
}

declare module 'markdown-it-katex' {
  import type MarkdownIt from 'markdown-it';

  interface MarkdownItKatexOptions {
    throwOnError?: boolean;
    errorColor?: string;
    strict?: boolean | 'ignore' | 'warn' | 'error';
    trust?: boolean;
  }

  const markdownItKatex: (md: MarkdownIt, options?: MarkdownItKatexOptions) => void;
  export = markdownItKatex;
}
