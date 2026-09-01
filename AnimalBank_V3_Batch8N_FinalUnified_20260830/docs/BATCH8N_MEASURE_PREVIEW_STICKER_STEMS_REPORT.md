# Animal Bank V3｜Batch 8N 修改报告

## 1. 本批目标

本批只处理两个确定问题：

1. 修复简谱确认页 Measure Alignment 的教学段试听，使每个“试听”按钮真正从对应小节区间开始、到区间结束自动停止。
2. 删除旧 8/16 格 Sticker Step Sequencer，按最终产品方案重建为 Prototype 式动物贴纸舞台 + 四条同步 Stem + 小节级加入/退出。

## 2. Measure Alignment 区间试听

修复后的浏览器流程：

```text
ensure loadedmetadata
→ pause previous preview
→ seek(startSec)
→ wait seeked
→ set active preview
→ play
→ currentTime >= endSec
→ auto pause
```

同时支持：

- 波形图高亮当前试听区间；
- 当前试听行/按钮高亮；
- 切换另一个教学段时取消上一次异步 seek/play；
- 点击波形跳转时先退出区间试听；
- 所有区间由 Measure Alignment 动态计算，不保存重复 start/end 数据。

## 3. Sticker 正式音乐生产链路

```text
Verified Score
→ Qwen shared Arrangement Plan
→ deterministic local compiler
→ dog / bear / cat / lion Track JSON
→ MIDI
→ FluidSynth + MuseScore_General.sf3
→ 4 synchronized WAV stems
→ preview mix QA
```

固定角色：

- dog：鼓组
- bear：键盘和声
- cat：贝斯
- lion：中音萨克斯主旋律

Qwen 不进行四次独立自由创作，只规划一份共享和声与每小节职责。萨克斯继续使用 Verified Score 主旋律。

没有 Qwen API 时，生成器使用明确标记的 `score_derived_fallback`，保证开发与 Demo 数据仍可生成 Track JSON / MIDI，不伪装成 Qwen 成功。

## 4. Stem 同步处理

FluidSynth 不同音色可能产生长度不同的 release tail。本批增加渲染后时长归一化：

```text
目标时长 = totalBeats × 60 / BPM
```

每条 Stem 在渲染后 trim / pad 到完全相同的音乐时间线，再生成 `preview-mix.wav`。

Readiness 对 Sticker 检查 `STICKER_STEMS`，必须是当前 Verified Score 对应的四条固定 Stem。

## 5. Prototype 式学生动物舞台

学生端不再显示 8/16 格拍点编辑器。

保留 Prototype 的动物贴纸舞台方向与四个 performer 素材入口。页面只读取已固化在项目 `assets/stickers/performers/` 的本地资源，不依赖 GitHub 图片 URL；缓存脚本优先从用户提供的 `prototype/assets/stickers` 原始主目录同步，独立 checkout 才使用公开源作为后备。离线演示前可运行 `python3 scripts/cache_prototype_sticker_assets.py`。

学生交互简化成：

- 四个动物乐手；
- 当前小节；
- 播放 / 暂停；
- 点击动物加入 / 休息；
- “动物乐队一起上！”；
- 编排完成后“听听我的版本 / 再编一次”。

不提供 Mixer / Gain / Solo / Mute / Piano Roll / 音符编辑。

四条 Stem 一直共享同一个 AudioContext Timeline，同步启动；学生行为只改变每轨 Gain。

## 6. 小节级切换

学生点击后不会立即硬切声音：

```text
当前小节内点击
→ 记录 pending intent
→ 下一小节第 1 拍
→ ON / OFF 生效
```

保存的数据也是生效小节，而不是点击时刻或 Beat：

```json
{
  "measure": 5,
  "trackId": "cat",
  "state": "on"
}
```

## 7. 删除的旧 Sticker 路径

- beat grid / 8–16 格模型；
- `stickerGridFromScore`；
- 旧 `/sticker-arrangement/render`；
- 旧 `sticker_arrangement_renderer.py`；
- 浏览器 one-shot kick/clap/shaker/bell 合成创作方式。

## 8. 自动验证

最终包以 `npm test`、Python compile、JS syntax、JSON parse 与 HTTP smoke 为自动验收。

FluidSynth → WAV 的真实执行依赖运行机器安装的 FluidSynth 与 SoundFont。本批容器环境没有 FluidSynth，因此不会把该项伪报为自动 PASS；项目已经提供实际运行路径与错误诊断。
