# 真人唱名（Katy）

Animal Bank 的“唱名”模式正式使用 Katy 真人唱名单音，不再使用 synthetic teaching vocal。

课堂播放器优先读取本目录中的 `do.wav / re.wav / mi.wav / fa.wav / sol.wav / la.wav / si.wav`。如果本地未缓存，会读取 `sample-library.json` 中的项目公开 GitHub 镜像地址。

为决赛离线演示，建议联网时先执行：

```bash
python3 scripts/cache_katy_solfege.py
```

缓存完成后课堂端不依赖网络。来源和许可见 `SOURCE.md`。
