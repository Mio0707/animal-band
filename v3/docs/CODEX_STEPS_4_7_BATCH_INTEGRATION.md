# Codex Task｜Animal Bank V3 Step 4–7 Batch Integration

## 0. 任务性质

不要重新设计 Step 4–7 算法。

仓库中已经存在并视为当前 Source of Truth 的纯 Engine：

```text
v3/core/material-matcher*.js
v3/core/rhythm-material-matcher.js
v3/core/melody-material-matcher.js
v3/core/learning-profile-config.js
v3/core/song-learning-profile.js
v3/core/lesson-teaching-asset-resolver.js
v3/core/lesson-recipe-generator.js
v3/core/audio-requirement-planner.js
v3/core/audio-render-request-builder.js
v3/core/pipeline-freshness.js
v3/core/preparation-readiness.js
```

以及对应 Schema / Tests。

你的任务是：

> 把这些 Engine 接入当前 Song / Preparation Persistence、Server API 与 Teacher Workflow，并用真实歌曲跑通。

不要把算法重新散写到 server.py、Repository 或页面里。

---

# 1. 先审计当前 main

先阅读：

```text
v3/docs/STEP4_7_ENGINE_PIPELINE_V1.md
v3/docs/MATERIAL_MATCHER_ENGINE_V1.md
v3/docs/CODEX_MATERIAL_MATCHER_INTEGRATION.md
```

同时检查最新：

```text
v3/server.py
v3/repositories/song_repository.py
v3/repositories/preparation_repository.py
v3/app/teacher/
v3/app/content-factory/
v3/data/songs/
v3/data/preparations/
```

如果 Step 3.6 Teacher Workflow 已经有新代码，必须保留，不要回退到 Content Factory-first。

---

# 2. 持久化结构

保持现有 Song / Preparation 业务对象。

建议生成物：

```text
v3/data/songs/<songId>/
├── song.json
├── verified-score.json
├── material-match.json
└── learning-profile.json
```

Preparation 当前基础对象如果仍是：

```text
v3/data/preparations/<preparationId>.json
```

继续保留。

生成物可以建立：

```text
v3/data/preparations/<preparationId>/
├── lesson-recipe.json
├── audio-plan.json
├── audio-manifest.json
└── readiness.json
```

不要为了生成物强行迁移现有 Preparation 基础 JSON。

---

# 3. Step 4 API｜Material Match

实现：

```text
POST /api/songs/:id/match
GET  /api/songs/:id/material-match
```

POST 流程：

```text
读取当前 verified-score.json
+ Stage 1 Curriculum
↓
调用 matchSongMaterials()
↓
Schema validate
↓
写 material-match.json
```

禁止：

- 非 verified Score 运行 Matcher
- 前端自己算 PAT
- server.py 重写匹配逻辑

---

# 4. Step 5 API｜Song Learning Profile

实现：

```text
POST /api/songs/:id/profile
GET  /api/songs/:id/profile
```

POST：

```text
verified-score.json
+ material-match.json
+ Stage 1 Curriculum
↓
generateSongLearningProfile()
↓
Schema validate
↓
learning-profile.json
```

Teacher UI 中翻译为：

> 这首歌可以学什么

显示：

- 推荐 Rhythm Material
- 可选 Rhythm Material
- 推荐短乐句
- Melody Feature 辅助信息
- Solfege / Singing 可学习目标

不要直接显示：

RECOMMENDED / SUPPORT_ONLY 等内部 enum 作为主要文案。

---

# 5. Teacher Selection

Teacher 从 Learning Profile 选择：

```text
selectedMaterials
selectedPhrases
selectedModules
```

写回现有 Preparation。

重要：

老师选择的是：

- Rhythm Material
- Melody / Singing Phrase

老师不需要手工重复选择：

- ASCENDING
- DESCENDING
- DMS
- REPEAT

这些 Feature 由 Recipe Generator 根据 Phrase 自动叠加。

---

# 6. Preparation 修改后的失效规则

如果：

```text
selectedMaterials
selectedPhrases
```

发生变化：

必须让：

```text
lesson-recipe
Audio Plan
Audio Manifest
readiness
```

失效。

Preparation 回到：

```text
DRAFT
```

不要继续使用旧 Recipe。

---

# 7. Step 6 API｜Lesson Recipe

实现：

```text
POST /api/preparations/:id/generate-recipe
GET  /api/preparations/:id/recipe
```

POST：

```text
Preparation
+ Learning Profile
+ Verified Score
+ Teaching Asset Library
↓
generateLessonRecipe()
↓
Schema validate
↓
lesson-recipe.json
```

如果：

```text
generationStatus = BLOCKED
```

必须真实显示阻塞原因。

不要 Fake Recipe READY。

---

# 8. Recipe Teacher Review

Recipe 生成后：

```text
reviewStatus = NOT_REVIEWED
```

Teacher UI：

> 课堂方案

老师查看课程流程后点击：

```text
确认课堂方案
```

实现明确 API，例如：

```text
PUT /api/preparations/:id/recipe/review
```

只允许：

```text
NOT_REVIEWED → REVIEWED
```

如果 Recipe 后续重生成，reviewStatus 必须重新回到：

```text
NOT_REVIEWED
```

---

# 9. Step 7 API｜Audio Requirement Plan

实现：

```text
POST /api/preparations/:id/audio-plan
GET  /api/preparations/:id/audio-plan
```

只有：

```text
Lesson Recipe = READY_FOR_ASSETS
```

才能生成。

调用：

```text
planAudioRequirements()
```

写：

```text
audio-plan.json
```

---

# 10. Audio Manifest

创建：

```text
audio-manifest.json
```

每个 Audio Plan slot 一条记录。

状态：

```text
MISSING
GENERATING
READY
STALE
FAILED
```

Review：

```text
NOT_REQUIRED
NOT_REVIEWED
REVIEWED
```

对于：

```text
ORIGINAL_AUDIO
```

如果 Song 已有真实文件，可直接：

```text
READY
NOT_REQUIRED
```

对于：

```text
GENERATE_OR_CACHE
```

初始必须：

```text
MISSING
NOT_REVIEWED
```

不要 Fake READY。

---

# 11. Audio Renderer 接口

使用：

```text
buildAudioRenderRequests(audioPlan)
```

得到：

```text
RHYTHM_TRAINING_RENDER
PITCH_RENDER
SOLFEGE_VOCAL_RENDER
MELODY_PRACTICE_RENDER
REFERENCE_VOCAL_RENDER
GROUP_REHEARSAL_MIX
```

本轮先审计当前仓库是否已有真正可复用音频生成能力。

如果有：

按 Renderer Contract 接入。

如果没有：

不要编造音频文件。

保留：

```text
MISSING
```

并在最终报告明确列出缺失 Renderer。

不得因为 Demo 需要就生成空 WAV / 假路径 / 假 READY。

---

# 12. Audio Review

如果真实音频已经成功生成：

先：

```text
status = READY
reviewStatus = NOT_REVIEWED
```

内部审核或 Teacher/Content Review 确认后：

```text
reviewStatus = REVIEWED
```

只有所有 Required Audio 都满足 Gate，Preparation 才可能 READY。

---

# 13. Preparation Readiness

实现：

```text
GET /api/preparations/:id/readiness
POST /api/preparations/:id/evaluate-readiness
```

或与现有 API 风格等价的接口。

必须调用：

```text
evaluatePreparationReadiness()
```

不能在 server.py 重新写另一套 READY 判断。

如果：

```text
result.ready = true
```

内部服务可以把：

```text
Preparation.status = READY
```

否则：

```text
Preparation.status = DRAFT
```

---

# 14. 禁止教师直接写 READY

检查当前：

```text
PUT /api/preparations/:id
```

普通 Teacher 请求不得直接设置：

```text
status = READY
```

建议：

- 普通 update API 不接受 `status`；
- READY 只能通过内部 Readiness Service 写入。

这是本轮硬性验收项。

---

# 15. Pipeline Freshness / Stale

使用：

```text
evaluatePipelineFreshness()
downstreamStagesToInvalidate()
```

### Verified Score 修改并重新 Verify

必须失效：

```text
Material Match
Learning Profile
Lesson Recipe
Audio Plan
Audio Manifest
Readiness
```

Preparation：

```text
DRAFT
```

### Material Match 重生成

失效：

```text
Learning Profile
Lesson Recipe
Audio Plan
Audio Manifest
```

### Learning Profile 重生成

失效：

```text
Lesson Recipe
Audio Plan
Audio Manifest
```

### Teacher Selection 变化

失效：

```text
Lesson Recipe
Audio Plan
Audio Manifest
```

### Lesson Recipe 变化

失效：

```text
Audio Plan
Audio Manifest
```

旧结果可以保留文件用于 Debug，但必须标记/判断为 STALE，不能进入 READY Gate。

---

# 16. Orchestration

不要让老师逐个点击内部 Engine 按钮。

Teacher Flow 应尽量表现为：

```text
乐谱确认
↓
系统分析歌曲
↓
这首歌可以学什么
↓
老师选择
↓
系统生成课堂方案
↓
老师确认
↓
系统准备课堂素材
↓
准备完成
```

内部 API 可以分阶段，但 Teacher UI 不展示技术流水线。

---

# 17. Teacher UI 接线

Teacher View：

### 选择学习内容

读取 Learning Profile。

重点呈现：

- 为什么推荐
- 在歌曲中出现多少次
- 推荐乐句的小节位置
- 教师可勾选 / 取消

### 课堂方案

读取 Lesson Recipe。

呈现：

```text
感受歌曲
学节奏
学旋律/歌唱
分组排练
最终合奏
```

显示 Teaching Asset 转译后的教师语言，不显示 TA ID 为主信息。

### 课堂素材

显示 Audio Manifest：

```text
已准备
正在生成
需要审核
缺失
```

不要展示 Renderer Contract 名称给教师。

### 准备完成

读取 Readiness Gate。

如果 blockers > 0：

显示缺什么。

如果 ready：

显示：

```text
课程已准备
开始上课
```

---

# 18. Internal Content Factory

Content Factory 可以显示完整技术信息：

- Match occurrences
- Profile JSON
- Recipe assets
- Audio slots
- stale status
- blockers

但不要让这些重新污染 Teacher IA。

---

# 19. Tests

先运行当前全部：

```text
npm test
```

新增 Integration Tests 至少包括：

1. Verified Score → Match 保存
2. Match → Profile 保存
3. Profile 推荐与 Match 事实分离
4. Teacher Selection → Recipe
5. Required Teaching Asset 缺失 → BLOCKED
6. Recipe Review
7. Recipe → Audio Plan
8. Audio Manifest 初始不是 Fake READY
9. 未审核音频 → Preparation DRAFT
10. 全部 Required Audio reviewed → Gate READY
11. Teacher 不能手工 status=READY
12. Verified Score 改动 → 下游 stale
13. Selection 改动 → Recipe/Audio stale
14. 刷新后所有生成物仍存在
15. preset / teacher_added 使用相同 Engine

---

# 20. 真实歌曲验证

至少选择当前仓库中一首真实 Verified Score 完整跑：

```text
Verified Score
→ Material Match
→ Learning Profile
→ Teacher Selection
→ Recipe
→ Audio Plan
→ Readiness
```

检查输出是否合理。

然后至少再跑 2 首真实歌曲验证：

- 不同歌曲得到不同 Match；
- 不同 Match 得到不同 Profile；
- Recipe 不依赖固定 songId；
- 不允许测试数据写死。

如果当前不足 3 首 Verified Score：

明确报告缺少真实验证样本，不得复制一首歌假装 3 首。

---

# 21. Audio 的真实边界

如果实际 Renderer 尚未实现，本轮最终闭环允许停在：

```text
Audio Plan generated
Audio Manifest MISSING
Preparation DRAFT
```

这是正确行为。

不要为了让 READY 通过而作弊。

等真实 Audio Renderer / 已审核预制音频接入后，再进入 READY。

---

# 22. 本轮不要做

不要：

- 重写 Curriculum
- 重写 Teaching Asset Library
- 重写 Material Matcher 算法
- 重写 Learning Profile 规则
- 重写 Lesson Recipe 规则
- 修改 PAT 定义
- 引入复杂旋律相似算法
- 实现 Classroom Runtime
- 做课程分享/发布社区
- 引入数据库迁移
- Fake audio
- Fake READY

---

# 23. 最终验收报告

完成后只输出：

1. 修改 / 新增文件
2. Step 4 API / persistence
3. Step 5 API / persistence
4. Step 6 API / persistence
5. Step 7 Audio Plan / Manifest
6. Audio Renderer 实际可用情况
7. Preparation READY Gate
8. Teacher 是否还能手工 READY（必须：不能）
9. Pipeline Freshness / invalidation
10. Teacher UI 如何接入
11. 真实歌曲闭环结果
12. 三首歌曲验证结果或样本不足说明
13. npm test：总数 / passed / failed
14. Step 1–3.6 regression
15. 是否存在 Fake Profile / Recipe / Audio / READY（必须：没有）
16. 当前剩余阻塞项
17. 是否具备进入 Classroom Runtime 的条件

完成后停止。
