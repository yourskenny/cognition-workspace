import {_electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,copyFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=process.cwd(), live=process.argv.includes('--live'), packaged=process.argv.includes('--packaged');
await mkdir(path.join(root,'.test-data'),{recursive:true});
await mkdir(path.join(root,'test-results'),{recursive:true});
const dataDir=await mkdtemp(path.join(root,'.test-data','reading-check-'));
const legacy=process.argv.includes('--legacy');
if(legacy)execFileSync(path.join(root,'.venv','Scripts','python.exe'),['scripts/legacy-reading-fixture.py',dataDir]);
if(live)await copyFile(path.join(process.env.APPDATA,'cognition-workspace','credentials.json'),path.join(dataDir,'credentials.json'));
const env={...process.env,COGNITION_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
const output=JSON.parse(await readFile('package.json','utf8')).build.directories.output;
const app=await _electron.launch({cwd:root,env,timeout:25000,...(packaged?{executablePath:path.join(root,output,'win-unpacked','认知工作区.exe'),args:[]}:{args:['.']})}).catch(async error=>{if(live)await unlink(path.join(dataDir,'credentials.json')).catch(()=>{});throw error;});
const page=await app.firstWindow();page.setDefaultTimeout(10000);
if(live)await app.evaluate(()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    const response=await original(input,options);
    if(String(input).endsWith('/validate-plan')||String(input).endsWith('/validate-explanation')){
      globalThis.__readingQA={request:JSON.parse(options.body),validation:await response.clone().json()};
    }
    return response;
  };
});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const state=async()=>{const r=await page.evaluate(()=>window.cognition.load());assert.ok(r.ok);return r.data;};
const btn=async name=>page.getByRole('button',{name,exact:true}).click();
async function capture(name){
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const bytes=await app.evaluate(async({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];const im=await w.capturePage();const [width,height]=w.getContentSize();return im.resize({width,height}).toPNG();});
  assert.ok(bytes.length);await writeFile(path.join(root,'test-results','v02-'+name+'.png'),bytes);
}
try{
  await page.getByText('已保存到本机',{exact:true}).waitFor();
  if(legacy){
    await btn('升级这个示例的讲解');
    await page.getByText('示例讲解已更新，原有笔记和学习证据已保留。',{exact:true}).waitFor();
    const migrated=(await state()).goals[0];
    assert.equal(migrated.content_version,2);
    assert.equal(migrated.concepts[2].note,'旧版本保留的学习笔记');
    console.log(JSON.stringify({check:'v01-lesson-upgrade',ok:true}));
  }else await btn('先体验「理解注意力」示例');
  await page.locator('.concept-strip button').nth(2).click();
  await page.getByRole('heading',{name:'从分数到权重',exact:true}).waitFor();
  const bounds=await page.evaluate(()=>({reader:document.querySelector('.learning-panel').getBoundingClientRect().width,map:document.querySelector('.exploration').getBoundingClientRect().width}));
  assert.ok(bounds.reader > bounds.map*2,JSON.stringify(bounds));
  assert.ok((await page.locator('.reading-lesson').innerText()).length>700);
  await capture('main-lesson');
  await page.getByRole('button',{name:'解释术语：指数函数',exact:true}).first().click();
  await capture('term-preview');
  const returnScroll=await page.locator('.panel-content').evaluate(e=>e.scrollTop);
  await btn('打开这一层解释');
  await page.getByRole('heading',{name:'指数函数',exact:true}).waitFor();
  let s=await state();let g=s.goals[0];assert.equal(g.required_count,5);assert.equal(g.concepts.length,6);
  await capture('first-expansion');
  await page.getByRole('button',{name:'解释术语：幂',exact:true}).first().click();await btn('打开这一层解释');
  await page.getByRole('heading',{name:'幂',exact:true}).waitFor();
  assert.equal((await state()).goals[0].concepts.length,7);
  await capture('second-expansion');
  await btn('返回上层讲解');await page.getByRole('heading',{name:'指数函数',exact:true}).waitFor();
  await btn('返回上层讲解');await page.getByRole('heading',{name:'从分数到权重',exact:true}).waitFor();
  await page.waitForTimeout(100);
  assert.ok(Math.abs((await page.locator('.panel-content').evaluate(e=>e.scrollTop))-returnScroll)<5,'Parent reading position must be restored');
  await page.getByRole('button',{name:'解释术语：指数函数',exact:true}).first().click();await btn('打开这一层解释');
  assert.equal((await state()).goals[0].concepts.length,7,'Reopening must use cached explanation');
  await btn('我理解了');await page.getByRole('radio').first().check();await btn('提交答案');
  await page.getByText('这道题通过了',{exact:true}).waitFor();
  assert.equal((await state()).goals[0].verified_count,0,'Supplemental quiz must not count as a mainline pass');
  await btn('返回上层讲解');await page.getByRole('heading',{name:'从分数到权重',exact:true}).waitFor();
  await page.getByRole('button',{name:'解释术语：指数函数',exact:true}).first().click();await btn('打开这一层解释');
  await page.reload();await page.getByRole('heading',{name:'指数函数',exact:true}).waitFor();
  await btn('返回上层讲解');
  await btn('放大地图');await capture('expanded-map');await btn('返回阅读布局');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,680));
  await capture('minimum-window');
  const small=await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,reader:document.querySelector('.learning-panel').getBoundingClientRect().toJSON(),composer:document.querySelector('.composer').getBoundingClientRect().toJSON()}));
  assert.ok(small.sw<=small.w&&small.sh<=small.h);
  assert.ok(small.reader.right<=small.w+1&&small.composer.bottom<=small.h+1,JSON.stringify(small));
  console.log(JSON.stringify({check:'reading-recursion-return-cache-layout',ok:true,dataDir}));
  if(live){
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,920));
    await btn('新的学习目标');await page.locator('#goal-input').fill('我只会基本四则运算，希望理解二分查找，能手算一个查找过程并解释为何每次可以舍弃一半。');
    await btn('拟定目标');
    console.log('Generating one real structured learning plan…');
    await Promise.race([
      page.getByRole('button',{name:'确认并开始学习',exact:true}).waitFor({timeout:365000}),
      page.getByRole('alert').first().waitFor({timeout:365000}).then(async()=>{throw new Error(await page.getByRole('alert').first().innerText());})
    ]);
    await capture('live-plan');
    const goalsBefore=(await state()).goals.length;
    await btn('确认并开始学习');
    await page.waitForFunction(async count=>(await window.cognition.load()).data.goals.length===count+1,goalsBefore);
    g=(await state()).goals.at(-1);
    await page.locator('.goal-header h1').filter({hasText:g.title}).waitFor();
    await page.getByRole('heading',{name:'先把这件事想明白',exact:true}).waitFor();
    assert.ok(g.concepts.every(c=>c.lesson&&c.lesson.steps.length>=2));
    const index=g.concepts.findIndex(c=>c.terms.length>0);assert.ok(index>=0);
    await page.locator('.concept-strip button').nth(index).click();
    await capture('live-lesson');
    await page.locator('.term-directory button').first().click();await btn('打开这一层解释');
    console.log('Expanding one term with real parent/goal context…');
    await page.getByRole('button',{name:'返回上层讲解',exact:true}).waitFor({timeout:245000});
    await capture('live-expansion');
    s=await state();const updated=s.goals.at(-1);const child=updated.concepts.find(c=>c.parent_id);
    assert.ok(child.lesson.steps.length>=2);assert.equal(updated.required_count,g.concepts.length);
    await writeFile(path.join(root,'test-results','v02-live-content.json'),JSON.stringify(updated,null,2));
    console.log(JSON.stringify({check:'live-plan-and-term-expansion',ok:true,mainline:g.concepts.length,childTitle:child.title,childTerms:child.terms.length}));
  }
  assert.deepEqual(errors,[]);
}catch(error){
  if(live)await writeFile(path.join(root,'test-results','v02-validation-failure.json'),JSON.stringify(await app.evaluate(()=>globalThis.__readingQA||null),null,2));
  await capture('failure').catch(()=>{});
  const alerts=await page.getByRole('alert').allTextContents().catch(()=>[]);
  console.error(JSON.stringify({check:'reading-failed',error:String(error),alerts}));
  throw error;
}finally{
  await app.close();
  if(live)await unlink(path.join(dataDir,'credentials.json')).catch(()=>{});
}
