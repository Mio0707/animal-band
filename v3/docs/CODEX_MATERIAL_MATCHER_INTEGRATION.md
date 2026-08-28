# Step 4 Material Matcher｜Codex 集成说明

本仓库已经包含 Material Matcher Engine V1：

```text
v3/core/material-matcher-config.js
v3/core/rhythm-material-matcher.js
v3/core/melody-material-matcher.js
v3/core/material-matcher.js
v3/schemas/material-match-result.schema.json
v3/tests/material-matcher.test.js
v3/docs/MATERIAL_MATCHER_ENGINE_V1.md
```

本阶段不要重新设计 Matcher。

## 集成原则

1. 不重新定义 PAT-01～PAT-08。
2. Rhythm Pattern 必须动态读取 `v3/data/curriculum/stage1.json`。
3. 不修改冻结的 Curriculum Source of Truth。
4. 不修改冻结的 Teaching Asset Source of Truth。
5. 不修改 Verified Score Schema，除非发现明确不兼容；如有冲突先报告。
6. 不把匹配逻辑写进 UI。
7. 不把匹配逻辑写进 `server.py` route handler。
8. Engine 保持 pure / deterministic。
9. 本阶段不实现 Song Learning Profile。
10. 本阶段不实现 Teaching Asset Resolver / Lesson Recipe。

## 需要完成的集成

### 1. Song Persistence

保存：

```text
v3/data/songs/<songId>/material-match.json
```

Song 增加独立状态：

```text
materialMatchStatus:
NOT_GENERATED
READY
STALE
```

不要用 `learningProfileStatus` 代替。

### 2. API

增加：

```text
POST /api/songs/:id/match
GET  /api/songs/:id/material-match
```

POST 流程：

```text
读取 Song
↓
读取 verified-score.json
↓
确认 verificationStatus = verified
↓
读取 stage1.json
↓
调用 matchSongMaterials()
↓
校验 material-match-result schema
↓
保存 material-match.json
↓
materialMatchStatus = READY
```

Route handler 不得自行实现 Pattern Matching。

### 3. Score 修改后的失效

当：

```text
SCORE_VERIFIED
→ edit
→ SCORE_REVIEWED
```

如果已有 Material Match：

```text
materialMatchStatus = STALE
```

重新 Verify 后不能自动恢复 READY，必须重新执行 Match。

### 4. Internal Content Factory

可以增加 Material Match Debug View，展示：

```text
materialId
occurrence count
measure range
noteId range
confidence
reviewRequired
```

Teacher View 当前不要直接展示 raw Material Match。

### 5. 测试

先运行：

```bash
cd v3
npm test
```

要求现有回归全部通过，并至少用一个仓库内真实 verified Song 跑一次：

```text
Verified Score
→ Material Matcher
→ material-match.json
```

完成后停止，不进入 Song Learning Profile。
