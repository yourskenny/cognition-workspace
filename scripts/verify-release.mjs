import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

// Explicit opt-in: one short real model call; encrypted credentials remain local.
const live = process.argv.includes('--live');
const root = process.cwd();
await mkdir(path.join(root, '.test-data'), { recursive: true });
await mkdir(path.join(root, 'test-results'), { recursive: true });
const dataDir = await mkdtemp(path.join(root, '.test-data', 'release-qa-'));
if (live) await copyFile(path.join(process.env.APPDATA, 'cognition-workspace', 'credentials.json'), path.join(dataDir, 'credentials.json'));
const env = { ...process.env, COGNITION_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const output = JSON.parse(await readFile('package.json','utf8')).build.directories.output;
const app = await _electron.launch({ executablePath: path.join(root, output, 'win-unpacked', '认知工作区.exe'), args: [], cwd: root, env, timeout: 25000 }).catch(async error=>{if(live)await unlink(path.join(dataDir,'credentials.json')).catch(()=>{});throw error;});
const page = await app.firstWindow(); page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
async function capture(name) {
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; const image = await win.capturePage();
    const [width, height] = win.getContentSize(); return image.resize({ width, height }).toPNG();
  });
  assert.ok(image.length > 0);
  await writeFile(path.join(root, 'test-results', 'v02-' + name + '.png'), image);
}
try {
  await page.getByText('已保存到本机', { exact: true }).waitFor();
  await capture('release-welcome');
  await page.getByRole('button', { name: '先体验「理解注意力」示例', exact: true }).click();
  await page.getByRole('button', {name:'空间',exact:true}).click();
  await page.locator('.space-graph canvas').waitFor();
  // Allow the explicitly animated initial camera move to settle.
  await page.waitForTimeout(700);
  await capture('release-3d');
  const canvas = await page.locator('.space-graph canvas').boundingBox();
  // v0.2 reading layout: verify 3D rendering and camera; node persistence is covered by smoke.mjs in 2D.
  await page.mouse.move(canvas.x + 30, canvas.y + canvas.height / 2);
  await page.mouse.down(); await page.mouse.move(canvas.x + 75, canvas.y + canvas.height / 2 - 35, {steps:12}); await page.mouse.up();
  await page.mouse.wheel(0, -100);
  await capture('release-3d-rotated');
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.getByRole('button', { name: '模型与本地数据', exact: true }).click();
  assert.equal(await page.locator('#api-key').getAttribute('type'), 'password');
  assert.equal(await page.locator('#api-key').inputValue(), '');
  await capture('release-settings');
  await page.getByRole('button', {name:'关闭',exact:true}).click();
  if (live) {
    await page.locator('#question').fill('请用两句话解释当前概念，并给一个二维例子。');
    await page.getByRole('button', {name:'发送问题',exact:true}).click();
    await page.locator('.exchange .answer').waitFor({timeout:125000});
    const answer = await page.locator('.exchange .answer').innerText();
    assert.ok(answer.length > 30);
    const state = await page.evaluate(() => window.cognition.load());
    assert.equal(state.data.goals[0].messages.length, 1);
    console.log(JSON.stringify({check:'packaged-pi-deepseek',ok:true,answerCharacters:answer.length}));
    await capture('release-real-answer');
    await page.getByRole('button', {name:'收起记录',exact:true}).click();
    await page.getByRole('button', {name:'模型与本地数据',exact:true}).click();
    await page.getByRole('button', {name:'删除本机密钥',exact:true}).click();
    await page.getByText('尚未配置密钥 · Pi SDK 运行时', {exact:true}).waitFor();
    assert.equal((await page.evaluate(() => window.cognition.settings())).data.configured, false);
    await page.getByRole('button', {name:'关闭',exact:true}).click();
    await page.locator('#question').fill('这条请求应提示未配置密钥。');
    await page.getByRole('button', {name:'发送问题',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'请先配置 DeepSeek API Key'}).waitFor();
    assert.equal(await page.locator('#question').inputValue(), '这条请求应提示未配置密钥。');
    await capture('release-missing-key');
    await page.getByRole('button', {name:'关闭提示',exact:true}).click();
    await page.getByRole('button', {name:'收起记录',exact:true}).click();
  }
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(980,680));
  await page.getByRole('button', {name:'平面',exact:true}).click();
  await capture('release-minimum');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ok:true,live,dataDir,screenshots:'test-results/v02-release-*.png'}));
} finally { await app.close(); if(live) await unlink(path.join(dataDir,'credentials.json')).catch(()=>{}); }
