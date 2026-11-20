import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Move, RotateCcw, Waypoints } from 'lucide-react';
import type { Concept, Goal } from './types';
const Space = lazy(() => import('./SpaceGraph'));
type Props = { goal: Goal; selected: string; onSelect: (id: string) => void; onMove: (id: string, position: Concept['position']) => void; disabled: boolean };

class GraphBoundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function Graph({ goal, selected, onSelect, onMove, disabled }: Props) {
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [cameraKey, setCameraKey] = useState(0);
  const [positions, setPositions] = useState<Record<string, Concept['position']>>({});
  const svg = useRef<SVGSVGElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(()=>{list.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[selected,goal.concepts.length]);
  const drag = useRef<{ id: string; startX: number; startY: number; original: Concept['position']; moved: boolean } | null>(null);
  useEffect(() => setPositions({}), [goal.id]);
  useEffect(() => setPositions(Object.fromEntries(goal.concepts.map(c => [c.id, c.position]))), [goal.concepts]);
  const points = useMemo(() => goal.concepts.map(c => ({ ...c, position: positions[c.id] || c.position })), [goal.concepts, positions]);
  const extentX = Math.max(270, ...points.map(c => Math.abs(c.position.x) + 80));
  const extentY = Math.max(110, ...points.map(c => Math.abs(c.position.y) + 70));
  const point = (e: React.PointerEvent) => {
    const p = svg.current!.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  const move = (e: React.PointerEvent<SVGGElement>, concept: Concept) => {
    if (!drag.current || disabled) return;
    const p = point(e), d = drag.current;
    if (Math.hypot(p.x - d.startX, p.y - d.startY) > 3) d.moved = true;
    if (d.moved) setPositions(previous => ({ ...previous, [concept.id]: { x: Math.max(-2000, Math.min(2000, d.original.x + p.x - d.startX)), y: Math.max(-2000, Math.min(2000, d.original.y + p.y - d.startY)), z: d.original.z } }));
  };
  const selectedConcept = goal.concepts.find(c => c.id === selected);
  const fallback = <div className="graph-fallback">3D 视图暂不可用。<button onClick={() => setMode('2d')}>使用平面关系</button></div>;
  return <section className="network" aria-label="目标认识网络">
    <div className="network-head"><div><span className="eyebrow">目标认识网络</span><h2>看见知识之间的联系</h2></div><div className="segmented"><button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}><Box size={15} />空间</button><button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}><Waypoints size={15} />平面</button></div></div>
    <div className="graph-surface" data-testid="graph-surface">
      <div className="graph-legend"><span><i className="dot verified" />本题已验证</span><span><i className="dot pending" />待验证</span></div>
      <button className="icon-button camera-reset" aria-label="重置视角" onClick={() => setCameraKey(k => k + 1)}><RotateCcw size={17} /></button>
      {mode === '3d' ? <GraphBoundary key={cameraKey} fallback={fallback}><Suspense fallback={<div className="graph-fallback">正在准备空间视图…</div>}><Space goal={goal} selected={selected} onSelect={onSelect} onMove={onMove} disabled={disabled} /></Suspense></GraphBoundary> : <svg ref={svg} viewBox={`${-extentX} ${-extentY} ${extentX * 2} ${extentY * 2}`} className="flat-graph" role="img" aria-label="可选择和拖动的概念关系图">
        <defs><marker id="arrowhead" markerWidth="7" markerHeight="7" refX="21" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#9caea5" /></marker></defs>
        {goal.relations.map((r, i) => { const a = points.find(c => c.id === r.source), b = points.find(c => c.id === r.target); return a && b ? <line key={i} x1={a.position.x} y1={a.position.y} x2={b.position.x} y2={b.position.y} stroke={r.type === 'explains' ? '#b39974' : '#bac9c0'} strokeDasharray={r.type === 'explains' ? '5 4' : undefined} strokeWidth="1.5" markerEnd="url(#arrowhead)" /> : null; })}
        {points.map(c => <g key={c.id} transform={`translate(${c.position.x},${c.position.y})`} className={`graph-node ${c.id === selected ? 'selected' : ''}`} onPointerDown={e => { if (disabled) return; const p = point(e); drag.current = { id: c.id, startX: p.x, startY: p.y, original: c.position, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => move(e, c)} onPointerUp={() => { const d = drag.current; drag.current = null; if (d?.moved) onMove(c.id, positions[c.id]); else onSelect(c.id); }} onPointerCancel={() => { drag.current = null; }}>
          <circle r={c.id === selected ? 16 : 11} fill={c.id === selected ? '#205c4c' : c.status === 'verified' ? '#78a888' : '#f9fbf7'} stroke={c.id === selected ? '#205c4c' : '#8fa99a'} strokeWidth="2" />
          <text y="37" textAnchor="middle">{c.title.length > 12 ? c.title.slice(0, 11) + '…' : c.title}</text>
        </g>)}
      </svg>}
      <div className="graph-hint"><Move size={13} />{mode === '3d' ? '拖动空白旋转 · 滚轮缩放 · 点选概念' : '拖动节点调整位置 · 点选进入学习'}</div>
    </div>
    <div className="selected-context"><span className="eyebrow">为什么学这个</span><p>{selectedConcept?.why}</p></div>
    <div className="concept-strip" ref={list} aria-label="选择概念">{goal.concepts.map((c, i) => <button key={c.id} aria-pressed={c.id === selected} disabled={disabled} onClick={() => onSelect(c.id)}><span>{c.parent_id ? '↳' : String(i + 1).padStart(2, '0')}</span>{c.title}{c.status === 'verified' && <i className="dot verified" />}</button>)}</div>
  </section>;
}
