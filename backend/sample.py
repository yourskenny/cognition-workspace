"""Offline editorial example, visibly distinguished from generated learning plans."""
SAMPLE = {
    'title': '理解注意力如何给输入分配权重',
    'outcome': '能计算一个简单的匹配分数，解释分数怎样变成权重，并完成每个概念的应用题。',
    'scope': '聚焦点积、归一化与加权求和的直觉和小型数值例子；暂不展开训练、反向传播与多头注意力。',
    'stages': ['理解匹配', '分配权重', '组合信息'],
    'concepts': [
        {'id': 'vector', 'title': '向量表示', 'stage': 0, 'why': '先把输入表示成数值，才能计算输入与问题的匹配程度。',
         'summary': '向量可以理解为一组按顺序排列的数。在我们的例子里，只使用两个数来描述一个输入。\n\n向量各维度的含义依赖具体表示方法；真实模型中的向量通常不能逐维直接解释成日常属性。',
         'example': '把一个查询表示为 q = (1, 0)，两个候选输入表示为 A = (2, 0)、B = (0, 3)。接下来比较 q 与 A、B。',
         'question': {'prompt': '在这个二维表示中，向量 (2, 3) 有多少个分量？', 'options': ['1 个', '2 个', '5 个'], 'answer': 1, 'explanation': '分量是按顺序排列的 2 和 3，共两个；分量之和不是维数。'}},
        {'id': 'dot', 'title': '点积相似度', 'stage': 0, 'why': '注意力需要一个可计算的匹配分数。点积是常见的一种打分方式。',
         'summary': '两个向量的点积，是对应分量相乘后相加。\n\n点积同时受方向与向量长度影响，不能无条件把它等同于归一化的语义相似度。这里把它用作匹配分数，分数还不是最终权重。',
         'example': 'q = (1, 0) 时：q·A = 1×2 + 0×0 = 2；q·B = 1×0 + 0×3 = 0。',
         'question': {'prompt': '换成 q = (0, 1)，A = (2, 0)，B = (0, 3)。哪个输入的点积分数更高？', 'options': ['A', 'B', '一样高'], 'answer': 1, 'explanation': 'q·A = 0，q·B = 3，因此 B 的分数更高。注意这里还没有计算最终注意力权重。'}},
        {'id': 'softmax', 'title': '从分数到权重', 'stage': 1, 'why': '将任意匹配分数转换为可比较的一组正权重。',
         'summary': 'Softmax 对每个分数取指数，再除以所有指数值之和。因此得到的权重均为正，且和为 1。\n\n在缩放点积注意力中，点积分数通常还会先除以键向量维数的平方根。本目标暂用已经得到的分数解释归一化。',
         'example': '两个分数相等时，它们的指数也相等，因此各自获得 0.5 的权重。',
         'question': {'prompt': '两个未遮蔽的输入分数都是 0。经过 Softmax 后，权重是多少？', 'options': ['0 和 0', '1 和 1', '0.5 和 0.5'], 'answer': 2, 'explanation': 'e⁰ = 1，分母为 1 + 1，因此每项都是 1/2。'}},
        {'id': 'weighted_sum', 'title': '加权组合', 'stage': 2, 'why': '将权重转换成实际的信息汇总结果。',
         'summary': '注意力用得到的权重，对各输入对应的 value 向量加权求和。\n\n打分使用 query 与 key，组合使用 value；它们承担不同角色。得到一个权重并不意味着原始输入被永久删除。',
         'example': '为便于手算，用标量 value：v₁ = 10、v₂ = 20，权重分别为 0.25、0.75。输出是 0.25×10 + 0.75×20 = 17.5。',
         'question': {'prompt': 'v₁ = 4、v₂ = 8，权重为 0.5、0.5。加权组合是多少？', 'options': ['6', '12', '4'], 'answer': 0, 'explanation': '0.5×4 + 0.5×8 = 2 + 4 = 6。'}},
        {'id': 'attention', 'title': '回到注意力', 'stage': 2, 'why': '将各个步骤联系起来，回答最初的学习目标。',
         'summary': '一个简化的注意力过程是：用 query 与各 key 计算分数，将分数归一化为权重，再对 value 加权组合。\n\n不同 query 可以产生不同权重，因此同一组输入可以围绕不同问题得到不同的信息汇总。',
         'example': '读一句话时，关注“谁做了这件事”和关注“在哪里发生”，需要提取的信息不同。这个类比帮助理解作用，但不意味着模型在逐字执行人的阅读过程。',
         'question': {'prompt': '注意力中，哪一组角色对应正确？', 'options': ['query/key 用于匹配，value 用于组合', 'value 只用于决定向量维数', '所有输入始终使用相同权重'], 'answer': 0, 'explanation': 'query 与 key 产生匹配分数，经过归一化后用权重组合 value。'}}
    ],
    'relations': [
        {'source': 'vector', 'target': 'dot', 'type': 'prerequisite'},
        {'source': 'dot', 'target': 'softmax', 'type': 'prerequisite'},
        {'source': 'softmax', 'target': 'weighted_sum', 'type': 'prerequisite'},
        {'source': 'weighted_sum', 'target': 'attention', 'type': 'prerequisite'}
    ]
}

from sample_lessons import enrich_sample
SAMPLE = enrich_sample(SAMPLE)
