const { app, BrowserWindow, ipcMain, dialog, shell, utilityProcess, session } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

let window, backend, backendPort, agentJob;
const token = crypto.randomBytes(32).toString('hex');
const root = path.resolve(__dirname, '..');
const devUrl = process.env.COGNITION_DEV_URL;
const dataDir = process.env.COGNITION_DATA_DIR || path.join(app.getPath('appData'), 'cognition-workspace');
app.setPath('userData', path.join(dataDir, 'desktop'));

function safeError(e) { return String(e?.message || '操作失败').replace(/sk-[\w-]+/g, '[已隐藏]').slice(0, 700); }
async function api(route, method = 'GET', body) {
  if (!backendPort) throw new Error('本地服务尚未就绪');
  const response = await fetch(`http://127.0.0.1:${backendPort}${route}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (Array.isArray(error.detail) && route.startsWith('/validate-')) {
      const issue = error.detail[0], loc = issue.loc || [];
      const index = loc.indexOf('concepts');
      const section = index >= 0 && Number.isInteger(loc[index + 1]) ? `第 ${loc[index + 1] + 1} 节` : '这层';
      const failure = new Error(`模型返回的${section}讲解结构不符合要求，尚未保存。请重试，原有内容和输入仍保留。`);
      failure.validationIssues = error.detail.map(({loc, type, msg}) => ({loc, type, msg}));
      throw failure;
    }
    throw new Error(typeof error.detail === 'string' ? error.detail : `数据校验失败 (${response.status})`);
  }
  return route === '/export' ? response.text() : response.json();
}

async function startBackend() {
  const executable = app.isPackaged ? path.join(process.resourcesPath, 'backend', 'cognition-backend.exe') : path.join(root, '.venv', 'Scripts', 'python.exe');
  const args = app.isPackaged ? ['--data-dir', dataDir] : [path.join(root, 'backend', 'main.py'), '--data-dir', dataDir];
  backend = spawn(executable, args, { windowsHide: true, env: { ...process.env, COGNITION_LOCAL_TOKEN: token, PYTHONUTF8: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => reject(new Error('本地服务启动超时')), 35000);
    backend.stdout.on('data', chunk => { stdout += chunk.toString(); const match = stdout.match(/COGNITION_PORT=(\d+)/); if (match) { backendPort = Number(match[1]); clearTimeout(timeout); resolve(); } });
    backend.once('error', e => { clearTimeout(timeout); reject(e); });
    backend.once('exit', code => { clearTimeout(timeout); reject(new Error(`本地服务退出 (${code})`)); });
    backend.stderr.on('data', () => {}); // Do not expose request data or credentials in logs.
  });
  for (let i = 0; i < 100; i++) { try { await api('/health'); return; } catch { await new Promise(r => setTimeout(r, 80)); } }
  throw new Error('无法连接本地服务');
}

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('未授权的窗口');
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    try { trusted(event); return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, error: safeError(e) }; }
  });
}

function launchAgent(request, job) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(__dirname, 'agent.mjs'), [], { cwd: dataDir, stdio: 'pipe', serviceName: 'Cognition Agent' });
    let done = false;
    const finish = (error, result) => {
      if (done) return; done = true; clearTimeout(timer); child.kill();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('模型请求超时，已停止。你的输入仍保留，可以重试。')), request.kind === 'plan' ? 180000 : 120000);
    job.child = child;
    job.cancel = () => { job.cancelled = true; finish(new Error('任务已取消')); };
    child.on('spawn', () => child.postMessage({ type: 'run', request }));
    child.on('message', message => {
      if (message.type === 'delta' && !window?.isDestroyed()) window.webContents.send('agent:event', { type: 'delta', text: message.text });
      if (message.type === 'result') finish(null, message.result);
      if (message.type === 'error') finish(new Error(message.error));
    });
    child.on('exit', () => { if (!done) finish(new Error('Agent 进程意外退出，请重试。')); });
    child.stderr?.on('data', () => {});
    child.stdout?.on('data', () => {});
  });
}

function setupHandlers() {
  handle('workspace:load', () => api('/workspace'));
  handle('workspace:history', () => api('/history'));
  handle('workspace:command', async command => {
    if (!command || typeof command !== 'object') throw new Error('无效操作');
    if (command.action === 'message') throw new Error('问答仅由 Agent 运行结果保存');
    if (agentJob && ['goal_status', 'restore', 'refresh_sample'].includes(command.action)) agentJob.cancel();
    return api('/command', 'POST', command);
  });
  handle('settings:get', () => api('/settings'));
  handle('settings:save', data => { if (agentJob) throw new Error('请先停止当前模型任务'); return api('/settings', 'PUT', data); });
  handle('settings:delete', () => { if (agentJob) throw new Error('请先停止当前模型任务'); return api('/settings', 'DELETE'); });
  handle('workspace:open', () => shell.openPath(path.join(dataDir, 'workspace')));
  handle('workspace:export', async () => {
    const result = await dialog.showSaveDialog(window, { title: '导出学习记录', defaultPath: '学习记录.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, await api('/export'), 'utf8');
    return result.filePath;
  });
  handle('agent:cancel', () => { agentJob?.cancel(); return true; });
  handle('agent:run', async data => {
    if (agentJob) throw new Error('已有任务运行中，请等待或停止');
    if (!data || !['plan', 'ask', 'expand', 'lesson'].includes(data.kind) || typeof data.input !== 'string' || !data.input.trim() || data.input.length > 5000) throw new Error('请输入有效的学习目标或问题（最多 5000 字）');
    const job = { cancelled: false, cancel() { this.cancelled = true; } };
    agentJob = job;
    try {
    const credential = await api('/internal/credentials');
    if (!credential.configured) throw new Error('请先配置 DeepSeek API Key，或体验示例目标');
    const before = await api('/workspace');
    let context, goal, concept;
    if (data.kind !== 'plan') {
      goal = before.goals.find(g => g.id === data.goalId);
      if (!goal || goal.status !== 'active') throw new Error('请先选择一个正在进行的目标');
      concept = goal.concepts.find(c => c.id === data.conceptId);
      if (!concept) throw new Error('请先选择当前概念');
      const ancestors = []; let ancestor = concept;
      while (ancestor?.parent_id && ancestors.length < 500) { ancestor = goal.concepts.find(c => c.id === ancestor.parent_id); if (ancestor) ancestors.unshift({title:ancestor.title,summary:ancestor.summary}); }
      const term = data.kind === 'expand' ? concept.terms?.find(t => t.id === data.termId) : undefined;
      if (data.kind === 'expand' && !term) throw new Error('当前讲解没有这个术语，请刷新后重试');
      context = { goal: goal.title, outcome: goal.outcome, scope: goal.scope, mainline: goal.concepts.filter(c => !c.parent_id).map(c => ({title:c.title,summary:c.summary})), ancestors, term, concept: { title: concept.title, summary: concept.summary, example: concept.example, lesson:concept.lesson, terms:concept.terms, note: concept.note }, recent: goal.messages.filter(m => m.concept_id === concept.id).slice(-4).map(m => ({ question: m.question, answer: m.answer })) };
    }
    if (job.cancelled) throw new Error('任务已取消');
    const request = { kind: data.kind, input: data.input.trim(), context, credential, workDir: path.join(dataDir, 'agent-scratch') };
    let result = await launchAgent(request, job);
    if (job.cancelled) throw new Error('任务已取消');
    let validated;
    if (data.kind !== 'ask') {
      const validate = () => data.kind === 'plan' ? api('/validate-plan','POST',{plan:result.plan}) : api('/validate-explanation','POST',result.explanation);
      try { validated = await validate(); }
      catch(error) {
        if (!error.validationIssues || job.cancelled) throw error;
        const previousUsage = result.usage;
        result = await launchAgent({...request,repair:{draft:result.plan||result.explanation,issues:error.validationIssues}},job);
        if (job.cancelled) throw new Error('任务已取消');
        validated = await validate(); // At most one repair; never commit a rejected draft.
        if(previousUsage&&result.usage)result.usage={input:previousUsage.input+result.usage.input,output:previousUsage.output+result.usage.output};
      }
    }
    if (data.kind === 'plan') return { ...result, plan: validated };
    const after = await api('/workspace');
    if (job.cancelled) throw new Error('任务已取消');
    const currentGoal = after.goals.find(g => g.id === goal.id);
    // Only view/evidence/note commits can happen while this request runs. A restore changes the graph.
    if (!currentGoal || currentGoal.status !== 'active' || currentGoal.title !== goal.title || currentGoal.scope !== goal.scope) throw new Error('目标已变化，旧回答未写入。请围绕新目标重试。');
    if (data.kind === 'expand' || data.kind === 'lesson') {
      const explanation = validated;
      if (job.cancelled) throw new Error('任务已取消');
      const state = await api('/command', 'POST', {operation_id:crypto.randomUUID(),base_revision:after.revision,action:data.kind === 'expand' ? 'expand_concept' : 'enrich_lesson',payload:{goal_id:goal.id,concept_id:concept.id,term_id:data.termId,expected_content:concept.content_token,explanation}});
      return {state, usage:result.usage};
    }
    const state = await api('/command', 'POST', { operation_id: crypto.randomUUID(), base_revision: after.revision, action: 'message', payload: { goal_id: goal.id, concept_id: data.conceptId, question: data.input.trim(), answer: result.text } });
    return { ...result, state };
    } finally { if (agentJob === job) agentJob = null; }
  });
}

async function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 920, minWidth: 980, minHeight: 680, title: '认知工作区', backgroundColor: '#f7f8f4', show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { window = null; });
  window.once('ready-to-show', () => window.show());
  await (devUrl ? window.loadURL(devUrl) : window.loadFile(path.join(root, 'dist', 'index.html')));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    await fs.mkdir(dataDir, { recursive: true });
    await startBackend(); setupHandlers(); await createWindow();
  }).catch(e => { dialog.showErrorBox('认知工作区无法启动', safeError(e)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { agentJob?.cancel(); backend?.kill(); });
}
