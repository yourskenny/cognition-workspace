"""Make an isolated v0.1-shaped workspace for the desktop migration check."""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from store import Store
from models import Command

store = Store(Path(sys.argv[1]) / 'workspace')
store.commit(Command(operation_id=uuid.uuid4().hex, base_revision=0, action='sample_goal'))
old = store.read()
goal = old['goals'][0]
goal.pop('content_version', None)
for c in goal['concepts']:
    c.pop('lesson', None)
    c.pop('terms', None)
goal['concepts'][2]['note'] = '旧版本保留的学习笔记'
store._write(old)
