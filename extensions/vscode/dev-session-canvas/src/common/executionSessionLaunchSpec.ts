/** Pure launch parameters shared by the Host adapter and Supervisor protocol. */
export interface ExecutionSessionLaunchSpec {
  file: string;
  args?: readonly string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
  terminalName?: string;
}
