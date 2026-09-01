function performerUrl(manifest, state) {
  const entry = manifest?.states?.[state] ?? manifest?.states?.[manifest?.fallbackState ?? "READY"];
  if (!entry?.file) return "";
  return `${String(manifest.basePath ?? "").replace(/\/$/, "")}/${entry.file}`;
}

function actionClass(action) {
  return `rhythm-preview-${String(action ?? "ready").toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
}

export function bindRhythmKnowledgePreviews(root, data) {
  const actionMap = data?.rhythmActionMap?.mapping ?? {};
  const manifest = data?.rhythmPerformerManifest;
  const previews = [...root.querySelectorAll("[data-rhythm-knowledge-preview]")];
  if (!previews.length) return;
  let active = null;

  function stop(preview, reset = true) {
    const audio = preview?.querySelector("[data-rhythm-preview-audio]");
    if (!audio) return;
    audio.pause();
    if (reset) audio.currentTime = 0;
    preview._previewFrame && cancelAnimationFrame(preview._previewFrame);
    preview._previewFrame = null;
    preview._previewEventKey = null;
    const image = preview.querySelector("[data-rhythm-preview-performer]");
    image.src = performerUrl(manifest, "READY");
    image.className = "";
    preview.querySelector("[data-rhythm-preview-action]").textContent = "准备";
    preview.querySelector("[data-rhythm-preview-play]").textContent = "▶ 试听音频与动作";
    if (active === preview) active = null;
  }

  function show(preview, action, label, eventKey) {
    const image = preview.querySelector("[data-rhythm-preview-performer]");
    const state = action ? (actionMap[action] ?? "READY") : "LISTEN";
    image.src = performerUrl(manifest, state);
    preview.querySelector("[data-rhythm-preview-action]").textContent = label;
    if (eventKey === preview._previewEventKey) return;
    preview._previewEventKey = eventKey;
    image.className = "";
    void image.offsetWidth;
    image.classList.add("rhythm-preview-hit", actionClass(action));
  }

  function tick(preview) {
    const audio = preview.querySelector("[data-rhythm-preview-audio]");
    const metadata = preview._previewMetadata;
    const labels = preview._previewLabels;
    if (!metadata || audio.paused || audio.ended) return;
    const beat = audio.currentTime * Number(metadata.bpm) / 60;
    if (beat < Number(metadata.patternStartBeat)) {
      show(preview, null, "听拍准备", `count-${Math.floor(beat)}`);
    } else {
      const patternBeat = (beat - Number(metadata.patternStartBeat)) % Number(metadata.patternBeats);
      const round = Math.floor((beat - Number(metadata.patternStartBeat)) / Number(metadata.patternBeats));
      const eventIndex = (metadata.events ?? []).findIndex((event) => patternBeat >= Number(event.atBeat) && patternBeat < Number(event.atBeat) + Number(event.durationBeats));
      const event = metadata.events?.[eventIndex] ?? null;
      show(preview, event?.action, labels[eventIndex] ?? event?.action ?? "准备", `${round}:${eventIndex}`);
    }
    preview._previewFrame = requestAnimationFrame(() => tick(preview));
  }

  for (const preview of previews) {
    const image = preview.querySelector("[data-rhythm-preview-performer]");
    const audio = preview.querySelector("[data-rhythm-preview-audio]");
    const button = preview.querySelector("[data-rhythm-preview-play]");
    image.src = performerUrl(manifest, "READY");
    preview._previewLabels = JSON.parse(preview.dataset.actionLabels || "[]");
    button.addEventListener("click", async () => {
      if (active === preview && !audio.paused) return stop(preview);
      if (active && active !== preview) stop(active);
      try {
        preview._previewMetadata ??= await fetch(preview.dataset.previewMetadata).then((response) => {
          if (!response.ok) throw new Error(`预览元数据读取失败（${response.status}）`);
          return response.json();
        });
        audio.currentTime = 0;
        await audio.play();
        active = preview;
        button.textContent = "■ 停止预览";
        tick(preview);
      } catch (error) {
        button.textContent = `预览失败：${error.message}`;
      }
    });
    audio.addEventListener("ended", () => stop(preview));
  }
}
