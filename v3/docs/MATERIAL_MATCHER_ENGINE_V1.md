# Animal Bank V3｜Material Matcher Engine V1.0

## 1. 定位

Material Matcher 只回答：

> Verified Score 中客观出现了哪些 Stage 1 可机器识别的音乐材料，它们出现在哪里？

它**不回答**：

> 老师最终应该教什么？

后者属于下一层 Song Learning Profile。

因此固定链路为：

```text
Verified Score
+
Stage 1 Curriculum Library
↓
Material Matcher
↓
Material Match Result
↓
Song Learning Profile
↓
教师看到“这首歌可以学什么”
```

---

## 2. Source of Truth

Engine 不维护第二份课程常量。

### Rhythm

直接读取：

```text
curriculum.modules.rhythm.material_catalog
```

PAT-01～PAT-08 的 `durations` 是匹配依据。

### Melody

直接读取：

```text
curriculum.modules.melody.machine_materials
```

V1 实现：

- MEL-MAT-REPEAT-NOTE
- MEL-MAT-ASCENDING
- MEL-MAT-DESCENDING
- MEL-MAT-LEVEL（P0 只覆盖纯重复音子集）
- MEL-MAT-DMS
- MEL-MAT-SHORT-PHRASE

暂不实现：

- MEL-MAT-SIMILAR-PHRASE

---

## 3. 输入要求

默认只接受：

```text
verificationStatus = verified
```

原因：Matcher 必须建立在人工确认后的音乐事实之上。

使用现有 Verified Score 字段：

```text
measure.number
note.noteId
note.degree
note.octave
note.midiNumber
note.duration
note.beat
note.rest
note.phraseId
phrase.startNoteId
phrase.endNoteId
phrase.contour
phrase.reviewStatus
```

无需修改 Verified Score Schema。

---

## 4. Rhythm Matcher V1

### 判定原则

每个小节内部扫描连续音符窗口。

必须同时满足：

1. 不包含 rest；
2. 音符在时间上连续；
3. duration sequence 与 Curriculum Pattern 完全一致；
4. 使用 tolerance 解决浮点误差。

例如：

```text
[0.5, 0.5, 1]
↓
PAT-03
```

Pattern 定义永远来自 Curriculum，不在 Engine 内重复硬编码。

### REST

`RHY-12-REST-01` 是 Curriculum Target，不是 Rhythm Material。

因此 Engine **不得**生成假 Material：

```text
RHY-12-REST-01
```

休止位置输出到：

```text
facts.restOccurrences
```

由 Learning Profile 后续决定是否形成休止教学推荐。

---

## 5. Melody Matcher V1

Curriculum 已经定义机器边界，但 ASC/DESC/SHORT-PHRASE 的 P0 阈值属于实现层配置。

V1 将阈值集中放在：

```text
core/material-matcher-config.js
```

而不是写回 Curriculum Source of Truth。

### 5.1 REPEAT NOTE

规则：

```text
连续 >= 2 个非休止音
midiNumber 完全相同
```

输出最大连续重复段。

### 5.2 LEVEL

Curriculum 明确：P0 可只识别纯重复音。

因此 V1：

```text
MEL-MAT-LEVEL
=
REPEAT-NOTE 的确定性子集
```

标记：

```text
p0SubsetOnly: true
```

复杂“平稳感”不自动判断。

### 5.3 ASCENDING

V1 默认：

```text
最少音符数 = 3
相邻音高必须非下降
至少有一次真实升高
单次相邻跳进 <= 5 semitones
```

允许：

```text
C C D E
C D E
C E G
```

不允许：

```text
C E D F
```

当前采用保守、可解释的 P0 规则，优先减少误报。

### 5.4 DESCENDING

与 ASCENDING 对称：

```text
最少音符数 = 3
相邻音高必须非上升
至少有一次真实下降
单次相邻跳进 <= 5 semitones
```

### 5.5 DMS

只对 `reviewStatus = confirmed` 的 Phrase 判断。

默认：

```text
3–8 个非休止音
所有 degree ∈ {1,3,5}
至少出现 2 个不同 degree
```

输出：

```text
reviewRequired = true
```

原因：机器能确定“只使用 do-mi-sol”，但是否值得作为本次教学内容应由后续 Profile 决定。

### 5.6 SHORT PHRASE

只接受 Human Review 已确认 Phrase。

V1 默认候选阈值：

```text
2–8 个非休止音
<= 2 个小节
pitchRange <= 9 semitones
reviewStatus = confirmed
```

输出：

```text
phraseId
startMeasure
endMeasure
pitchRangeSemitones
noteCount
contour
degrees
reviewRequired = true
```

这些参数是 **P0 实现默认值**，不是改写 Curriculum。

后续可用真实歌曲回归结果调整 config。

---

## 6. 输出结构

核心调用：

```js
matchSongMaterials(verifiedScore, curriculum)
```

返回：

```json
{
  "schemaVersion": "1.0.0",
  "algorithmVersion": "1.0.0",
  "songId": "...",
  "stageId": "stage_1",
  "sourceScoreStatus": "verified",
  "facts": {},
  "materials": {
    "rhythm": [],
    "melody": []
  },
  "summary": {}
}
```

每个 Material：

```json
{
  "materialId": "PAT-03",
  "module": "rhythm",
  "matchType": "deterministic",
  "confidence": 1,
  "reviewRequired": false,
  "occurrences": []
}
```

Occurrence 必须可追溯到 Score：

```text
measureStart
measureEnd
startNoteId
endNoteId
noteIds
```

这样 Teacher UI 后续可以高亮“这段为什么被推荐”。

---

## 7. Engine 与 Learning Profile 的边界

禁止 Material Matcher 做：

```text
推荐度排序
“适合老师教”判断
Teaching Asset 选择
Lesson Recipe 生成
课堂时长判断
孩子能力判断
歌曲情绪判断
唱得准不准判断
```

Matcher 只负责：

```text
存在性
位置
结构事实
```

例如：

```text
Matcher:
歌曲出现 PAT-03 共 6 次

≠

Profile:
本课推荐教 PAT-03
```

这是必须长期保持的边界。

---

## 8. 推荐持久化位置

Engine 本身不写文件。

Codex 集成层负责保存：

```text
v3/data/songs/<songId>/material-match.json
```

建议 API：

```text
POST /api/songs/:id/match
GET  /api/songs/:id/material-match
```

流程：

```text
读取 verified-score.json
↓
读取 stage1.json
↓
matchSongMaterials()
↓
保存 material-match.json
↓
返回结果
```

---

## 9. 失效规则

如果 Verified Score 被重新编辑并从 verified 降级：

旧的 Material Match 必须视为 stale。

推荐 Song 内记录：

```text
materialMatchStatus:
NOT_GENERATED
READY
STALE
```

重新 Verify 后必须重新跑 Matcher。

不要继续使用基于旧 Score 的匹配结果。

---

## 10. V1 不做

本 Engine 不实现：

- Similar Phrase 相似度算法
- 音频信号分析
- 情绪分析
- 音色分析
- 歌唱准确度判断
- Teaching Asset Resolver
- Learning Profile
- Lesson Recipe
- AI 推荐

---

## 11. 验收标准

必须证明：

1. PAT 定义来自真实 Curriculum；
2. Verified Score 非 verified 时默认拒绝；
3. PAT-01～PAT-08 均可匹配；
4. REST 不伪装成 Material；
5. Repeat / Ascending / Descending 可确定性回归；
6. DMS 只使用 1/3/5；
7. Short Phrase 只读取 confirmed Phrase；
8. Similar Phrase 明确标记为 P0 unsupported；
9. 所有 occurrence 能追溯到 noteId；
10. Matcher 输出不能直接等同于教学推荐。
