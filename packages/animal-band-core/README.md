# Animal Band Core — shared engine extraction (preview)

可独立迁移的 ESM package，位于学校版仓库的独立分支 \`feature/extract-animal-band-core\`，**不是**目前学校端的已接入依赖。

## 范围
- \`src/pitch/pitch-utils.js\`：从 V3 学校版的 \`core/pitch-utils.js\` **原样提取**，Qwen Skill \`runtime/engine/pitch-utils.js\` 经对比完全一致。
- \`src/rhythm/rhythm-runtime.js\`：从 V3 \`core/rhythm-runtime.js\` 提取纯节拍计时与状态计算；浏览器专属的 Image 资源预加载仍由各自产品负责。Qwen 版本对应文件一致。
- \`src/pitch/pitch-name.js\`：增加音符名 → MIDI 的非猜测转换。
- \`src/adapters/score-to-timeline.js\`：兼容数据仓库的两类 JSON（Verified Score 与 Creative Score），输出相同事件流结构。

### 统一事件接口
\`\`\`js
import { scoreToTimeline } from '@animal-band/core';
const result = scoreToTimeline(scoreJson, {format:'verified-score'});
// result.events: {id, kind, track, atBeat, durationBeats, ...}
\`\`\`

- \`atBeat\` **始终是乐段/整首的绝对四分音符拍位置**；\`beatInMeasure\` 只在教材核谱歌曲中可用。
- \`kind\` 是 \`note\`、\`rest\`、\`percussion\` 或 \`chord\`；chord 只标记进入点，\`durationBeats=null\` 表示原始数据未声明时长。
- \`verified-score\` 使用核谱 \`startBeat\`，不会重新分小节、调整反复或者给缺失的 confidence 编造值。
- \`creative-score\` 从旧 \`melody[].beat\`、\`bassRoots\`、\`drumGrid\`、\`lionNotes\` 转事件，**不需要先转成 verified-score**。
- 结果不含 WAV 或合成人声；编排播放需要消费方自己的声音资源、WebAudio/Tone.js 等。
- \`refreshNotePitch\` 是原 V3 的**可变更函数**，生产逻辑建议改用 \`withRefreshedNotePitch\` 非变更版本。

## 不包含
不迁移教师备课、识谱模型调用、页面交互、声像文件、用户学习进度，也不修改学校端和千问 Skill 的旧调用方式。

## 运行与测试
\`\`\`bash
cd packages/animal-band-core
npm test
\`\`\`
不引入第三方 Node 依赖；浏览器项目可将该 ESM 模块经 bundler 打包。

## 溯源
- V3 source: Mio0707/animal-band @ \`c8a072d08d7bd5a6b129043c0922b2d6888764d6\` 
- Qwen source: Mio0707/Qwen-animal-band @ \`5b3e25239370ca8b2e54494f12d8350edb8302e7\`
- data contract: \`Mio0707/animal-band-data/docs/DATA_CONTRACT_V1.md\`
- 待独立仓库 \`Mio0707/animal-band-core\` 创建后，将本目录提升到该仓库根目录。正式引入各产品在**第二步**进行。
