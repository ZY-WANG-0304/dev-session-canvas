declare module 'js-yaml' {
  export interface LoadOptions {
    schema?: unknown;
  }

  export const FAILSAFE_SCHEMA: unknown;
  export function load(input: string, options?: LoadOptions): unknown;

  const yaml: {
    FAILSAFE_SCHEMA: typeof FAILSAFE_SCHEMA;
    load: typeof load;
  };

  export default yaml;
}
