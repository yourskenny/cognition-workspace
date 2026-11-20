export type Status = 'unverified' | 'learning' | 'self_reported' | 'verified' | 'review';
export interface Evidence { id: string; type: 'self_report' | 'quiz'; time: string; text?: string; understood?: boolean; passed?: boolean; question?: string; answer_text?: string; feedback?: string }
export interface Term { id: string; label: string; preview: string; reason: string }
export interface Lesson { bridge: string; steps: {title:string;text:string}[]; takeaway:string; boundary:string; next:string }
export interface Concept { id: string; title: string; summary: string; example: string; why: string; stage: number; question: { prompt: string; options: string[]; answer?: number; explanation?: string }; position: { x: number; y: number; z: number }; evidence: Evidence[]; note: string; status: Status; lesson?:Lesson|null; terms?:Term[]; parent_id?:string; entry_term_id?:string; content_origin?:'sample'|'ai'; content_token?:string }
export interface Plan { title: string; outcome: string; scope: string; stages: string[]; concepts: Concept[]; relations: { source: string; target: string; type: string }[] }
export interface Goal extends Plan { id: string; origin: 'sample' | 'ai'; status: 'active' | 'paused' | 'completed'; verified_count: number; required_count?:number; content_version?:number; created_at: string; messages: { id: string; concept_id: string; question: string; answer: string; time: string }[] }
export interface Workspace { revision: number; revision_id: string; goals: Goal[]; summary: string; time: string }
export interface Settings { provider: string; model: string; configured: boolean }
export interface Revision { revision: number; revision_id: string; time: string; summary: string }
export interface AgentResult { plan?: Plan; text?: string; state?: Workspace; usage?: { input: number; output: number } }
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export interface DesktopAPI {
  load(): Promise<Result<Workspace>>;
  command(command: { operation_id: string; base_revision: number; action: string; payload: Record<string, unknown> }): Promise<Result<Workspace>>;
  history(): Promise<Result<Revision[]>>;
  settings(): Promise<Result<Settings>>;
  saveSettings(data: { api_key: string; model: string }): Promise<Result<Settings>>;
  deleteKey(): Promise<Result<Settings>>;
  runAgent(data: { kind: 'plan' | 'ask' | 'expand' | 'lesson'; input: string; goalId?: string; conceptId?: string; termId?:string }): Promise<Result<AgentResult>>;
  cancelAgent(): Promise<Result<boolean>>;
  exportNotes(): Promise<Result<string | null>>;
  openData(): Promise<Result<string>>;
  onAgentEvent(callback: (event: { type: string; text: string }) => void): () => void;
}
declare global { interface Window { cognition: DesktopAPI } }
export const statusText: Record<Status, string> = { unverified: '未验证', learning: '学习中', self_reported: '已自述 · 待验证', verified: '本题已验证', review: '待巩固' };
