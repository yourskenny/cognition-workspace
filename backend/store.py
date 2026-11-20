import copy
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import threading
from datetime import datetime, timezone
import uuid
from contextlib import closing
from models import Command, LearningPlan, Explanation
from sample import SAMPLE
from sample_lessons import sample_detail


def now():
    return datetime.now(timezone.utc).isoformat()


class Conflict(Exception):
    pass


class Store:
    """The atomic HEAD selects an immutable revision; SQLite is a disposable projection."""
    def __init__(self, root: Path):
        self.root = root
        self.revisions = root / 'revisions'
        self.revisions.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        if not (root / 'HEAD.json').exists():
            self._write({'revision': 0, 'revision_id': '', 'parent': None, 'time': now(), 'summary': '创建工作区', 'goals': [], 'operations': {}}, initial=True)
        try:
            self._index(self.read())
        except sqlite3.DatabaseError:
            index = self.root / 'index.sqlite'
            if index.exists():
                os.replace(index, self.root / ('index-damaged-' + uuid.uuid4().hex + '.sqlite'))
            self._index(self.read())

    def read(self):
        head = json.loads((self.root / 'HEAD.json').read_text('utf-8'))['revision_id']
        return self.read_revision(head)

    def read_revision(self, rev):
        if not isinstance(rev, str) or len(rev) != 32 or any(c not in '0123456789abcdef' for c in rev):
            raise ValueError('无效修订')
        return json.loads((self.revisions / rev / 'workspace.json').read_text('utf-8'))

    def _write_file(self, path, text):
        with path.open('w', encoding='utf-8', newline='\n') as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())

    def _write(self, state, initial=False):
        rev = uuid.uuid4().hex
        state['revision_id'] = rev
        pending = self.revisions / ('.pending-' + rev)
        pending.mkdir()
        self._write_file(pending / 'workspace.json', json.dumps(state, ensure_ascii=False, indent=2))
        self._write_file(pending / '学习记录.md', self.markdown(state))
        os.replace(pending, self.revisions / rev)
        # Until this replacement, readers still see the previous complete revision.
        pointer = self.root / ('.HEAD-' + rev)
        self._write_file(pointer, json.dumps({'revision_id': rev}))
        os.replace(pointer, self.root / 'HEAD.json')
        try:
            self._index(state)
        except sqlite3.Error:
            # The commit already succeeded; an index problem must not appear as a failed write.
            pass

    def _index(self, state):
        with closing(sqlite3.connect(self.root / 'index.sqlite')) as db, db:
            db.execute('CREATE TABLE IF NOT EXISTS concepts(id TEXT PRIMARY KEY, goal_id TEXT, title TEXT, summary TEXT)')
            db.execute('DELETE FROM concepts')
            for goal in state['goals']:
                db.executemany('INSERT INTO concepts VALUES (?,?,?,?)', [(goal['id'] + ':' + c['id'], goal['id'], c['title'], c['summary']) for c in goal['concepts']])

    @staticmethod
    def status(concept):
        evidence = concept.get('evidence', [])
        attempts = [e for e in evidence if e['type'] == 'quiz']
        if attempts:
            return 'verified' if attempts[-1]['passed'] else 'review'
        if any(e['type'] == 'self_report' and e['understood'] for e in evidence):
            return 'self_reported'
        if evidence:
            return 'learning'
        return 'unverified'

    def public(self, state=None):
        state = copy.deepcopy(state or self.read())
        state.pop('operations', None)
        for goal in state['goals']:
            for c in goal['concepts']:
                c['content_token'] = self.content_fingerprint(c)
                c['status'] = self.status(c)
                c['question'].pop('answer', None)
                c['question'].pop('explanation', None)
            roots = [c for c in goal['concepts'] if not c.get('parent_id')]
            goal['verified_count'] = sum(c['status'] == 'verified' for c in roots)
            goal['required_count'] = len(roots)
        return state

    def commit(self, command: Command):
        with self.lock:
            state = self.read()
            fingerprint = hashlib.sha256(json.dumps({'action': command.action, 'payload': command.payload}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            previous = state['operations'].get(command.operation_id)
            if previous:
                if previous != fingerprint:
                    raise Conflict('相同操作 ID 被用于不同修改')
                return self.public(state)
            if state['revision'] != command.base_revision:
                raise Conflict('工作区已更新。已保留你的输入，请刷新后重试。')
            parent = state['revision_id']
            payload = command.payload
            action = command.action
            if action in ('create_goal', 'sample_goal'):
                plan = LearningPlan.model_validate(SAMPLE if action == 'sample_goal' else payload.get('plan')).model_dump()
                goal = {'id': uuid.uuid4().hex, **plan, 'origin': 'sample' if action == 'sample_goal' else 'ai', 'created_at': now(), 'status': 'active', 'messages': [], 'content_version': 2 if action == 'sample_goal' else 1}
                for i, concept in enumerate(goal['concepts']):
                    concept.update({'evidence': [], 'note': '', 'position': {'x': (i - (len(goal['concepts']) - 1) / 2) * 100, 'y': (i % 2 - 0.5) * 100, 'z': (i % 3 - 1) * 65}})
                state['goals'].append(goal)
                summary = '建立目标：' + goal['title']
            elif action == 'restore':
                target = payload.get('revision_id')
                # Restore only committed ancestors; orphan directories are never admissible.
                ancestors = {x['revision_id'] for x in self.history()}
                if target not in ancestors:
                    raise ValueError('只能恢复已提交历史版本')
                old = self.read_revision(target)
                state['goals'] = old['goals']
                summary = '恢复版本 ' + str(old['revision'])
            else:
                goal = next((g for g in state['goals'] if g['id'] == payload.get('goal_id')), None)
                if goal is None:
                    raise ValueError('目标不存在')
                concept = next((c for c in goal['concepts'] if c['id'] == payload.get('concept_id')), None)
                if action in ('self_report', 'answer', 'note', 'layout', 'expand_concept', 'enrich_lesson') and concept is None:
                    raise ValueError('概念不存在')
                if goal['status'] != 'active' and action in ('self_report', 'answer', 'message', 'expand_concept', 'enrich_lesson', 'refresh_sample'):
                    raise ValueError('请先继续当前目标')
                if action == 'refresh_sample':
                    if goal['origin'] != 'sample':
                        raise ValueError('仅能更新离线示例')
                    for c in goal['concepts']:
                        edited = next((x for x in SAMPLE['concepts'] if x['id'] == c['id']), None)
                        if edited and not c.get('parent_id'):
                            for field in ('summary', 'example', 'lesson', 'terms', 'why'):
                                c[field] = copy.deepcopy(edited[field])
                            c['content_origin'] = 'sample'
                    goal['content_version'] = 2
                    summary = '更新示例讲解，保留原学习记录'
                elif action in ('expand_concept', 'enrich_lesson'):
                    if payload.get('expected_content') and payload['expected_content'] != self.content_fingerprint(concept):
                        raise Conflict('当前讲解已变化，旧解释未写入，请重试')
                    term = None
                    if action == 'expand_concept':
                        term = next((t for t in concept.get('terms', []) if t['id'] == payload.get('term_id')), None)
                        if not term:
                            raise ValueError('当前讲解中没有这个术语')
                        existing = next((c for c in goal['concepts'] if c.get('parent_id') == concept['id'] and c.get('entry_term_id') == term['id']), None)
                        if existing:
                            return self.public(state)
                        if len(goal['concepts']) >= 500:
                            raise ValueError('当前目标已包含 500 个概念，请整理后再展开')
                    source = 'ai'
                    raw = payload.get('explanation')
                    if raw is None and term and goal['origin'] == 'sample':
                        raw = sample_detail(term['id'])
                        source = 'sample'
                    explanation = Explanation.model_validate(raw).model_dump()
                    if action == 'enrich_lesson':
                        # Existing quiz evidence remains tied to the original question.
                        concept.update({k: explanation[k] for k in ('summary', 'example', 'lesson', 'terms')})
                        concept['content_origin'] = source
                        summary = '补全讲解：' + concept['title']
                    else:
                        cid = 'detail_' + hashlib.sha256((concept['id'] + ':' + term['id']).encode()).hexdigest()[:24]
                        siblings = sum(c.get('parent_id') == concept['id'] for c in goal['concepts'])
                        child = {'id': cid, 'title': term['label'], 'why': term['reason'], 'stage': concept['stage'], **explanation,
                                 'parent_id': concept['id'], 'entry_term_id': term['id'], 'content_origin': source,
                                 'position': {'x': concept['position']['x'] + 90 * (siblings + 1), 'y': concept['position']['y'] - 140, 'z': concept['position']['z'] + 45},
                                 'evidence': [], 'note': ''}
                        goal['concepts'].append(child)
                        goal['relations'].append({'source': cid, 'target': concept['id'], 'type': 'explains'})
                        summary = '打开黑箱：' + concept['title'] + ' → ' + term['label']
                elif action == 'self_report':
                    text = str(payload.get('text', '')).strip()
                    if not text or len(text) > 4000:
                        raise ValueError('请填写 1–4000 字的学习反馈')
                    understood = payload.get('understood')
                    if type(understood) is not bool:
                        raise ValueError('请选择是否已理解')
                    concept['evidence'].append({'id': uuid.uuid4().hex, 'type': 'self_report', 'time': now(), 'text': text, 'understood': understood})
                    summary = '记录学习反馈：' + concept['title']
                elif action == 'answer':
                    if not any(e['type'] == 'self_report' and e['understood'] for e in concept['evidence']):
                        raise ValueError('请先完成学习时的理解确认')
                    choice = payload.get('choice')
                    if type(choice) is not int or choice < 0 or choice >= len(concept['question']['options']):
                        raise ValueError('请选择有效答案')
                    q = concept['question']
                    concept['evidence'].append({'id': uuid.uuid4().hex, 'type': 'quiz', 'time': now(), 'question': q['prompt'], 'choice': choice, 'answer_text': q['options'][choice], 'passed': choice == q['answer'], 'feedback': q['explanation'], 'grading': 'answer_key', 'question_origin': goal['origin']})
                    summary = '记录课后验证：' + concept['title']
                elif action == 'note':
                    note = str(payload.get('text', ''))
                    if len(note) > 20000:
                        raise ValueError('笔记过长')
                    concept['note'] = note
                    summary = '保存笔记：' + concept['title']
                elif action == 'layout':
                    position = payload.get('position', {})
                    if set(position) != {'x', 'y', 'z'} or any(type(v) not in (float, int) or not math.isfinite(v) or abs(v) > 10000 for v in position.values()):
                        raise ValueError('位置数据无效')
                    concept['position'] = position
                    summary = '调整视图：' + concept['title']
                elif action == 'goal_status':
                    value = payload.get('status')
                    if value not in ('active', 'paused', 'completed'):
                        raise ValueError('无效目标状态')
                    if value == 'completed' and not all(self.status(c) == 'verified' for c in goal['concepts'] if not c.get('parent_id')):
                        raise ValueError('请先完成各概念的课后验证')
                    goal['status'] = value
                    summary = {'active': '继续目标', 'paused': '暂停目标', 'completed': '用户确认目标完成'}[value]
                elif action == 'message':
                    question, answer = str(payload.get('question', '')).strip(), str(payload.get('answer', '')).strip()
                    if not question or not answer or len(question) > 10000 or len(answer) > 30000:
                        raise ValueError('问答内容长度无效')
                    if payload.get('concept_id') and concept is None:
                        raise ValueError('问答概念不存在')
                    goal['messages'].append({'id': uuid.uuid4().hex, 'concept_id': payload.get('concept_id'), 'question': question, 'answer': answer, 'time': now(), 'origin': 'ai'})
                    summary = '保存目标内问答'
            state['revision'] += 1
            state.update({'parent': parent, 'summary': summary, 'time': now()})
            state['operations'][command.operation_id] = fingerprint
            self._write(state)
            return self.public(state)

    @staticmethod
    def content_fingerprint(concept):
        fields = {k: concept.get(k) for k in ('title', 'summary', 'example', 'lesson', 'terms', 'parent_id')}
        return hashlib.sha256(json.dumps(fields, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def history(self):
        state = self.read()
        result = []
        while True:
            result.append({k: state[k] for k in ('revision', 'revision_id', 'time', 'summary')})
            if not state['parent']:
                return result
            state = self.read_revision(state['parent'])

    def markdown(self, state=None):
        state = state or self.read()
        lines = ['# 认知工作区', '', f"修订：{state['revision']} · {state['time']}", '']
        for g in state['goals']:
            lines += [f"## {g['title']}", '', f"目标 ID：{g['id']}", f"来源：{'离线示例' if g['origin'] == 'sample' else 'AI 草案，未经信源核验'}", '', '完成依据：' + g['outcome'], '', '范围：' + g['scope'], '']
            for c in g['concepts']:
                lines += [f"### {c['title']}", '', f"概念 ID：{c['id']}", '', c['summary'], '', '**例子**', '', c['example']]
                if c.get('parent_id'):
                    lines += ['', '展开自：' + c['parent_id'] + '（补充解释，不增加必学主线）']
                if c.get('lesson'):
                    l = c['lesson']
                    lines += ['', '**衔接**', '', l['bridge']]
                    for step in l['steps']:
                        lines += ['', '#### ' + step['title'], '', step['text']]
                    lines += ['', '**带回整体**', '', l['takeaway'], '', '**适用边界**', '', l['boundary'], '', '**下一步**', '', l['next']]
                for t in c.get('terms', []):
                    lines += ['', f"- 术语 {t['label']}：{t['preview']}；为什么需要：{t['reason']}"]
                lines += ['', '**我的笔记**', '', c['note'] or '尚无笔记', '', '**学习证据**', '']
                for e in c['evidence']:
                    lines.append(f"- {e['time']} · " + (('自述理解' if e['understood'] else '仍有疑问') + '：' + e['text'] if e['type'] == 'self_report' else ('本题通过' if e['passed'] else '本题待巩固') + '：' + e['question'] + '；回答：' + e['answer_text'] + '；反馈：' + e['feedback']))
                lines += ['']
            lines += ['### 关系', ''] + [f"- {r['source']} → {r['target']} ({r['type']})" for r in g['relations']] + ['']
            for m in g['messages']:
                lines += ['### 目标内问答', '', '**问：**' + m['question'], '', m['answer'], '']
        return '\n'.join(lines)
