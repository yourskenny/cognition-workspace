import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, CheckCircle2, ChevronRight, Circle, Clock3, FileText, FolderOpen, History, Leaf, LoaderCircle, MessageCircle, Pause, Play, Plus, Send, Settings2, ShieldCheck, Square, Target, Undo2, X } from 'lucide-react';
import Graph from './Graph';
import ReadingLesson, { ancestry } from './Lesson';
import type { AgentResult, Concept, Goal, Plan, Result, Revision, Settings, Workspace, Term } from './types';
import { statusText } from './types';

const unwrap = <T,>(r: Result<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };
const date = (s: string) => new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialog.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={dialog} aria-label={title} className="modal" onCancel={e => { e.preventDefault(); onClose(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>{children}</dialog>;
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const current = useRef<Workspace | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [goalId, setGoalId] = useState(localStorage.getItem('goal') || '');
  const [selected, setSelected] = useState(localStorage.getItem('concept') || '');
  const [tab, setTab] = useState<'learn' | 'verify' | 'notes'>('learn');
  const [modal, setModal] = useState<'new' | 'settings' | 'history' | 'goal' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [busy, setBusy] = useState<'plan' | 'ask' | 'expand' | 'lesson' | null>(null);
  const [termPreview, setTermPreview] = useState<Term | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const readingPane = useRef<HTMLDivElement>(null);
  const scrolls = useRef<Record<string,number>>({});
  const [stream, setStream] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [draft, setDraft] = useState<Plan | null>(null);
  const [question, setQuestion] = useState('');
  const [reports, setReports] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-flash');
  const [history, setHistory] = useState<Revision[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [showConversation, setShowConversation] = useState(false);
  const apply = useCallback((state: Workspace) => { current.current = state; setWorkspace(state); }, []);
  useEffect(() => {
    if (!window.cognition) { setError('请通过桌面应用启动；浏览器预览不连接本地工作区。'); return; }
    Promise.all([window.cognition.load(), window.cognition.settings()]).then(([w, s]) => { apply(unwrap(w)); const value = unwrap(s); setSettings(value); setModel(value.model); }).catch(e => setError(e.message));
    return window.cognition.onAgentEvent(event => { if (event.type === 'delta') setStream(s => s + event.text); });
  }, [apply]);
  const goal = workspace?.goals.find(g => g.id === goalId) || workspace?.goals.at(-1);
  const concept = goal?.concepts.find(c => c.id === selected) || goal?.concepts[0];
  const key = goal && concept ? `${goal.id}:${concept.id}` : '';
  const roots = goal?.concepts.filter(c=>!c.parent_id)||[];
  const requiredCount = goal?.required_count ?? roots.length;
  const path = goal && concept ? ancestry(goal,concept) : [];
  const visibleIds = new Set([...roots.map(c=>c.id),...path.map(c=>c.id),...(goal?.concepts.filter(c=>c.parent_id===concept?.id).map(c=>c.id)||[])]);
  const visibleGoal = goal ? {...goal,concepts:goal.concepts.filter(c=>visibleIds.has(c.id)),relations:goal.relations.filter(r=>visibleIds.has(r.source)&&visibleIds.has(r.target))} : undefined;
  useEffect(()=>{const frame=requestAnimationFrame(()=>{if(readingPane.current)readingPane.current.scrollTop=tab==='learn'?(scrolls.current[key]||0):0;});return()=>cancelAnimationFrame(frame);},[key,tab]);
  const hasUnsavedNotes = workspace?.goals.some(g => g.concepts.some(c => notes[`${g.id}:${c.id}`] !== undefined && notes[`${g.id}:${c.id}`] !== c.note));
  const rememberScroll = (e: React.UIEvent<HTMLDivElement>) => { if (tab === 'learn') scrolls.current[key] = e.currentTarget.scrollTop; };
  useEffect(() => { if (goal) localStorage.setItem('goal', goal.id); if (concept) localStorage.setItem('concept', concept.id); setChoice(null); }, [goal?.id, concept?.id]);
  const commit = async (action: string, payload: Record<string, unknown>) => {
    if (!current.current || savingRef.current) throw new Error('正在保存，请稍候');
    savingRef.current = true; setSaving(true); setError('');
    try { const next = unwrap(await window.cognition.command({ operation_id: crypto.randomUUID(), base_revision: current.current.revision, action, payload })); apply(next); return next; }
    catch (e) { const result = await window.cognition.load(); if (result.ok) apply(result.data); throw e; }
    finally { savingRef.current = false; setSaving(false); }
  };
  const attempt = async (fn: () => Promise<unknown>) => { setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const select = (id: string) => { if (busy) return; setSelected(id); setChoice(null); setTab('learn'); setTermPreview(null); setShowConversation(false); };
  const enrich = () => attempt(async()=>{if(!goal||!concept)return;setBusy('lesson');try{const result=unwrap(await window.cognition.runAgent({kind:'lesson',input:'补全当前讲解和术语入口',goalId:goal.id,conceptId:concept.id}));if(result.state)apply(result.state);}finally{setBusy(null);}});
  const expandTerm = () => attempt(async()=>{
    if(!goal||!concept||!termPreview)return;
    const term=termPreview,parent=concept;
    const cached=goal.concepts.find(c=>c.parent_id===parent.id&&c.entry_term_id===term.id);
    if(cached){select(cached.id);return;}
    setTermPreview(null);setBusy('expand');
    try {
      const next = goal.origin==='sample' && parent.content_origin!=='ai' ? await commit('expand_concept',{goal_id:goal.id,concept_id:parent.id,term_id:term.id}) : unwrap(await window.cognition.runAgent({kind:'expand',input:term.label,goalId:goal.id,conceptId:parent.id,termId:term.id})).state!;
      apply(next);const target=next.goals.find(g=>g.id===goal.id)!.concepts.find(c=>c.parent_id===parent.id&&c.entry_term_id===term.id)!;
      setSelected(target.id);setTab('learn');setChoice(null);setShowConversation(false);
    } finally {setBusy(null);}
  });
  const createSample = () => attempt(async () => { const next = await commit('sample_goal', {}); setGoalId(next.goals.at(-1)!.id); setSelected('vector'); setModal(null); setTab('learn'); });
  const generate = () => attempt(async () => { setBusy('plan'); setDraft(null); try { const result = unwrap(await window.cognition.runAgent({ kind: 'plan', input: goalInput })); setDraft(result.plan!); } finally { setBusy(null); } });
  const acceptPlan = () => attempt(async () => { const next = await commit('create_goal', { plan: draft }); const g = next.goals.at(-1)!; setGoalId(g.id); setSelected(g.concepts[0].id); setDraft(null); setGoalInput(''); setModal(null); setTab('learn'); });
  const ask = () => attempt(async () => { if (!goal || !concept) return; setBusy('ask'); setStream(''); setShowConversation(true); const input = question; try { const result = unwrap(await window.cognition.runAgent({ kind: 'ask', input, goalId: goal.id, conceptId: concept.id })); if (result.state) apply(result.state); setQuestion(''); setStream(''); } finally { setBusy(null); } });
  const feedback = (understood: boolean) => attempt(async () => { if (!goal || !concept) return; await commit('self_report', { goal_id: goal.id, concept_id: concept.id, text: reports[key] || (understood ? '我理解了这一段内容。' : '这部分我还没有理解。'), understood }); setNotice(understood ? '已记录自述理解，接下来用题目确认。' : '已记录疑问，目标不会降低。可以在下方具体提问。'); if (understood) setTab('verify'); });
  const hasSelfReport = concept?.evidence.some(e => e.type === 'self_report' && e.understood);
  const lastAttempt = concept?.evidence.filter(e => e.type === 'quiz').at(-1);
  const inactive = goal?.status !== 'active';
  const messages = goal?.messages.filter(m => m.concept_id === concept?.id) || [];
  const openHistory = () => attempt(async () => { setHistory(unwrap(await window.cognition.history())); setRestoreTarget(null); setModal('history'); });

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Leaf size={22} /></span><div>认知工作区<small>让每一步学习有方向</small></div></div>
      <button className="new-goal" onClick={() => { setModal('new'); setDraft(null); }} disabled={!!busy}><Plus size={17} />新的学习目标</button>
      <div className="sidebar-section"><span className="eyebrow">我的目标</span><span className="count">{workspace?.goals.length || 0}</span></div>
      <nav className="goal-list" aria-label="学习目标">{workspace?.goals.map(g => <button className={g.id === goal?.id ? 'active' : ''} key={g.id} onClick={() => { setGoalId(g.id); setSelected(g.concepts[0].id); setTab('learn'); setShowConversation(false); }} disabled={!!busy}><Target size={16} /><span>{g.title}<small>{g.status === 'paused' ? '已暂停' : g.status === 'completed' ? '已完成' : `${g.verified_count} / ${g.required_count ?? g.concepts.filter(c=>!c.parent_id).length} 项有验证证据`}</small></span></button>)}</nav>
      {goal && <div className="stage-list"><span className="eyebrow">当前目标的阶段</span>{goal.stages.map((stage, i) => { const cs = goal.concepts.filter(c => c.stage === i && !c.parent_id); const done = cs.length > 0 && cs.every(c => c.status === 'verified'); return <button key={i} className={concept?.stage === i ? 'current' : ''} onClick={() => { const c = cs.find(c => c.status !== 'verified') || cs[0]; if (c) select(c.id); }}><span className="stage-number">{done ? <Check size={13} /> : i + 1}</span><span>{stage}</span></button>; })}</div>}
      <div className="sidebar-bottom"><button onClick={openHistory}><History size={16} />历史与恢复</button><button onClick={() => { setModal('settings'); setApiKey(''); }}><Settings2 size={16} />模型与本地数据</button><div className="local-label"><ShieldCheck size={13} />本地工作区 <span>v0.0.2</span></div></div>
    </aside>
    <main className="main-shell">
      <header className="topbar"><span><span className="online-dot" />{saving ? '正在保存…' : workspace ? (hasUnsavedNotes ? '笔记有未保存修改' : '已保存到本机') : '连接本地服务…'}</span><div><span className="model-label">{settings?.configured ? `DeepSeek · ${settings.model}` : '尚未连接模型'}</span><button className="icon-button" aria-label="导出学习记录" onClick={() => attempt(async () => { const file = unwrap(await window.cognition.exportNotes()); if (file) setNotice('学习记录已导出。'); })}><ArrowDownToLine size={17} /></button></div></header>
      {(error || notice) && <div className={`banner ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}><X size={15} /></button></div>}
      {!workspace ? <div className="loading"><LoaderCircle className="spin" /><p>{error ? '工作区未就绪' : '正在打开本地工作区'}</p></div> : !goal ? <div className="welcome">
        <span className="eyebrow">从一个想解决的问题开始</span><h1>你希望学会什么？</h1><p>把目标带进来。一起找到需要理解的概念，<br />建立联系，再用真实回答确认进步。</p>
        <div className="welcome-input"><label htmlFor="welcome-goal" className="sr-only">你的学习目标</label><textarea id="welcome-goal" value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder="例如：我想理解注意力机制，能够解释它如何分配权重。" rows={3} maxLength={5000} /><button className="primary" disabled={!goalInput.trim()} onClick={() => setModal('new')}>整理成学习目标<ArrowRight size={16} /></button></div>
        <button className="text-button sample-link" onClick={createSample} disabled={saving}>先体验「理解注意力」示例<ArrowRight size={15} /></button>
        <div className="welcome-steps"><span><Target size={17} />明确一个目标</span><ChevronRight size={13} /><span><WaypointsIcon />探索认识结构</span><ChevronRight size={13} /><span><CheckCircle2 size={17} />确认学习结果</span></div>
        <p className="welcome-foot">资料与进度保存在本机 · 使用模型时发送当前任务相关内容</p>
      </div> : <>
        <section className="goal-header"><div><div className="eyebrow">当前学习目标 <span className="source-label">{goal.origin === 'sample' && concept?.content_origin !== 'ai' ? '离线示例' : 'AI 草案 · 未经信源核验'}</span></div><h1>{goal.title}</h1><p>{goal.outcome}</p></div><div className="goal-actions"><button className="subtle" onClick={() => setModal('goal')}>目标范围</button><button className="icon-button" aria-label={goal.status === 'active' ? '暂停目标' : '继续目标'} disabled={saving} onClick={() => attempt(() => commit('goal_status', { goal_id: goal.id, status: goal.status === 'active' ? 'paused' : 'active' }))}>{goal.status === 'active' ? <Pause size={17} /> : <Play size={17} />}</button></div></section>
        {goal.origin==='sample' && (goal.content_version||1)<2 && <div className="content-update"><span>注意力示例已有新版：完整推理、连续例子与可展开术语。</span><button disabled={!!busy||saving||inactive} onClick={()=>attempt(async()=>{await commit('refresh_sample',{goal_id:goal.id});setNotice('示例讲解已更新，原有笔记和学习证据已保留。');})}>升级这个示例的讲解</button></div>}
        {(busy==='expand'||busy==='lesson') && <div className="lesson-progress" role="status"><LoaderCircle className="spin" size={16}/><span>{busy==='expand'?'正在打开这一层解释，主线和阅读位置会保留…':'正在补全讲解的衔接、推理与术语…'}</span><button onClick={()=>attempt(async()=>{unwrap(await window.cognition.cancelAgent());})}>停止</button></div>}
        {inactive && <div className="pause-notice">{goal.status === 'completed' ? '你已确认完成这个目标。记录仍可查阅。' : '这个目标已暂停。点击右上方继续，恢复学习。'}</div>}
        <div className={`workspace-grid reading-layout ${mapExpanded ? 'map-expanded' : ''}`}>
          <div className="exploration"><div className="map-controls"><span>主线与当前展开</span><button className="text-button" onClick={()=>setMapExpanded(!mapExpanded)}>{mapExpanded ? '返回阅读布局' : '放大地图'}</button></div><Graph goal={visibleGoal!} selected={concept!.id} onSelect={select} onMove={(id, position) => attempt(() => commit('layout', { goal_id: goal.id, concept_id: id, position }))} disabled={saving || !!busy} />
            <section className="conversation"><div className="conversation-heading"><span><MessageCircle size={16} />围绕当前概念提问</span><button className="text-button" onClick={() => setShowConversation(!showConversation)}>{showConversation ? '收起记录' : `展开记录${messages.length ? ` (${messages.length})` : ''}`}</button></div>
              {showConversation && <div className="messages" aria-live="polite">{messages.length === 0 && !stream && <p className="empty-small">问题会携带当前目标和选中的概念。</p>}{messages.map(m => <div className="exchange" key={m.id}><div className="question">{m.question}</div><div className="answer"><span className="eyebrow">AI 解释 · 未核验</span><Markdown components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt}</span> }} skipHtml>{m.answer}</Markdown></div></div>)}{stream && <div className="answer streaming">{stream}</div>}{busy === 'ask' && !stream && <div className="empty-small"><LoaderCircle className="spin" size={14} />正在围绕目标思考…</div>}</div>}
              <div className="composer"><label htmlFor="question" className="sr-only">围绕当前概念提问</label><textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} placeholder={`关于「${concept!.title}」，你想进一步理解什么？`} rows={2} maxLength={5000} disabled={inactive} />{busy ? <button aria-label="停止模型任务" className="stop" onClick={() => attempt(async () => { unwrap(await window.cognition.cancelAgent()); })}><Square size={15} />停止</button> : <button aria-label="发送问题" className="primary" onClick={ask} disabled={!question.trim() || inactive || saving}><Send size={17} /></button>}</div>
              <div className="composer-meta">{settings?.configured ? '只发送当前目标、概念、笔记和最近相关问答' : '在模型设置中连接 DeepSeek 后可提问'}</div>
            </section>
          </div>
          <aside className="learning-panel" aria-label="概念学习面板"><div className="learning-heading"><span className="reading-kind">{concept!.parent_id ? '补充解释 · 可随时返回主线' : '主线讲解'}</span><span className={`status-chip ${concept!.status}`}>{statusText[concept!.status]}</span><h2>{concept!.title}</h2></div>
            <div className="tabs" role="tablist" aria-label="学习内容"><button role="tab" aria-selected={tab === 'learn'} onClick={() => setTab('learn')}><BookOpen size={15} />学习</button><button role="tab" aria-selected={tab === 'verify'} onClick={() => setTab('verify')}><CheckCircle2 size={15} />验证</button><button role="tab" aria-selected={tab === 'notes'} onClick={() => setTab('notes')}><FileText size={15} />笔记</button></div>
            {tab === 'learn' && <div className="panel-content" key={key+tab} ref={readingPane} onScroll={rememberScroll}><ReadingLesson goal={goal} concept={concept!} onSelect={select} onTerm={setTermPreview} onEnrich={enrich} busy={!!busy||saving}/><div className="understanding"><h3>现在，你理解了吗？</h3><p className="muted">说说你的理解或卡住的地方。自述与课后验证分别记录。</p><label htmlFor="self-report" className="sr-only">你的理解或疑问</label><textarea id="self-report" rows={3} value={reports[key] || ''} onChange={e => setReports(p => ({ ...p, [key]: e.target.value }))} placeholder="用自己的话解释一下，也可以写下疑问…" maxLength={4000} disabled={inactive} /><div className="button-row"><button className="primary" onClick={() => feedback(true)} disabled={saving || inactive}><Check size={16} />我理解了</button><button onClick={() => feedback(false)} disabled={saving || inactive}>还有疑问</button></div></div></div>}
            {tab === 'verify' && <div className="panel-content" key={key+tab} ref={readingPane} onScroll={rememberScroll}>{!hasSelfReport ? <div className="verification-empty"><CheckCircle2 size={30} /><h3>先理解，再验证</h3><p>完成学习时的理解确认后，进入课后题。</p><button onClick={() => setTab('learn')}>回到学习</button></div> : <><span className="eyebrow">课后应用题</span><h3 className="question-title">{concept!.question.prompt}</h3><div className="options">{concept!.question.options.map((option, i) => <label className={choice === i ? 'chosen' : ''} key={i}><input type="radio" name={`answer-${key}`} checked={choice === i} onChange={() => setChoice(i)} disabled={saving || inactive} /><span className="option-letter">{String.fromCharCode(65 + i)}</span><span>{option}</span></label>)}</div><button className="primary full" disabled={choice === null || saving || inactive} onClick={() => attempt(async () => { await commit('answer', { goal_id: goal.id, concept_id: concept!.id, choice }); setChoice(null); })}>提交答案<ArrowRight size={15} /></button>{lastAttempt && <div className={`result ${lastAttempt.passed ? 'passed' : 'review'}`} role="status"><h3>{lastAttempt.passed ? '这道题通过了' : '这里还需要巩固'}</h3><p>{lastAttempt.feedback}</p><small>仅记录本题的验证证据，不代表全面或永久掌握。</small>{lastAttempt.passed && concept!.parent_id && <button onClick={() => select(concept!.parent_id!)}>返回上层讲解<ArrowRight size={14} /></button>}{lastAttempt.passed && !concept!.parent_id && roots.some(c => c.id !== concept!.id && c.status !== 'verified') && <button onClick={() => { const next = roots.find(c => c.id !== concept!.id && c.status !== 'verified'); if (next) select(next.id); }}>继续下一个概念<ArrowRight size={14} /></button>}</div>}</>}
              {concept!.evidence.length > 0 && <details className="evidence"><summary>查看学习证据 ({concept!.evidence.length})</summary>{concept!.evidence.slice().reverse().map(e => <div key={e.id}><time>{date(e.time)}</time><p>{e.type === 'self_report' ? `${e.understood ? '自述理解' : '仍有疑问'}：${e.text}` : `${e.passed ? '本题通过' : '本题待巩固'}：${e.answer_text}`}</p></div>)}</details>}
            </div>}
            {tab === 'notes' && <div className="panel-content" key={key+tab} ref={readingPane} onScroll={rememberScroll}><p className="muted">保留自己的解释、疑问和联系。笔记随工作区修订保存。</p><label className="sr-only" htmlFor="note">概念笔记</label><textarea id="note" className="note-input" value={notes[key] ?? concept!.note} onChange={e => setNotes(p => ({ ...p, [key]: e.target.value }))} placeholder="写下对你有意义的理解…" maxLength={20000} /><button className="primary" disabled={saving || (notes[key] ?? concept!.note) === concept!.note} onClick={() => attempt(async () => { await commit('note', { goal_id: goal.id, concept_id: concept!.id, text: notes[key] ?? concept!.note }); setNotice('笔记已保存。'); })}>保存笔记</button></div>}
            <div className="panel-footer"><span>{goal.verified_count} / {requiredCount} 项主线有验证证据</span>{goal.verified_count === requiredCount && goal.status === 'active' && <button className="text-button" onClick={() => setModal('goal')}>确认完成<ArrowRight size={13} /></button>}</div>
          </aside>
        </div>
      </>}
    </main>
    {termPreview && concept && <Modal title={termPreview.label} onClose={()=>setTermPreview(null)}><span className="eyebrow">先看这一层，够用就继续主线</span><p className="term-preview-text">{termPreview.preview}</p><div className="term-reason"><h3>为什么这里需要它</h3><p>{termPreview.reason}</p></div><p className="muted">来自「{concept.title}」。深入后可以继续打开下一层，也能返回这里接着读；补充解释不会增加必学节点数量。</p><div className="modal-actions"><button onClick={()=>setTermPreview(null)}>暂时够用，继续阅读</button><button className="primary" onClick={expandTerm} disabled={!!busy||saving||inactive}>打开这一层解释<ArrowRight size={16}/></button></div></Modal>}
    {modal === 'new' && <Modal title="从需求到学习目标" onClose={() => { if (!busy) setModal(null); }}><p className="muted">目标是助手的边界。先拟定范围，你确认后再开始。</p><label htmlFor="goal-input">我希望学会<textarea id="goal-input" rows={3} value={goalInput} onChange={e => setGoalInput(e.target.value)} placeholder="描述一个你想理解的问题，或希望完成的任务" maxLength={5000} disabled={!!busy} /></label>{!settings?.configured && <div className="inline-info">需要连接模型才能拆解新目标。你也可以先体验离线示例。</div>}
      {draft && <div className="plan-preview"><span className="eyebrow">目标草案 · AI 生成，未经信源核验</span><h3>{draft.title}</h3><p><b>完成依据</b>{draft.outcome}</p><p><b>学习范围</b>{draft.scope}</p><ol>{draft.stages.map((s, i) => <li key={i}>{s}</li>)}</ol><div className="plan-concepts">{draft.concepts.map(c => <span key={c.id}>{c.title}</span>)}</div></div>}
      {busy === 'plan' && <div className="planning"><LoaderCircle className="spin" size={18} /><span>正在拆解目标、组织概念与课后题…</span><button onClick={() => attempt(async () => { unwrap(await window.cognition.cancelAgent()); })}>停止</button></div>}
      <div className="modal-actions"><button className="subtle" disabled={!!busy || saving} onClick={createSample}>体验离线示例</button>{draft ? <><button onClick={generate} disabled={!!busy || saving}>重新拟定</button><button className="primary" disabled={saving || !!busy} onClick={acceptPlan}>确认并开始学习<ArrowRight size={16} /></button></> : <button className="primary" disabled={!goalInput.trim() || !!busy || !settings?.configured} onClick={generate}>拟定目标<ArrowRight size={16} /></button>}</div>{error && <p className="modal-error" role="alert">{error}</p>}</Modal>}
    {modal === 'settings' && <Modal title="模型与本地数据" onClose={() => { setModal(null); setApiKey(''); }}><div className="settings-provider"><span className="provider-mark">D</span><div><h3>DeepSeek</h3><p className="muted">{settings?.configured ? '已保存加密密钥' : '尚未配置密钥'} · Pi SDK 运行时</p></div></div><label htmlFor="api-key">API Key<input id="api-key" type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={settings?.configured ? '留空保留现有密钥' : '输入你的 API Key'} maxLength={512} /></label><label htmlFor="model">模型<select id="model" value={model} onChange={e => setModel(e.target.value)}><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro</option></select></label><p className="muted">密钥由 Windows 加密保存。模型请求会发送当前目标、选中概念及相关笔记与问答。停止请求仍可能产生已消耗的推理费用。</p><div className="button-row"><button className="primary" disabled={!!busy || (!apiKey && !settings?.configured)} onClick={() => attempt(async () => { setSettings(unwrap(await window.cognition.saveSettings({ api_key: apiKey, model }))); setApiKey(''); setNotice('模型设置已保存。'); setModal(null); })}>保存设置</button>{settings?.configured && <button disabled={!!busy} onClick={() => attempt(async () => { setSettings(unwrap(await window.cognition.deleteKey())); setApiKey(''); setNotice('本机密钥已删除。'); })}>删除本机密钥</button>}</div><hr /><h3>你的数据属于你</h3><p className="muted">完整学习记录保存在本机，可导出 Markdown。修订目录包含结构化记录与可读文档。</p><div className="button-row"><button onClick={() => attempt(async () => { unwrap(await window.cognition.openData()); })}><FolderOpen size={16} />打开工作区目录</button><button onClick={() => attempt(async () => { const file = unwrap(await window.cognition.exportNotes()); if (file) setNotice('学习记录已导出。'); })}><ArrowDownToLine size={16} />导出记录</button></div>{error && <p className="modal-error" role="alert">{error}</p>}</Modal>}
    {modal === 'history' && <Modal title="历史与恢复" onClose={() => setModal(null)}><p className="muted">恢复会创建新修订，旧记录仍保留。当前未保存的笔记草稿不会写入历史。</p><div className="history-list">{history.slice(0, 80).map((r, i) => <div className="history-row" key={r.revision_id}><Clock3 size={15} /><div><span>{r.summary}</span><small>修订 {r.revision} · {date(r.time)}</small></div>{i === 0 ? <span className="quiet-tag">当前</span> : <button disabled={saving} onClick={() => setRestoreTarget(r.revision_id)}><Undo2 size={14} />恢复</button>}</div>)}</div>{restoreTarget && <div className="restore-confirm"><p>将恢复所选版本的目标、笔记、布局和学习进度。之后的记录仍可在历史中找回。</p><div className="button-row"><button onClick={() => setRestoreTarget(null)}>取消</button><button className="primary" disabled={saving} onClick={() => attempt(async () => { await commit('restore', { revision_id: restoreTarget }); setNotes({}); setReports({}); setModal(null); setNotice('已恢复为新的修订。'); })}>确认恢复</button></div></div>}{error && <p className="modal-error" role="alert">{error}</p>}</Modal>}
    {modal === 'goal' && goal && <Modal title="当前目标的边界" onClose={() => setModal(null)}><h3>{goal.title}</h3><div className="goal-detail"><span className="eyebrow">完成依据</span><p>{goal.outcome}</p><span className="eyebrow">本次范围</span><p>{goal.scope}</p></div><p className="muted">需要明显扩大范围时，建立新的目标。学习困难会通过补前提与练习处理，不自动降低目标。</p><div className="modal-actions">{goal.status !== 'completed' && <button className="primary" disabled={goal.verified_count !== requiredCount || saving || !!busy} onClick={() => attempt(async () => { await commit('goal_status', { goal_id: goal.id, status: 'completed' }); setModal(null); setNotice('已记录你对目标完成的确认。'); })}>我确认这个目标已完成</button>}</div>{goal.verified_count !== requiredCount && <p className="muted">先完成各概念的课后验证，再确认目标完成。</p>}</Modal>}
  </div>;
}

function WaypointsIcon() { return <Circle size={17} />; }
