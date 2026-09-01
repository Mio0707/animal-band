# Animal Bank V3｜Current Architecture Source of Truth

> 状态：Batch 8N｜Measure Preview Fix + Prototype Sticker Stage + Four-Stem Arrangement
> 适用：V3 P0 第一学段（1–2 年级）决赛 Demo
> 原则：正式产品只保留当前模型，不再维护 Phrase、旧 Classroom、旧 8/16 格 Sticker Step Sequencer 等历史路径。

---

## 1. 产品结构

Animal Bank 共用一套歌曲教学数据和 Activity Runtime，前端分成两个 Surface：

```text
Teacher App
→ 歌曲 / 简谱确认
→ 选择课堂活动
→ 自动生成课堂方案
→ 资源准备 / Readiness
→ 开始上课

Classroom App
→ 课堂首页
→ Activity Router
→ 学生活动
```

课堂活动固定为六个：

1. `listen`｜听一听，动一动
2. `melody_trace`｜画旋律
3. `rhythm_learning`｜学节奏
4. `singing`｜学演唱
5. `ensemble`｜合奏
6. `sticker_arrangement`｜动物贴纸创作

---

## 2. 备课流程

### Step 1｜简谱确认

Qwen 只识别客观乐谱事实：BPM、拍号、调性、小节、音高、时值、歌词与音符对应。

Qwen 不生成：

```text
phrases[]
phraseId
乐句边界
演唱分段决定
```

老师在简谱确认页人工选择：

```text
演唱教学分段：每 N 小节一段
```

未选择时不能完成简谱验证。系统只机械执行老师的选择。

同一页面同时完成原曲小节时间核对：

```text
上传 MP3
→ 波形图
→ 标记第 1 小节 Anchor
→ BPM 预测后续小节
→ 必要时增加 Anchor 校正
→ 按教学段试听核对
```

教学段试听必须使用真实区间：

```text
startSec = startMeasure 的时间
endSec   = 下一教学段起点 / 对应结束小节之后的边界

seek(startSec)
→ 等待 seeked
→ play
→ 到 endSec 自动暂停
```

波形同步高亮当前试听区间；切换试听会停止上一段。

### Step 2｜选择课堂活动

Teacher UI 只保留六个 Activity 勾选。这里不出现 Pattern、乐句、演唱分段、合奏角色、贴纸音轨配置等技术选项。

正式 Preparation 主数据：

```json
{
  "preparationId": "prep_xxx",
  "songId": "song_xxx",
  "selectedActivities": [
    "listen",
    "melody_trace",
    "rhythm_learning",
    "singing",
    "ensemble",
    "sticker_arrangement"
  ]
}
```

`selectedActivities` 顺序就是课堂顺序。

### Step 3｜自动生成课堂方案

系统自动生成 Lesson Recipe：

- 学节奏：从 Song Learning Profile 自动选择推荐 Pattern。
- 学演唱：按 Verified Score 中老师确认的 `singingMeasuresPerUnit` 生成 Teaching Units。
- 合奏：固定 A 唱 / B 身体节奏 / C 旋律手势，复用同一 Teaching Units 与推荐节奏材料。
- 动物贴纸创作：只声明整首歌曲的小节数、四条固定 Stem 与 `next_measure_first_beat` 切换规则。

### Step 4｜资源准备 / Readiness

Dynamic Readiness 只检查本节课真实选择的 Activity。未选择 Activity 不得阻塞 READY。

---

## 3. Verified Score

Verified Score 是歌曲教学数据的事实来源：

```text
songId / title
key / tonic / mode
meter / bpm
lyricsText
measures[]
  notes[]
    degree / octave
    duration / beat
    absolutePitch / midiNumber / frequency
    solfege / lyric
teachingConfig.singingMeasuresPerUnit
verificationStatus
```

正式 Score 不再有 `phrases[]` 或 `phraseId`。

---

## 4. Singing Teaching Units

Teaching Unit 是教学层数据，不是乐谱事实。

例如老师选择“每 2 小节一段”，36 小节机械生成：

```text
1–2
3–4
...
35–36
```

同一组 Teaching Units 供 `singing` 与 `ensemble` 使用。

---

## 5. 学演唱

学生端固定三种播放模式：

```text
钢琴｜真人唱名｜原曲
```

- 钢琴：Verified Score → 浏览器实时音高播放。
- 真人唱名：Verified Score + Katy / digifishmusic 唱名单音 → 浏览器实时匹配。
- 原曲：用户上传 MP3 + Measure Alignment → 只播放当前 Teaching Unit 对应区间。

不再为每个教学段生成 Reference Pitch / Solfege Vocal / Practice Backing / Reference Vocal WAV。

---

## 6. Measure Alignment

正式数据只保存小节 Anchor：

```json
{
  "songId": "song_xxx",
  "anchors": [
    { "measure": 1, "startSec": 3.82 },
    { "measure": 9, "startSec": 19.67 }
  ]
}
```

所有教学段的 `startSec / endSec` 都由 Verified Score + Anchor 动态计算，不重复保存，避免数据分叉。

波形只作为人工核对辅助，不做“低波形 = 没有人声”等自动判断。

---

## 7. 听一听，动一动

Listening Warmup 不依赖独立 librosa / numpy / soundfile requirements。

```text
Verified Score
→ BPM / meter / measures / note density
→ low-density Listening Body Plan
→ Classroom Runtime
```

学生端读取真实 MP3 时长后缩放动作时间线。动作图片必须与动作语义一致；连续动作由 Runtime 重新触发视觉反馈。

---

## 8. 画旋律

正式 Artifact：`melody-trace-plan.json`。

Runtime 使用 `audio.currentTime` 作为唯一时间源，根据 segment 切换 Gesture。Gesture ID 与 Asset 必须存在于统一 Gesture Library。

---

## 9. 学节奏

固定路径：

```text
唱出来
→ 身体打出来
→ 游戏里认出来并做出来
```

Body Demo 按每一个 Rhythm Event 重新触发动作动画：例如连续 `CLAP, CLAP` 必须明确视觉动作两次。

Pattern 是通用节奏定义；身体动作属于歌曲级 Teaching Application。Rhythm Jump 一格 = 一拍。

---

## 10. 合奏

固定三组：

```text
A = 唱
B = 身体节奏
C = 旋律手势
```

Runtime：

```text
READY
→ SINGING_GROUP
→ RHYTHM_GROUP
→ GESTURE_GROUP
→ TOGETHER
→ ENDING
```

旋律手势不新增独立音频 Stem。

---

## 11. 动物贴纸创作｜正式四 Stem 架构

旧的 8/16 格 Beat Step Sequencer 已删除。

四个角色固定：

```text
🐶 dog  = drums      鼓组
🐻 bear = keyboard   键盘和声
🐱 cat  = bass       贝斯
🦁 lion = alto_sax   萨克斯主旋律
```

### 11.1 内容生产

贴纸活动只有在教师选择该 Activity 时才需要四条 Stem。

```text
Verified Score
→ 一份共享 Arrangement Plan
→ 本地 deterministic compiler
→ 4 Track JSON
→ 4 MIDI
→ FluidSynth + MuseScore_General.sf3
→ 4 WAV
→ preview-mix.wav
→ STICKER_STEMS_READY
```

Qwen 只规划一份共享 Arrangement Plan：和声与每小节声部职责。绝不分别自由生成四首互不关联的音乐。

本地编译器负责保证：

```text
相同 BPM
相同拍号
相同小节边界
统一和声骨架
统一总时长
```

萨克斯主旋律直接以 Verified Score 主旋律为核心，不允许 AI 另写一首新旋律。

Qwen 不可用时允许 `score_derived_fallback`，并在 Artifact 中明确记录 fallback；不会伪装成 AI 成功结果。

FluidSynth 渲染后会把四条 WAV trim / pad 到完全一致的音乐时长，消除不同乐器 release tail 导致的 Stem 长度漂移，然后生成四轨混合 QA 试听。

### 11.2 学生端｜Prototype 动物贴纸舞台

保留 Prototype 的核心“动物舞台”体验与四个 performer 素材入口，但移除制作软件复杂度。课堂优先读取本地缓存的 Prototype performer 图片；若本地未缓存则尝试公开 Prototype 地址，最终以 emoji 作为安全降级。离线演示前可运行 `python3 scripts/cache_prototype_sticker_assets.py` 缓存四张舞台角色图。

学生只看到：

```text
四个动物乐手
当前小节
播放 / 暂停
点击动物加入 / 休息
动物乐队一起上
听听我的版本 / 再编一次
```

不显示 Mixer、Mute、Solo、Gain、Piano Roll、Beat Grid、音符编辑或 MIDI 参数。

四条 Stem 始终在同一个 AudioContext 时间线上同步运行，通过独立 Gain 控制听见/静音状态。

### 11.3 小节级 Quantized Switching

贴纸编排严格以“小节”为单位。

孩子在任意时刻点击某个动物：

```text
点击
→ UI 立即显示“准备加入 / 准备休息”
→ 等当前小节结束
→ 下一小节第 1 拍
→ Gain ON / OFF 生效
```

Arrangement 只记录实际生效的小节：

```json
{
  "events": [
    { "measure": 3, "trackId": "bear", "state": "on" },
    { "measure": 7, "trackId": "cat", "state": "off" }
  ]
}
```

创作结束后系统显示简单的小节级结果矩阵，并可按照保存的 events 自动重放“我的版本”。

原始上传 MP3 不与四条 Stem 叠加播放，避免原曲内已有乐器掩盖孩子的加入 / 退出效果。

---

## 12. Activity Router / Recipe

正式 Classroom 只按 `activity.type`：

```text
listen
melody_trace
rhythm_learning
singing
ensemble
sticker_arrangement
```

旧 `phase/module` fallback 已删除。

Lesson Recipe 当前 `schemaVersion = 4.0.0`，生成算法为 4.2.x 系列；Sticker binding 是小节级四轨定义，不再包含 beat grid。

---

## 13. Audio Plan

普通教学正式音频槽位只保留真正需要的离线文件：

```text
ORIGINAL_AUDIO
RHYTHM_TRAINING
```

合奏不生成角色组或合并版音频。演唱、身体节奏、旋律手势与合作演奏全部按 `lessonSegmentId` 关联，并通过 `Measure Alignment` 播放教师上传原曲的对应小节时间窗。

Sticker Stems 是歌曲级 Artifact，由 `sticker-stems.json` 管理，不混入旧的逐段 Singing Audio Plan。

---

## 14. 当前删除的旧路径

不应重新引入：

```text
Phrase Alignment Page / API / Schema
phrases[] / phraseId 正式路径
旧 Singing Phrase Runtime
旧 phase/module Router
requirements-listening-warmup.txt
旧 8/16 格 Sticker Step Sequencer
stickerGridFromScore
旧 preparation sticker-arrangement/render 接口
旧单作品 sticker_arrangement_renderer.py
```

---

## 15. 当前 Demo 边界

本版本不包含：

```text
摄像头动作识别
麦克风 / 音准 / 节奏实时评分
学生账号 / 班级 / 排行
自动乐句识别
自动人声检测
频谱图
复杂 DAW / Mixer
```

当前目标是决赛 Demo 的稳定课堂闭环，而不是增加更多专业制作功能。
