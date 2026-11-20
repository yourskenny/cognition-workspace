from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator
import networkx as nx


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Question(StrictModel):
    prompt: str = Field(min_length=4, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=6)
    answer: int = Field(ge=0, le=5)
    explanation: str = Field(min_length=2, max_length=3000)

    @model_validator(mode='after')
    def valid_answer(self):
        if self.answer >= len(self.options):
            raise ValueError('题目答案超出选项范围')
        return self


class Term(StrictModel):
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,40}$')
    label: str = Field(min_length=1, max_length=60)
    preview: str = Field(min_length=8, max_length=1000)
    reason: str = Field(min_length=4, max_length=1000)


class LessonStep(StrictModel):
    title: str = Field(min_length=2, max_length=100)
    text: str = Field(min_length=12, max_length=5000)


class Lesson(StrictModel):
    bridge: str = Field(min_length=12, max_length=3000)
    steps: list[LessonStep] = Field(min_length=2, max_length=8)
    takeaway: str = Field(min_length=12, max_length=3000)
    boundary: str = Field(min_length=8, max_length=3000)
    next: str = Field(min_length=8, max_length=3000)


class Explanation(StrictModel):
    summary: str = Field(min_length=20, max_length=8000)
    example: str = Field(min_length=20, max_length=8000)
    lesson: Lesson
    terms: list[Term] = Field(default_factory=list, max_length=8)
    question: Question

    @model_validator(mode='after')
    def unique_terms(self):
        if len({t.id for t in self.terms}) != len(self.terms) or len({t.label for t in self.terms}) != len(self.terms):
            raise ValueError('术语 ID 和名称必须在当前讲解内唯一')
        return self


class Concept(StrictModel):
    id: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,64}$')
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=4, max_length=8000)
    example: str = Field(min_length=2, max_length=5000)
    why: str = Field(min_length=2, max_length=1000)
    stage: int = Field(ge=0, le=9)
    question: Question
    lesson: Lesson | None = None
    terms: list[Term] = Field(default_factory=list, max_length=8)

    @model_validator(mode='after')
    def unique_terms(self):
        if len({t.id for t in self.terms}) != len(self.terms) or len({t.label for t in self.terms}) != len(self.terms):
            raise ValueError('术语 ID 和名称必须在当前讲解内唯一')
        return self


class Relation(StrictModel):
    source: str
    target: str
    type: Literal['prerequisite', 'part_of', 'related', 'applies_to', 'explains'] = 'prerequisite'


class LearningPlan(StrictModel):
    title: str = Field(min_length=2, max_length=180)
    outcome: str = Field(min_length=4, max_length=1200)
    scope: str = Field(min_length=4, max_length=1600)
    stages: list[str] = Field(min_length=1, max_length=10)
    concepts: list[Concept] = Field(min_length=1, max_length=24)
    relations: list[Relation] = Field(max_length=100)

    @model_validator(mode='after')
    def valid_graph(self):
        ids = [c.id for c in self.concepts]
        if len(set(ids)) != len(ids):
            raise ValueError('概念 ID 不能重复')
        if any(c.stage >= len(self.stages) for c in self.concepts):
            raise ValueError('概念对应的阶段不存在')
        graph = nx.DiGraph()
        graph.add_nodes_from(ids)
        seen = set()
        for r in self.relations:
            if r.source not in ids or r.target not in ids:
                raise ValueError('关系引用了不存在的概念')
            if r.source == r.target:
                raise ValueError('关系不能连接概念自身')
            key = (r.source, r.target, r.type)
            if key in seen:
                raise ValueError('关系不能重复')
            seen.add(key)
            if r.type == 'prerequisite':
                graph.add_edge(r.source, r.target)
        if not nx.is_directed_acyclic_graph(graph):
            raise ValueError('本阶段先修关系存在循环，请重新拆分概念')
        return self


class Command(StrictModel):
    operation_id: str = Field(min_length=8, max_length=80)
    base_revision: int = Field(ge=0)
    action: Literal['create_goal', 'sample_goal', 'self_report', 'answer', 'note', 'layout', 'goal_status', 'restore', 'message', 'expand_concept', 'enrich_lesson', 'refresh_sample']
    payload: dict = Field(default_factory=dict)


class CredentialInput(StrictModel):
    api_key: str = Field(default='', max_length=512)
    model: str = Field(default='deepseek-flash', min_length=1, max_length=100, pattern=r'^[a-zA-Z0-9._:/-]+$')


class PlanValidation(StrictModel):
    plan: LearningPlan
