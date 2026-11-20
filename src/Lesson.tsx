import { ArrowLeft, ArrowRight, BookOpen, Layers } from 'lucide-react';
import type { Concept, Goal, Term } from './types';

export function ancestry(goal: Goal, concept: Concept): Concept[] {
  const path: Concept[] = [], seen = new Set<string>(); let node: Concept | undefined = concept;
  while (node && !seen.has(node.id)) { seen.add(node.id); path.unshift(node); node = goal.concepts.find(c => c.id === node!.parent_id); }
  return path;
}

function LinkedText({text, terms, onTerm}: {text:string;terms:Term[];onTerm:(t:Term)=>void}) {
  if (!terms.length) return <p>{text}</p>;
  const labels = [...terms].sort((a,b)=>b.label.length-a.label.length);
  const escape = (value:string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${labels.map(t=>escape(t.label)).join('|')})`, 'g'));
  return <p>{parts.map((part,i)=>{const term=terms.find(t=>t.label===part);return term ? <button key={i} className="term-link" onClick={()=>onTerm(term)} aria-label={`解释术语：${part}`}>{part}</button> : <span key={i}>{part}</span>;})}</p>;
}

export default function ReadingLesson({goal,concept,onSelect,onTerm,onEnrich,busy}: {goal:Goal;concept:Concept;onSelect:(id:string)=>void;onTerm:(term:Term)=>void;onEnrich:()=>void;busy:boolean}) {
  const l = concept.lesson, terms=concept.terms||[], path=ancestry(goal,concept);
  const parent=path.at(-2), root=path[0];
  const text=(value:string)=><LinkedText text={value} terms={terms} onTerm={onTerm}/>;
  const characters = concept.summary.length+concept.example.length+(l ? JSON.stringify(l).length:0);
  return <article className="reading-lesson">
    <nav className="reading-breadcrumb" aria-label="当前展开路径"><span>学习主线</span>{path.map((c,i)=><span key={c.id}><ArrowRight size={12}/><button onClick={()=>onSelect(c.id)} disabled={busy||i===path.length-1}>{c.title}</button></span>)}</nav>
    {parent && <div className="return-context"><div><Layers size={16}/><span>正在补足「{parent.title}」中的一个黑箱，主线仍是「{root.title}」。</span></div><button onClick={()=>onSelect(parent.id)} disabled={busy}><ArrowLeft size={15}/>返回上层讲解</button></div>}
    <div className="reading-meta"><BookOpen size={14}/><span>约 {Math.max(1,Math.ceil(characters/450))} 分钟阅读</span>{terms.length>0&&<span>· 下划线术语可继续打开</span>}</div>
    {l && <section className="lesson-bridge"><h3>{parent ? '为什么从上层来到这里' : '接上前一步'}</h3>{text(l.bridge)}</section>}
    <section className="lesson-intuition"><h3>先把这件事想明白</h3>{text(concept.summary)}</section>
    {!l && <div className="lesson-upgrade"><p>这是旧版的简要讲解。可以补全推理步骤、衔接和可展开术语，原有笔记与答题记录会保留。</p><button onClick={onEnrich} disabled={busy||goal.status!=='active'}>补全讲解与术语<ArrowRight size={15}/></button></div>}
    {l && <div className="lesson-steps">{l.steps.map((s,i)=><section key={i}><div className="lesson-step-heading"><span>{String(i+1).padStart(2,'0')}</span><h3>{s.title}</h3></div>{text(s.text)}</section>)}</div>}
    <section className="worked-example"><span className="eyebrow">把过程走一遍</span><h3>用一个完整例子串起来</h3>{text(concept.example)}</section>
    {l && <><section className="lesson-boundary"><h3>这里容易混淆什么</h3>{text(l.boundary)}</section><section className="lesson-takeaway"><h3>把这一层装回整体</h3>{text(l.takeaway)}</section><section className="lesson-next"><h3>{parent?'读懂之后，回到原来的问题':'下一步怎样接上'}</h3>{text(l.next)}{parent&&<button className="primary" onClick={()=>onSelect(parent.id)} disabled={busy}><ArrowLeft size={15}/>回到「{parent.title}」</button>}</section></>}
    {terms.length>0&&<section className="term-directory"><h3>按需打开，不必一次学完</h3><p className="muted">如果某个词仍挡住理解，先看短解释，再决定是否深入。</p><div>{terms.map(t=><button key={t.id} onClick={()=>onTerm(t)}>{t.label}<ArrowRight size={14}/></button>)}</div></section>}
  </article>;
}
