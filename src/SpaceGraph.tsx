import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { Concept, Goal } from './types';
export default function SpaceGraph({ goal, selected, onSelect, onMove, disabled }: { goal: Goal; selected: string; onSelect: (id: string) => void; onMove: (id: string, position: Concept['position']) => void; disabled: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<any>(undefined);
  const [size, setSize] = useState({ width: 500, height: 430 });
  const objects = useRef<Group[]>([]);
  useEffect(() => { const el = container.current!; const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight })); observer.observe(el); return () => observer.disconnect(); }, []);
  const data = useMemo(() => ({ nodes: goal.concepts.map(c => ({ id: c.id, title: c.title, status: c.status, x: c.position.x, y: c.position.y, z: c.position.z, fx: c.position.x, fy: c.position.y, fz: c.position.z })), links: goal.relations.map(r => ({ source: r.source, target: r.target, type:r.type })) }), [goal.concepts, goal.relations]);
  useEffect(() => { const timer = setTimeout(() => {
    if (!graph.current) return;
    const xs = goal.concepts.map(c => c.position.x), ys = goal.concepts.map(c => c.position.y), zs = goal.concepts.map(c => c.position.z);
    const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    const scale = Math.max(0.1, Math.min((size.width - 100) / (Math.max(...xs) - Math.min(...xs) + 100), (size.height - 80) / (Math.max(...ys) - Math.min(...ys) + 80)));
    const distance = size.height / (2 * Math.tan(graph.current.camera().fov * Math.PI / 360) * scale) + (Math.max(...zs) - Math.min(...zs)) / 2;
    graph.current.cameraPosition({ ...center, z: center.z + distance }, center, 300);
  }, 100); return () => clearTimeout(timer); }, [goal.id, goal.concepts.length, size.width, size.height]);
  useEffect(() => () => { for (const group of objects.current) group.traverse((obj: any) => { obj.geometry?.dispose(); if (obj.material) { obj.material.map?.dispose(); obj.material.dispose(); } }); objects.current = []; }, [data, selected]);
  return <div className="space-graph" ref={container}><ForceGraph3D ref={graph} graphData={data} width={size.width} height={size.height} backgroundColor="#f3f6f0" showNavInfo={false} cooldownTicks={0} enableNodeDrag={!disabled} nodeLabel={() => ''} linkColor={(link:any) => link.type === 'explains' ? '#b39974' : '#a6b8aa'} linkWidth={1} linkDirectionalArrowLength={4} linkDirectionalArrowRelPos={0.75}
    nodeThreeObject={(node: any) => { const group = new Group(); const active = node.id === selected; group.add(new Mesh(new SphereGeometry(active ? 8 : 6, 20, 16), new MeshBasicMaterial({ color: active ? '#205c4c' : node.status === 'verified' ? '#78a888' : '#b2c6b5' }))); const label = new SpriteText(node.title); label.fontFace = 'Microsoft YaHei, sans-serif'; label.color = active ? '#183e34' : '#465f51'; label.textHeight = 14; label.position.y = -21; group.add(label); objects.current.push(group); return group; }}
    onNodeClick={(node: any) => onSelect(node.id)} onNodeDragEnd={(node: any) => { node.fx = node.x; node.fy = node.y; node.fz = node.z; onMove(node.id, { x: node.x, y: node.y, z: node.z }); }} /></div>;
}
