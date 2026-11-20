import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Offline end-to-end check. Never loads the user's credentials or learning data.
const root = process.cwd();
const output = JSON.parse(await readFile('package.json','utf8')).build.directories.output;
await mkdir(path.join(root, '.test-data'), { recursive: true });
const dataDir = await mkdtemp(path.join(root, '.test-data', 'smoke-'));
const env = { ...process.env, COGNITION_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const options = { cwd: root, env, timeout: 25000, ...(packaged ? { executablePath: path.join(root, output, 'win-unpacked', '认知工作区.exe'), args: [] } : { args: ['.'] }) };
let app, page;
const errors = [];
async function launch() {
  app = await _electron.launch(options);
  page = await app.firstWindow(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('已保存到本机', { exact: true }).waitFor();
}
async function state() { const result = await page.evaluate(() => window.cognition.load()); assert.equal(result.ok, true); return result.data; }
async function btn(name) { await page.getByRole('button', { name, exact: true }).click(); }
try {
  await launch();
  await btn('先体验「理解注意力」示例');
  await page.getByRole('heading', { name: '向量表示', exact: true }).waitFor();
  await page.getByRole('tab', { name: '验证', exact: true }).click();
  await page.getByText('先理解，再验证', { exact: true }).waitFor();
  await btn('回到学习');
  await page.locator('#self-report').fill('有序的数值表示，我能区分分量和维数。');
  await btn('我理解了');
  await page.getByRole('radio').first().check(); await btn('提交答案');
  await page.getByText('这里还需要巩固', { exact: true }).waitFor();
  await page.getByRole('radio').nth(1).check(); await btn('提交答案');
  await page.getByText('这道题通过了', { exact: true }).waitFor();
  assert.equal((await state()).goals[0].verified_count, 1);
  await page.getByRole('tab', { name: '笔记', exact: true }).click();
  await page.locator('#note').fill('跨进程重启保留的学习笔记。'); await btn('保存笔记');
  await page.getByText('笔记已保存。', { exact: true }).waitFor();
  await btn('平面');
  const before = await state();
  const circle = await page.locator('.graph-node circle').first().boundingBox();
  await page.mouse.move(circle.x + circle.width / 2, circle.y + circle.height / 2);
  await page.mouse.down(); await page.mouse.move(circle.x + circle.width / 2 + 35, circle.y + circle.height / 2 - 15, { steps: 10 }); await page.mouse.up();
  for (let i = 0; i < 80 && (await state()).revision === before.revision; i++) await new Promise(r => setTimeout(r, 100));
  const dragged = await state();
  assert.notDeepEqual(dragged.goals[0].concepts[0].position, before.goals[0].concepts[0].position);
  assert.deepEqual(dragged.goals[0].relations, before.goals[0].relations);
  await btn('暂停目标'); await page.locator('.pause-notice').waitFor();
  assert.equal(await page.locator('#question').isDisabled(), true);
  await btn('继续目标');
  const exportPath = path.join(dataDir, 'export.md');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportPath);
  await btn('导出学习记录'); await page.getByText('学习记录已导出。', { exact: true }).waitFor();
  assert.match(await readFile(exportPath, 'utf8'), /跨进程重启保留的学习笔记/);
  await app.close(); app = null;
  await launch();
  const restored = await state();
  assert.equal(restored.goals[0].concepts[0].note, '跨进程重启保留的学习笔记。');
  assert.deepEqual(restored.goals[0].concepts[0].position, dragged.goals[0].concepts[0].position);
  assert.equal(restored.goals[0].verified_count, 1);
  // Complete the remaining example questions using the visible learning flow.
  for (const correct of [1, 2, 0, 0]) {
    const current = await state();
    const index = current.goals[0].concepts.findIndex(c => c.status !== 'verified');
    await page.locator('.concept-strip button').nth(index).click();
    await btn('我理解了'); await page.getByRole('radio').nth(correct).check(); await btn('提交答案');
    await page.getByText('这道题通过了', { exact: true }).waitFor();
  }
  assert.equal((await state()).goals[0].status, 'active');
  await btn('目标范围'); await btn('我确认这个目标已完成');
  await page.getByText('你已确认完成这个目标。记录仍可查阅。', { exact: true }).waitFor();
  await btn('历史与恢复'); await page.locator('.history-row button').first().click();
  await btn('取消'); await page.locator('.history-row button').first().click(); await btn('确认恢复');
  await page.getByText('已恢复为新的修订。', { exact: true }).waitFor();
  assert.equal((await state()).goals[0].status, 'active');
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(980,680));
  await page.getByRole('button', {name:'平面',exact:true}).click();
  const bounds = await page.evaluate(() => ({width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, composer: document.querySelector('.composer').getBoundingClientRect().toJSON()}));
  assert.ok(bounds.scrollWidth <= bounds.width && bounds.scrollHeight <= bounds.height);
  assert.ok(bounds.composer.bottom <= bounds.height, 'Question composer must fit the smallest window');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ok:true, runtime:packaged?'packaged':'development', checks:'learning, quiz, drag, notes, pause, export, restart, completion, restore, minimum-window', dataDir}));
} catch(error) {
  console.error(JSON.stringify({error:String(error),alerts:await page.getByRole('alert').allTextContents()}));
  throw error;
} finally { if (app) await app.close(); }
