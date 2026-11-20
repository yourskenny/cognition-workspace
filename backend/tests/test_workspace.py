import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from models import Command, LearningPlan
from store import Store, Conflict
from sample import SAMPLE
from main import create_app


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / 'workspace')

    def tearDown(self):
        self.tmp.cleanup()

    def command(self, action, payload=None, operation_id=None, revision=None):
        return Command(action=action, payload=payload or {}, operation_id=operation_id or str(uuid.uuid4()), base_revision=self.store.read()['revision'] if revision is None else revision)

    def sample(self):
        return self.store.commit(self.command('sample_goal'))['goals'][0]

    def test_self_report_and_assessment_are_separate_and_survive_restart(self):
        goal = self.sample()
        p = {'goal_id': goal['id'], 'concept_id': 'vector'}
        with self.assertRaises(ValueError):
            self.store.commit(self.command('answer', {**p, 'choice': 1}))
        state = self.store.commit(self.command('self_report', {**p, 'text': '向量是一组有顺序的数', 'understood': True}))
        self.assertEqual(state['goals'][0]['concepts'][0]['status'], 'self_reported')
        wrong = self.store.commit(self.command('answer', {**p, 'choice': 0}))
        self.assertEqual(wrong['goals'][0]['concepts'][0]['status'], 'review')
        right = self.store.commit(self.command('answer', {**p, 'choice': 1}))
        concept = right['goals'][0]['concepts'][0]
        self.assertEqual(concept['status'], 'verified')
        self.assertEqual(len(concept['evidence']), 3)
        self.assertNotIn('answer', concept['question'])
        self.assertNotEqual(right['goals'][0]['status'], 'completed')
        reopened = Store(self.store.root).public()
        self.assertEqual(reopened, right)

    def test_conflict_and_idempotence(self):
        command = self.command('sample_goal')
        first = self.store.commit(command)
        again = self.store.commit(command)
        self.assertEqual(first['revision'], again['revision'])
        self.assertEqual(len(again['goals']), 1)
        with self.assertRaises(Conflict):
            self.store.commit(self.command('sample_goal', revision=0))
        with self.assertRaises(Conflict):
            self.store.commit(self.command('create_goal', {'plan': SAMPLE}, operation_id=command.operation_id))

    def test_layout_does_not_change_relations_and_restore_is_new_revision(self):
        goal = self.sample()
        old = self.store.read()
        state = self.store.commit(self.command('layout', {'goal_id': goal['id'], 'concept_id': 'vector', 'position': {'x': 12, 'y': 35, 'z': 9}}))
        self.assertEqual(state['goals'][0]['relations'], goal['relations'])
        restored = self.store.commit(self.command('restore', {'revision_id': old['revision_id']}))
        self.assertEqual(restored['goals'][0]['concepts'][0]['position'], goal['concepts'][0]['position'])
        self.assertGreater(restored['revision'], state['revision'])
        self.assertEqual(len(self.store.history()), 4)

    def test_partial_revision_cannot_change_head(self):
        before = self.store.read()
        original = self.store._write_file
        def fail_head(path, text):
            if path.name.startswith('.HEAD-'):
                raise OSError('simulated crash before commit pointer')
            original(path, text)
        with patch.object(self.store, '_write_file', side_effect=fail_head):
            with self.assertRaises(OSError):
                self.store.commit(self.command('sample_goal'))
        self.assertEqual(Store(self.store.root).read(), before)
        with self.assertRaises(ValueError):
            self.store.commit(self.command('restore', {'revision_id': 'f' * 32}))

    def test_invalid_graph_and_nonfinite_position_rejected(self):
        bad = copy.deepcopy(SAMPLE)
        bad['relations'].append({'source': 'attention', 'target': 'vector', 'type': 'prerequisite'})
        with self.assertRaises(ValueError): LearningPlan.model_validate(bad)
        bad = copy.deepcopy(SAMPLE)
        bad['concepts'][0]['id'] = '../escape'
        with self.assertRaises(ValueError): LearningPlan.model_validate(bad)
        goal = self.sample()
        with self.assertRaises(ValueError):
            self.store.commit(self.command('layout', {'goal_id': goal['id'], 'concept_id': 'vector', 'position': {'x': float('nan'), 'y': 0, 'z': 0}}))

    def test_index_is_rebuildable_and_contains_no_credentials(self):
        self.sample()
        before = self.store.public()
        (self.store.root / 'index.sqlite').unlink()
        self.assertEqual(Store(self.store.root).public(), before)
        self.assertNotIn('api_key', json.dumps(self.store.read()))
        self.assertIn('学习证据', self.store.markdown())
        (self.store.root / 'index.sqlite').write_bytes(b'broken index')
        self.assertEqual(Store(self.store.root).public(), before)
        self.assertEqual(len(list(self.store.root.glob('index-damaged-*.sqlite'))), 1)

    def test_api_rejects_unauthorized_requests(self):
        client = TestClient(create_app(Path(self.tmp.name) / 'api', 'test-token'))
        self.assertEqual(client.get('/workspace').status_code, 401)
        r = client.get('/workspace', headers={'Authorization': 'Bearer test-token'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['revision'], 0)

    def test_recursive_expansion_keeps_mainline_and_persists(self):
        goal = self.sample()
        original_relations = copy.deepcopy(goal['relations'])
        first = self.store.commit(self.command('expand_concept', {'goal_id': goal['id'], 'concept_id': 'softmax', 'term_id': 'exponent'}))
        g = first['goals'][0]
        exponent = next(c for c in g['concepts'] if c.get('entry_term_id') == 'exponent')
        self.assertEqual(exponent['parent_id'], 'softmax')
        self.assertEqual(g['required_count'], 5)
        self.assertEqual(g['verified_count'], 0)
        self.assertEqual(g['relations'][:len(original_relations)], original_relations)
        self.assertNotIn('answer', exponent['question'])
        second = self.store.commit(self.command('expand_concept', {'goal_id': goal['id'], 'concept_id': exponent['id'], 'term_id': 'power'}))
        power = next(c for c in second['goals'][0]['concepts'] if c.get('entry_term_id') == 'power')
        self.assertEqual(power['parent_id'], exponent['id'])
        cached = self.store.commit(self.command('expand_concept', {'goal_id': goal['id'], 'concept_id': 'softmax', 'term_id': 'exponent'}))
        self.assertEqual(cached['revision'], second['revision'])
        self.assertEqual(len(cached['goals'][0]['concepts']), 7)
        self.assertEqual(Store(self.store.root).public(), cached)
        self.assertIn('展开自：', self.store.markdown())
        with self.assertRaises(ValueError):
            self.store.commit(self.command('expand_concept', {'goal_id': goal['id'], 'concept_id': 'softmax', 'term_id': 'not_a_term'}))

    def test_supplemental_nodes_do_not_block_goal_completion(self):
        g = self.sample()
        self.store.commit(self.command('expand_concept', {'goal_id': g['id'], 'concept_id': 'softmax', 'term_id': 'exponent'}))
        for c in SAMPLE['concepts']:
            self.store.commit(self.command('self_report', {'goal_id':g['id'],'concept_id':c['id'],'text':'我能解释这个步骤','understood':True}))
            self.store.commit(self.command('answer', {'goal_id':g['id'],'concept_id':c['id'],'choice':c['question']['answer']}))
        result = self.store.commit(self.command('goal_status', {'goal_id':g['id'],'status':'completed'}))
        self.assertEqual(result['goals'][0]['verified_count'], 5)
        self.assertEqual(result['goals'][0]['status'], 'completed')
        self.assertEqual(result['goals'][0]['concepts'][-1]['status'], 'unverified')

    def test_enrichment_preserves_evidence_and_rejects_stale_content(self):
        from sample_lessons import sample_detail
        g = self.sample()
        self.store.commit(self.command('note', {'goal_id':g['id'],'concept_id':'softmax','text':'需要保留的笔记'}))
        self.store.commit(self.command('self_report', {'goal_id':g['id'],'concept_id':'softmax','text':'理解了','understood':True}))
        old = next(c for c in self.store.public()['goals'][0]['concepts'] if c['id']=='softmax')
        new = self.store.commit(self.command('enrich_lesson', {'goal_id':g['id'],'concept_id':'softmax','expected_content':old['content_token'],'explanation':sample_detail('normalize')}))
        c = next(c for c in new['goals'][0]['concepts'] if c['id']=='softmax')
        self.assertEqual(c['note'], old['note'])
        self.assertEqual(c['evidence'], old['evidence'])
        self.assertEqual(c['question'], old['question'])
        with self.assertRaises(Conflict):
            self.store.commit(self.command('enrich_lesson', {'goal_id':g['id'],'concept_id':'softmax','expected_content':old['content_token'],'explanation':sample_detail('exponent')}))
        refreshed = self.store.commit(self.command('refresh_sample', {'goal_id':g['id']}))
        c = next(c for c in refreshed['goals'][0]['concepts'] if c['id']=='softmax')
        self.assertEqual(c['note'], old['note'])
        self.assertEqual(c['evidence'], old['evidence'])

    def test_editorial_sample_all_expansions_have_valid_lessons(self):
        from sample_lessons import DETAILS
        from models import Explanation
        for name, detail in DETAILS.items():
            self.assertTrue(Explanation.model_validate(detail).lesson.steps, name)
            for term in detail['terms']:
                self.assertIn(term['id'], DETAILS)


if __name__ == '__main__':
    unittest.main()
