import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const config=JSON.parse(await readFile('package.json','utf8'));
const output=path.join(config.build.directories.output,'win-unpacked');
const result=spawnSync(process.execPath,['node_modules/electron-builder/cli.js','--win','nsis','--prepackaged',output,'--publish','never'],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
process.exit(result.status??1);
