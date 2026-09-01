function performerUrl(manifest, state) {
  const entry = manifest?.states?.[state] ?? manifest?.states?.[manifest?.fallbackState ?? "READY"];
  if (!entry?.file) return "";
  return `${String(manifest.basePath ?? "").replace(/\/$/, "")}/${entry.file}`;
}

function actionClass(action) {
  return `rhythm-preview-${String(action ?? "ready").toLowerCase().replace(/[^a-z0-9_-]/g, "-")}`;
}

const decodedImages = new Map();
const metadataRequests = new Map();

function preloadImage(url) {
  if (!url) return Promise.resolve();
  if (!decodedImages.has(url)) {
    decodedImages.set(url, new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        const decoded = typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
        decoded.then(resolve);
      };
      image.onerror = () => reject(new Error(`动作图片加载失败：${url}`));
      image.src = url;
    }));
  }
  return decodedImages.get(url);
}

function fetchMetadata(url) {
  if (!metadataRequests.has(url)) {
    metadataRequests.set(url, fetch(url).then((response) => {
      if (!response.ok) throw new Error(`预览元数据读取失败（${response.status}）`);
      return response.json();
    }));
  }
  return metadataRequests.get(url);
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
    if (eventKey === preview._previewEventKey) return;
    preview._previewEventKey = eventKey;
    const image = preview.querySelector("[data-rhythm-preview-performer]");
    const state = action ? (actionMap[action] ?? "READY") : "LISTEN";
    image.src = performerUrl(manifest, state);
    preview.querySelector("[data-rhythm-preview-action]").textContent = label;
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

  async function prepare(preview) {
    if (!preview._previewReady) {
      preview._previewReady = (async () => {
        const metadata = await fetchMetadata(preview.dataset.previewMetadata);
        preview._previewMetadata = metadata;
        const states = new Set(["READY", "LISTEN"]);
        for (const event of metadata.events ?? []) states.add(actionMap[event.action] ?? "READY");
        await Promise.all([...states].map((state) => preloadImage(performerUrl(manifest, state))));
      })().catch((error) => {
        preview._previewReady = null;
        throw error;
      });
    }
    return preview._previewReady;
  }

  for (const preview of previews) {
    const image = preview.querySelector("[data-rhythm-preview-performer]");
    const audio = preview.querySelector("[data-rhythm-preview-audio]");
    const button = preview.querySelector("[data-rhythm-preview-play]");
    image.src = performerUrl(manifest, "READY");
    preloadImage(image.src).catch(() => {});
    preview._previewLabels = JSON.parse(preview.dataset.actionLabels || "[]");
    const prime = () => prepare(preview).catch(() => {});
    preview.addEventListener("pointerenter", prime, { once: true });
    preview.addEventListener("focusin", prime, { once: true });
    button.addEventListener("click", async () => {
      if (active === preview && !audio.paused) return stop(preview);
      if (active && active !== preview) stop(active);
      try {
        button.textContent = "正在准备动作…";
        await prepare(preview);
        audio.currentTime = 0;
        show(preview, null, "听拍准备", "count-ready");
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
