# 动物乐队课堂桌面播放器

桌面播放器只运行已完成的课堂，不在本地执行识谱、Qwen 或音频生成。网页端下载的 `.animalclass` 是平台无关 ZIP 容器，同一个文件可导入 macOS 和 Windows 版本。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

`npm run build` 会先从现有小狗角色图生成 macOS、Windows 所需应用图标，再构建安装包。

- macOS 在 macOS runner 构建 `.app` / `.dmg`。
- Windows 在 Windows runner 构建 `.exe` / `.msi`。
- 正式公开分发前需要分别配置 Apple Developer ID 和 Windows Code Signing 证书。

## 老师使用流程

1. 第一次使用时安装“动物乐队课堂”。
2. 在网页端完成备课并下载 `.animalclass`。
3. 双击课包自动导入，或在桌面应用中点击“导入离线课”。
4. 点击“开始上课”；课堂会在独立窗口读取本地资源，关闭后返回课程库。

## 课包安全

导入时会拒绝路径穿越，并按 `offline/manifest.json` 检查每个文件的大小和 SHA-256。只有全部资源校验成功后才替换本地旧版本。
