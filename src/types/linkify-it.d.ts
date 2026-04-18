declare module 'linkify-it' {
  export interface LinkifyMatch {
    schema: string;
    index: number;
    lastIndex: number;
    raw: string;
    text: string;
    url: string;
  }

  export interface LinkifyOptions {
    fuzzyLink?: boolean;
    fuzzyEmail?: boolean;
    fuzzyIP?: boolean;
  }

  export interface LinkifySchemaDefinition {
    validate?: RegExp | ((text: string, pos: number, self: LinkifyIt) => number | false | 0);
    normalize?: (match: LinkifyMatch) => void;
  }

  export default class LinkifyIt {
    public constructor(
      schemas?: Record<string, string | LinkifySchemaDefinition | null>,
      options?: LinkifyOptions
    );

    public add(schema: string, definition: string | LinkifySchemaDefinition | null): this;
    public set(options: LinkifyOptions): this;
    public pretest(text: string): boolean;
    public match(text: string): LinkifyMatch[] | null;
  }
}
