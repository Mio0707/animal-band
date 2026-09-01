# Animal Bank V3 Batch8N｜最终统一修改报告

日期：2026-08-30

## 基线

本包直接基于最新 Batch8N 修改；没有重新合并 Batch 8K / 8L / 8M，也没有用 Batch 8O 整包覆盖。

## 最终统一逻辑

### 1. Lesson Segment 成为共享课堂单位

老师在简谱确认页设置“每 N 小节一段”后，统一生成 `lessonSegments`。以下活动直接复用同一套 Segment：

- `melody_trace`
- `rhythm_learning` 的整曲身体演奏
- `singing`
- `ensemble`
- `sticker_arrangement`

`singing` 与 `ensemble` 的 Teaching Units 也与同一 Segment 边界一致。

### 2. Measure Alignment 改为人工校准真实音频

- 不再用简谱 BPM 推算上传 MP3 的真实小节时间。
- 老师人工标定第一个完整 Lesson Segment 的开始 / 结束时间。
- 系统用该真实时长推算后续 Segment，并保留试听与人工微调入口。
- 原曲区间试听使用精确 seek，并继续支持 HTTP Range。

### 3. 一字多音

- 一个歌词字只保存在首个音符。
- 后续变音 / 延续音保存 `lyricContinuation=true` 并复用同一个 `lyricSyllableId`。
- 前端只显示一次歌词字；续音使用短连接线，不再重复显示同一个汉字。
- 续音线最大宽度限制为 28px，避免抢占简谱视觉。

### 4. 唱一唱简谱补全时值

课堂简谱现在同时表达音高与基本时值：

- 1/2 拍：数字下划线
- 1/4 拍：双下划线（数据出现时）
- 1 拍：普通数字
- 2 拍及以上：数字后延长线
- 一字多音：歌词续音短线

唱名模式优先使用 Prototype 仓库中保留的最原始 Katy / Freesound 真人唱名 MP3，而不是后加工 voice-katy WAV。

### 5. Melody Trace 正式启用现有 Gesture Library 匹配规则

`melody-gesture-matcher.js` 现在分析整个 Segment 的：

- contour
- pitchDirection
- motionType
- noteDensity
- sustain
- 音域与净变化
- 最高 / 最低点位置
- 转折次数

然后使用既有 Gesture Library 的权重、`preferWhen / avoidWhen` 与连续重复限制选择手势。

正式大画面只绘制一条 canonical SVG Path；可见轨迹和运动光点读取同一个 `path d`，不再叠加 PNG 手势轨迹。缩略图仍可使用现有手势图片。

### 6. 学节奏新增“4. 用身体演奏歌曲”

整曲身体演奏不建立第二套动作映射，而是复用正式链路：

`Pattern → Teaching Application → bodyActions → DOG runtime state → performer asset`

当前正式动作包括拍手、拍腿、左右拍腿、跺脚、定格等。旧 Prototype 的“敲桌面 / 敲桌沿”映射没有重新启用。

整曲跟练：

- 按 Lesson Segment 练习
- 播放老师上传的原始 MP3
- 用 Measure Alignment 定时
- 根据歌曲真实 Pattern occurrence 触发身体动作

### 7. Ensemble 改为 Prototype 合作表演壳 + V3 真实数据

交互收敛为：

`角色选择 → 分角色练习 → 三角色完成 → 一起合作演奏`

三角色不生成独立课程数据：

- 演唱家 = `singing`
- 身体节奏家 = `rhythm_learning` 第 4 项的 `bodySongPlan`
- 旋律指挥家 = `melody_trace`

三者使用完全相同的 Segment index 和原曲时间窗。古诗固定数据没有进入 V3 合奏 Runtime。

### 8. Sticker Arrangement 改为 Segment × Animal Matrix

- 横向：老师确认的 Lesson Segment
- 纵向：小狗 / 小熊 / 小猫 / 小狮子
- 点亮格子表示该动物在整个 Segment 演奏
- 舞台只显示当前 Segment 已开启的动物
- 保留 Prototype 风格的剧场舞台、幕布、灯光背景、木地板与当前段提示牌

### 9. 动物与乐器视觉映射统一

正式四轨映射：

- dog → drums
- bear → keyboard
- cat → bass
- lion → alto_sax

小狮子固定使用 Prototype `assets/stickers/performer-lion-trumpet.png` 的原始儿童端演奏变体（本项目固化为本地 `performer-lion.png`），不再使用旧的 Guitar / 吉他图；声音声部仍按 `alto_sax` 生成。

## 外部原始资源缓存

代码已保留远程 fallback，因此联网预览可以直接加载；需要完全离线运行时执行：

```bash
python3 scripts/cache_katy_solfege.py
python3 scripts/cache_prototype_sticker_assets.py
```

第一条缓存 7 个原始 Katy 真人唱名 MP3；第二条缓存 Prototype 正式 performer / collaboration 角色图。

## 回归验证

最终执行：

```bash
npm test
```

结果：**107 / 107 PASS**。

另外完成：

- 所有本轮关键 JS 文件 `node --check` 通过
- Python 源文件编译检查通过
- Lion / alto_sax 映射专项断言通过
- Singing 时值与短续音线专项断言通过
- Melody Trace canonical SVG Path / light dot 专项断言通过
- Rhythm SONG_PLAY / Body Mapping / Segment 对齐专项断言通过
- Ensemble Prototype 壳与三份共享 Segment 数据专项断言通过
- Sticker Segment × Animal Matrix / Prototype Stage 专项断言通过
