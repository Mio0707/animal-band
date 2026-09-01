# Qwen Score Recognition Adapter

Server-side only pipeline for numbered-score images:

```text
score image → Qwen raw.json → normalized draft.json → Human Review
```

Create `.env` at the repository root. The adapter loads it automatically; existing process environment variables take precedence:

```dotenv
cp .env.example .env

# Then edit the project-root .env:
DASHSCOPE_API_KEY=sk-your-key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
SCORE_VISION_MODEL=qwen3.8-flash
STICKER_ARRANGEMENT_MODEL=qwen3.8-flash
```

The adapter accepts a bare host, a `/compatible-mode/v1` Base URL, or the full `/chat/completions` URL.

```bash
python3 qwen_score_recognizer.py \
  --image /path/to/score.png \
  --song-id song_001 \
  --output-root ../../data/songs
```

The repository `.gitignore` excludes `.env`; never commit or share that file. `raw.json` is immutable recognition output; `normalized.json` is always `draft`. Qwen may recognize and align note-level lyrics, but a human must review notes and lyrics, choose the singing teaching grouping (for example every 2 measures), and complete verification.

For offline tests, `--raw-input` supplies a fixture and skips network access.
