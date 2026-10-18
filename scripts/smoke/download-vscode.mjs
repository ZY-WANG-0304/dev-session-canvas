import fs from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {downloadAndUnzipVSCode} from '@vscode/test-electron';
const {values}=parseArgs({options:{version:{type:'string'},cache:{type:'string'},output:{type:'string'}}});
if(!values.version||!values.cache||!values.output)throw new Error('Fixed VS Code download arguments required');
const executable=await downloadAndUnzipVSCode({version:values.version,cachePath:values.cache,timeout:30000});
await fs.writeFile(values.output,`${executable}\n`,{flag:'wx'});
