# 产品型 Agent 架构补充 v0.3

日期：2026-11-18。状态：官方文档核对与工程判断；未安装、未运行、未做完整源码审计。新候选及架构调整均待讨论确认。

后续确认：用户表示“好，这一块我也认可了”，认可本轮候选比较与集成方向。具体运行时尚未选定，验证尚未执行；正文保留提出建议时的表述供追溯。

## 为什么重新扩展候选

用户指出 DSH、Hermes、Pi 及其衍生方案没有被纳入比较。上一轮偏向 Python 通用框架，从低层 LangGraph 转到 Harness 后仍停留在原有生态，提前推荐 Deep Agents 的依据不充分。本轮撤销这一优先排序，将可嵌入运行时、插件平台和完整助手产品同时纳入。

用户随后明确回复“DeepSeek Harness”，确认 DSH 指该项目；以下分析对应已核对的 DeepSeek 官方仓库。

## 三个主候选

### Pi：可嵌入的 Agent 会话与工具运行时

官方仓库原 `badlogic/pi-mono` 当前重定向至 `earendil-works/pi`。必须按选定版本检查包名，不能照搬旧教程。

Pi 提供 TypeScript SDK，可控制会话、工具和资源加载；支持持久会话、分支、压缩、事件订阅、运行中追加指示及取消。这与自有桌面画布接入 Agent 的需要相关。CLI/TUI 是现成入口，不限制我们采用图形界面。正式知识状态仍由领域后端管理，不使用会话树充当认识网络。

主线采用最小可扩展设计，并不默认包含所有规划和子 Agent 产品行为。若采用，应复用 SDK 已有会话能力，再配置必要扩展；不要只拿低层循环后自行重写整套会话管理。

新 `pi-durable` 独立文档涉及持久任务，但明确标为 Experimental，API 可能无通知变化。不能把它与会话 SDK 的稳定性混为一谈，也不能从“保存会话”推导出任意工具中断都可安全恢复。

判断：进入主候选。重点验证自有工具替换、GUI 事件对接、取消、后台任务持久化以及升级兼容性。默认进程权限不是受控知识写入边界，应用应只暴露必要工具。

依据：[仓库](https://github.com/earendil-works/pi)、[SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[pi-durable](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)。

### DSH：以插件组合应用

DeepSeek Harness 基于 Cordis，模型适配、工具、会话日志和 Agent 循环均可通过插件组合。提供 SDK/headless 等组合入口，官方也有 Electron 桌面实现。其配置分层和插件生命周期值得用于我们后续扩展信源与研究能力。

产品映射建议：把来源适配、研究策略、上下文供应和图修改工具做成开发者维护的能力模块，用户只操作学习任务。插件不是让用户自己组装系统，也不表示第一版需要建设插件市场。

官方 README 仍声明开发预览和破坏性兼容变更。当前架构说明中，Python SDK 启动打包的 DSH runtime，不能理解为纯 Python 核心；TypeScript SDK 的启动路径也有统一 profile 约束。采用前应验证正式集成入口，不绕开生命周期私自拼装内部模块。

判断：进入主候选。优先核对扩展成本、最小 profile、稳定版本和离线打包；“一切插件”增加组合自由，也要求管理依赖及插件版本。

依据：[仓库与预览状态](https://github.com/deepseek-ai/deepseek-harness)、[架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)、[官方产品页](https://www.deepseek.com/harness/en/)。

### Hermes：完整个人 Agent 与长期连续性

Hermes 已有统一 Agent 核心、压缩、工具、SQLite 会话、记忆、技能与调度等模块。官方程序化接入包括 ACP、Gateway JSON-RPC 和 HTTP/SSE，可供自定义界面驱动，不能因其是完整产品而排除。

最相关的方向是长期连续性：偏好与项目记忆、跨会话检索、按需技能。对学习产品应明确区分三类数据：用户偏好、Agent 的执行经验、带学习证据的掌握状态。前两者可借鉴其机制，第三者仍需领域模型，不能让模型自写 memory 替代。

判断：进入主候选，同时作为长期记忆与技能体系的重要参考。需验证裁剪不需要的工具与入口、替换知识写入工具、会话控制协议和后台任务恢复。不能把文档中的所有 Gateway 方法视为每种传输或版本都支持，也不假定已有完整助手必然比 SDK 更难维护；应比较真实集成成本。

依据：[架构](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)、[程序化接入](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration)、[记忆](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)、[技能](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)。

## 衍生与其他产品

| 项目 | 与本产品的关系 | 当前处理 |
|---|---|---|
| Oh My Pi | 官方声明源自 Pi，强化编码工具、结构化子任务和运行中干预；代码执行/编辑反馈的设计可参考。 | 比较完整衍生产品额外带来的收益与依赖，不能认为功能更多就更适合认知产品。LSP/DAP 等编码能力并非第一版核心。 |
| OpenClaw | 可参考常驻运行时、事件入口和插件边界。 | 当前官方架构明确内置运行时由自身模块维护，不再依赖外部 Agent 框架包，仍有 Pi TUI 依赖。按独立系统评估，不使用“现在只是 Pi 包装”的描述。 |
| OpenCode | 当前官方提供终端、桌面与 Web 入口，以及插件/模型配置。适合参考产品交付与扩展体验。 | 本轮发现旧 `/docs/server/` 跳至 V1 文档；不得把 V1 的 HTTP/SDK 契约直接当成当前版本保证。当前嵌入契约待专门验证。 |
| Deep Agents / Pydantic AI Harness | 仍是合理 SDK 对照，上一轮调研继续保留。 | 不因新名单而判定它们过时；也不在缺少同任务验证时保留默认第一名。 |

依据：[Oh My Pi](https://github.com/can1357/oh-my-pi)、[OpenClaw 当前运行时](https://docs.openclaw.ai/agent-runtime-architecture)、[OpenCode 当前文档](https://opencode.ai/docs/)、[OpenCode V1 Server](https://opencode.ai/v1/docs/server/)。

## 对本产品架构的影响

重新讨论的重点是可嵌入会话运行时、事件驱动任务、按需技能与可替换能力模块。受控图修改、证据管理与学习语义仍属于应用领域服务。

Python + FastAPI 的认可不要求 Agent 也必须用 Python。可选的集成形态为：Electron / React 界面 → 独立 Agent 进程（Pi / DSH 的 TypeScript 或 Hermes 的 Python）→ 受控领域 API → Python 的图计算和资料处理。Agent 不放到渲染进程，不堵塞桌面主进程。若选 TypeScript 会增加一层运行时通信与打包成本，需要和复用收益一起评估。

这只是新集成形态的提案；没有擅自撤销用户已认可的 Python 后端，也没有决定改为全 TypeScript。

不把三个主候选拼成三重主循环。最终选一个运行时，借鉴其他项目的设计。受益于插件和 SDK 的地方直接复用；跨框架接口、知识版本和证据规则由产品明确。

建议按两条路径对照：Pi/DSH 的嵌入与定制，Hermes 的完整助手裁剪与接入。验证均使用同一个任务：圈选概念 → 提出学习目标 → 后台免费取材 → 用户中途补充要求并拖动关系 → Agent 提交带证据的修改 → 退出重开恢复。比较需要自写代码、必须改 fork 的范围、恢复与去重、首响应与资源开销、模型兼容及版本升级成本。没有实测前不再给出武断的最终名次。
