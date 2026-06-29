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
