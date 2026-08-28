# Animal Bank V3｜Step 4–7 Engine Pipeline V1

## 1. 目的

本文件冻结 V3 P0 从 Verified Score 到可上课 Preparation 的核心业务链路。

```text
Verified Score
→ Material Matcher
→ Material Match Result
→ Song Learning Profile
→ Teacher Selection / Preparation
→ Lesson Recipe
→ Audio Requirement Plan
→ Audio Asset Manifest
→ Preparation Readiness Gate
→ READY
```

本链路中：

- Engine 负责确定规则与结构；
- Repository/API 负责保存和编排；
- Teacher UI 只展示教师任务语言；
- Classroom Runtime 只消费 READY Preparation，不重新分析歌曲。

---

## 2. Step 4｜Material Matcher

回答：**歌曲里客观出现了什么。**

输入：

- Verified Score
- Stage 1 Curriculum

输出：`Material Match Result`

包括：

- Rhythm PAT occurrences
- Melody Feature occurrences
- confirmed Short Phrase candidates
- usedDegrees
- pitchRange
- rest occurrences

P0 支持：

- PAT-01～PAT-08
- MEL-MAT-REPEAT-NOTE
- MEL-MAT-ASCENDING
- MEL-MAT-DESCENDING
- MEL-MAT-LEVEL（repeat-only subset）
- MEL-MAT-DMS
- MEL-MAT-SHORT-PHRASE

P0 不实现复杂旋律相似度：

- MEL-MAT-SIMILAR-PHRASE

休止是 Score Fact，不是假装成 Rhythm Material。

---

## 3. Step 5｜Song Learning Profile

回答：**对于第一学段，这首歌有哪些值得教师选择的学习内容。**

不是把所有 Match 都标记成 recommended。

Recommendation：

- `RECOMMENDED`
- `AVAILABLE`
- `SUPPORT_ONLY`
- `EXPERIENCE_ONLY`

### Rhythm

- core / progression Pattern 达到稳定出现阈值，可推荐；
- 默认推荐最多 3 个 Rhythm Material；
- PAT-08 属于体验扩展，不自动作为核心推荐；
- Rest / Meter 等事实可映射到 Curriculum Target，但不制造 Material。

### Melody

短旋律 Phrase 是主教学对象。

Repeat / Ascending / Descending / DMS 等是 Feature Support，不各自生成一套完整课。

短句排序可使用：

- vocal + lyrics
- 3–6 个音符
- 音域 <= 7 semitones
- 单小节优先

该分数用于候选排序，不代表教育效果评分。

### Solfege / Singing

Solfege 从 Verified Score 的 degree / octave 派生。

Singing 只有在已确认 vocal Phrase 且存在歌词时才提供歌曲绑定候选。

禁止根据谱面推断：

- 儿童实际音准
- 发声自然度
- 气息质量
- 情绪表现

---

## 4. Step 6｜Lesson Recipe

回答：**老师选择这些学习内容以后，这堂课怎么组织。**

输入：

- Preparation teacher selection
- Song Learning Profile
- Verified Score
- frozen Teaching Asset Library

规则：

- 教师选择 Rhythm Material / Phrase；
- 系统自动绑定 Teaching Asset；
- Melody Feature 自动叠加到目标 Phrase，不要求教师重复选择；
- Required Teaching Asset 无法解析 → `BLOCKED`；
- Optional Melody Feature Asset 缺失 → warning，不阻塞主 Phrase；
- Phrase binding 保留 rest timing；
- Integrated Lesson 自动绑定 Ensemble Asset。

固定课堂阶段：

1. EXPERIENCE_SONG
2. RHYTHM_LEARNING
3. MELODY_SINGING
4. GROUP_REHEARSAL
5. FINAL_ENSEMBLE

Recipe 状态：

- `READY_FOR_ASSETS`
- `BLOCKED`

人工确认状态独立：

- `NOT_REVIEWED`
- `REVIEWED`

不使用 `published` 作为教师备课状态。

---

## 5. Step 7｜Audio Requirement Plan

回答：**这份 Recipe 上课需要哪些音频。**

P0 Slot 类型：

- ORIGINAL_AUDIO
- RHYTHM_TRAINING
- REFERENCE_PITCH_OR_PIANO
- SOLFEGE_VOCAL
- MELODY_PRACTICE
- REFERENCE_VOCAL
- GROUP_REHEARSAL

`Audio Requirement Plan` 只定义需求，不代表音频已经生成。

生成型 Slot：

```text
fulfillment = GENERATE_OR_CACHE
requiresReview = true
```

课堂 Runtime 不实时等待生成式 AI。

---

## 6. Renderer Contract

Audio Planner 可以转成 provider-agnostic Render Request：

- RHYTHM_TRAINING_RENDER
- PITCH_RENDER
- SOLFEGE_VOCAL_RENDER
- MELODY_PRACTICE_RENDER
- REFERENCE_VOCAL_RENDER
- GROUP_REHEARSAL_MIX

当前 Contract 不指定厂商。

如果没有真实 Renderer：

- Audio Slot 保持 MISSING；
- 不允许制造 Fake READY。

---

## 7. Preparation Readiness Gate

教师不能手工把 Preparation 设置为 READY。

READY 必须同时满足：

1. Score verified
2. Material Match ready
3. Learning Profile ready
4. teacher selection valid
5. Lesson Recipe ready
6. required Teaching Assets resolved
7. Lesson Recipe 已由教师确认
8. Audio Plan ready
9. 所有 required audio READY
10. 所有需要审核的生成音频已 REVIEWED
11. Pipeline provenance fresh

Gate 输出：

```text
ready
DRAFT / READY
checks
blockers
warnings
```

---

## 8. Pipeline Freshness

所有下游结果必须明确来源于哪个上游版本。

```text
Verified Score
→ Material Match
→ Learning Profile
→ Lesson Recipe
→ Audio Plan
→ Audio Manifest
```

上游变化必须让下游失效。

例如：

### Verified Score 被重新编辑并验证

必须失效：

- Material Match
- Learning Profile
- Lesson Recipe
- Audio Plan
- Audio Manifest

### 教师修改 selectedMaterials / selectedPhrases

必须失效：

- Lesson Recipe
- Audio Plan
- Audio Manifest

### Recipe 被修改

必须失效：

- Audio Plan
- Audio Manifest

旧结果不能继续用于 READY Gate。

---

## 9. Teacher UI 翻译

内部：Material Match / Learning Profile / Lesson Recipe / Audio Assets

教师端：

```text
歌曲分析
→ 这首歌可以学什么
→ 选择本次学习内容
→ 课堂方案
→ 课堂素材
→ 准备完成
```

教师端不要展示 Engine 文件名、JSON 状态和 Publication Gate。

---

## 10. 当前完成边界

已完成：

- Step 4 pure Matcher Engine
- Step 5 pure Learning Profile Engine
- Step 6 pure Lesson Recipe Engine
- Step 7 Audio Requirement Planner
- Step 7 Render Request contract
- Step 7 Readiness Gate
- Pipeline Freshness rules
- JSON Schemas
- isolated unit tests

尚未完成：

- Repository persistence integration
- HTTP APIs
- automatic orchestration
- real Audio Renderer implementation
- Teacher UI data wiring
- real-song end-to-end regression
- full repository regression

这些属于下一次 Codex Batch Integration。
