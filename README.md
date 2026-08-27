# Animal Bank V3 Content Factory

Stage 1 内容工厂 Demo，包含课程库、教学资产、歌曲库、简谱识别与人工校对工作区。

## 启动

```bash
/usr/bin/python3 v3/server.py
```

打开 http://127.0.0.1:4175/app/content-factory/。

## 测试

```bash
cd v3
node --test tests/*.test.js
```

Qwen 识谱适配器只从服务端环境变量或本地 .env 读取密钥；.env 不应提交。