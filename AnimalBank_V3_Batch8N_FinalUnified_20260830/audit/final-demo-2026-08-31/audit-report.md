# 决赛 Demo 评分审计（2026-08-31）

## 结论

当前 Demo 的课堂互动、视觉完成度和创新形式较强，但最容易失分的是：真实乡村用户证据缺失、低网/离线能力未被证明、当前示例备课状态不是 READY、四轨仍为 Qwen fallback、AI 生成逻辑缺少可解释展示。

## 当前状态取证

- 课堂方案包含 6 个活动，但状态为“待确认”。
- 示例备课数据：`status=DRAFT`、`recipeReviewStatus=NOT_REVIEWED`、`audioPlanStatus=STALE`、`audioManifestStatus=STALE`、`readinessStatus=NOT_EVALUATED`。
- 示例四轨：`generator.type=score_derived_fallback`、`fallback=true`、原因为未配置 Key 时生成的旧产物。
- 仓库内未检索到教师访谈、课堂试点或真实用户反馈材料。
- 未发现 PWA/service worker/离线包入口；当前仅有资源预生成与本地服务能力。

## 决赛前优先级

### P0

1. 用当前 Qwen 配置重新生成四轨并完成课堂方案确认、音频计划、素材与就绪检查，确保决赛示例全链路 READY。
2. 增加一页“AI 如何参与”：简谱图片 → Qwen OCR → 教师校对 → 课程标准知识库 → 节奏/动作匹配 → 课堂活动。
3. 补充真实用户证据：至少 3–5 位乡村教师访谈、1 次课堂试用、可量化的备课时间与学生参与数据。
4. 准备断网演示包：课堂运行不依赖实时 API，提供资源完整性自检和弱网提示。

### P1

1. 增加乡村场景首页：无专职音乐教师、乐器不足、网络不稳、混龄课堂；给出与传统方案的对比。
2. 提供“40 分钟/无乐器/低网速”一键备课模板和活动时长建议，避免默认 6 个活动全部上课。
3. 增加投影模式、声音检查、断点重试和生成失败恢复。
4. 补齐键盘操作、焦点样式、非颜色状态提示、减少动态效果选项。

## 截图

- `01-classroom-listen.png`：课堂听一听
- `02-teacher-readiness.png`：备课完成与四轨状态
- `03-lesson-plan.png`：课堂方案
- `04-rhythm-classroom.png`：节奏教学
- `05-sticker-classroom.png`：动物贴纸创作
