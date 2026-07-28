"use strict";

(function yambdaSignalV2() {
  const source = window.YAMBDA_SEQUENCE;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const RAW_STEPS = 16;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.12;
  const PRESET_KEY = "yambda-signal-v2-preset";
  const SCALES = Object.freeze({
    minorPentatonic: [0, 3, 5, 7, 10, 12],
    dorian: [0, 2, 3, 5, 7, 9, 10, 12],
    majorPentatonic: [0, 2, 4, 7, 9, 12],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  });

  const TRACKS = [
    { id: "listen", name: "LISTEN DEPTH", detail: "played_ratio_pct", color: "#77efff" },
    { id: "length", name: "TRACK LENGTH", detail: "track_length_seconds", color: "#efff72" },
    { id: "discovery", name: "DISCOVERY", detail: "organic / recommendation", color: "#ff8ed8" },
    { id: "feedback", name: "FEEDBACK", detail: "like / dislike / early skip", color: "#ffad6b" }
  ];

  const DEFAULTS = Object.freeze({
    profileIndex: 0,
    structure: 58,
    timeMode: "flow",
    bpm: 104,
    swing: 0.14,
    pace: 1,
    quantize: 0.32,
    endBreath: 1.8,
    metronome: false,
    metronomeLevel: 0.12,
    eventResolution: 16,
    rarity: 1.8,
    normalization: "robust",
    root: 38,
    scale: "minorPentatonic",
    bassCutoff: 920,
    release: 0.46,
    warmth: 0.72,
    fmIndex: 0.58,
    delay: 0.18,
    delayFeedback: 0.21,
    reverb: 0.14,
    volume: 0.68,
    seed: 1497451842
  });

  const state = {
    ...DEFAULTS,
    view: location.hash === "#lab" ? "lab" : "signal",
    playing: false,
    pendingStart: false,
    currentEvent: -1,
    selectedEvent: 0,
    cycle: 1,
    timer: null,
    uiTimers: [],
    cycleStartTime: 0,
    nextTimelineIndex: 0,
    scene: null,
    timeline: null,
    manualOverrides: {},
    layerState: Object.fromEntries(TRACKS.map((track) => [track.id, { enabled: true, gain: 1 }])),
    audioCtx: null,
    master: null,
    analyser: null,
    noiseBuffer: null,
    delayNode: null,
    delayReturn: null,
    delayFeedbackNode: null,
    reverbReturn: null,
    visualPhase: 0,
    statusTimer: null
  };

  const $ = (id) => document.getElementById(id);
  const els = new Proxy({}, { get: (_target, property) => $(property) });

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function lerp(a, b, amount) { return a + (b - a) * amount; }
  function midiToHz(note) { return 440 * Math.pow(2, (note - 69) / 12); }
  function currentProfile() { return source.profiles[state.profileIndex]; }
  function rawEvents() { return currentProfile().events; }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function quantile(values, amount) {
    const sorted = values.slice().sort((a, b) => a - b);
    const position = (sorted.length - 1) * amount;
    const base = Math.floor(position);
    const rest = position - base;
    return sorted[base + 1] === undefined ? sorted[base] : sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }

  function normalizeSeries(values, mode = state.normalization) {
    if (mode === "local") {
      const sorted = values.slice().sort((a, b) => a - b);
      return values.map((value) => sorted.length < 2
        ? 0.5
        : (sorted.filter((candidate) => candidate <= value).length - 1) / (sorted.length - 1));
    }
    if (mode === "linear") {
      const low = Math.min(...values);
      const high = Math.max(...values);
      return values.map((value) => high === low ? 0.5 : clamp((value - low) / (high - low), 0, 1));
    }
    const p05 = quantile(values, 0.05);
    const p95 = quantile(values, 0.95);
    const span = Math.max(0.0001, p95 - p05);
    return values.map((value) => clamp((value - p05) / span, 0, 1));
  }

  function seededNoise(index, salt = 0) {
    let value = (state.seed + index * 2654435761 + salt * 1013904223) >>> 0;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  }

  function getStructureStage(value = state.structure) {
    const safeValue = Number.isFinite(Number(value)) ? clamp(Number(value), 0, 100) : 50;
    if (safeValue < 25) return { id: "essence", name: "ESSENCE", resolution: 4, layers: ["listen", "feedback"], ornament: 0 };
    if (safeValue < 50) return { id: "contour", name: "CONTOUR", resolution: 8, layers: ["listen", "length", "feedback"], ornament: 0 };
    if (safeValue < 75) return { id: "signal", name: "SIGNAL", resolution: 16, layers: TRACKS.map((track) => track.id), ornament: 0 };
    return { id: "swarm", name: "SWARM", resolution: 16, layers: TRACKS.map((track) => track.id), ornament: (safeValue - 75) / 25 };
  }

  function rawSalience(rows) {
    const ratios = rows.map((event) => event[0]);
    const lengths = rows.map((event) => event[1]);
    const ratioMedian = median(ratios);
    const lengthMedian = median(lengths);
    const ratioSpan = Math.max(1, quantile(ratios, 0.75) - quantile(ratios, 0.25));
    const lengthSpan = Math.max(1, quantile(lengths, 0.75) - quantile(lengths, 0.25));
    return rows.map((event, index) => {
      const ratioDeviation = clamp(Math.abs(event[0] - ratioMedian) / (ratioSpan * 1.5), 0, 1);
      const lengthDeviation = clamp(Math.abs(event[1] - lengthMedian) / (lengthSpan * 1.5), 0, 1);
      const transition = index > 0 && event[2] !== rows[index - 1][2] ? 1 : 0;
      const feedback = event[3] !== 0 ? 1 : event[0] < 50 ? 0.65 : 0;
      let score = clamp(0.30 * ratioDeviation + 0.15 * lengthDeviation + 0.20 * transition + 0.35 * feedback, 0, 1);
      if (event[3] < 0) score = Math.max(score, 0.98);
      else if (event[3] > 0) score = Math.max(score, 0.93);
      else if (event[0] < 50) score = Math.max(score, 0.72);
      if (event[0] > 100) score = Math.max(score, 0.70);
      return score;
    });
  }

  function aggregateChunk(chunk, indices, salience, normalized) {
    const landmarks = chunk
      .map((event, localIndex) => ({
        type: event[3],
        kind: event[3] > 0 ? "like" : event[3] < 0 ? "dislike" : event[0] < 50 ? "early-skip" : null,
        rawIndex: indices[localIndex]
      }))
      .filter((item) => item.kind);
    const representativeFeedback = landmarks.find((item) => item.type < 0)?.type || landmarks.find((item) => item.type > 0)?.type || 0;
    const organicFraction = chunk.reduce((sum, event) => sum + event[2], 0) / chunk.length;
    const ratios = chunk.map((event) => event[0]);
    const lengths = chunk.map((event) => event[1]);
    const delta = chunk.reduce((sum, event) => sum + event[4], 0);
    return {
      ratio: median(ratios),
      length: median(lengths),
      organic: organicFraction,
      feedback: representativeFeedback,
      landmarks,
      delta,
      sourceIndices: indices,
      salience: Math.max(...indices.map((index) => salience[index])),
      replay: Math.max(...ratios) > 100,
      earlySkip: landmarks.some((item) => item.kind === "early-skip"),
      transition: indices.some((index) => index > 0 && rawEvents()[index][2] !== rawEvents()[index - 1][2]),
      normalized: {
        listen: median(indices.map((index) => normalized.listen[index])),
        length: median(indices.map((index) => normalized.length[index])),
        discovery: organicFraction,
        feedback: representativeFeedback !== 0 ? 1 : Math.min(...ratios) < 50 ? 0.62 : 0.12
      }
    };
  }

  function buildScene() {
    const rows = rawEvents();
    const stage = getStructureStage();
    const requestedResolution = [4, 8, 16].includes(Number(state.eventResolution)) ? Number(state.eventResolution) : 16;
    const targetResolution = Math.min(requestedResolution, stage.resolution);
    const groupSize = RAW_STEPS / targetResolution;
    const salience = rawSalience(rows);
    const normalized = {
      listen: rows.map((event) => clamp(event[0] / 140, 0.05, 1)),
      length: normalizeSeries(rows.map((event) => event[1])),
      discovery: rows.map((event) => event[2]),
      feedback: rows.map((event) => event[3] !== 0 ? 1 : event[0] < 50 ? 0.62 : 0.12)
    };
    const gestures = [];
    for (let start = 0; start < RAW_STEPS; start += groupSize) {
      const indices = Array.from({ length: groupSize }, (_item, offset) => start + offset);
      const chunk = indices.map((index) => rows[index]);
      gestures.push(aggregateChunk(chunk, indices, salience, normalized));
    }
    const ornamentThreshold = lerp(1, 0.42, stage.ornament);
    const ornaments = rows.map((event, index) => ({
      rawIndex: index,
      ratio: event[0],
      feedback: event[3],
      transition: index > 0 && event[2] !== rows[index - 1][2],
      salience: salience[index],
      jitter: seededNoise(index, 7)
    })).filter((item) => item.salience + item.jitter * 0.18 >= ornamentThreshold || item.ratio > 100 || item.feedback !== 0);
    return { stage, targetResolution, gestures, ornaments, rawSalience: salience };
  }

  function buildTimeline(scene = state.scene) {
    const count = scene.gestures.length;
    const entries = [];
    if (state.timeMode === "pulse") {
      const safeBpm = clamp(Number(state.bpm) || DEFAULTS.bpm, 40, 220);
      const barDuration = 4 * 60 / safeBpm;
      const stepDuration = barDuration / count;
      scene.gestures.forEach((gesture, index) => {
        const swingOffset = index % 2 === 1 ? stepDuration * state.swing : 0;
        entries.push({ gesture, index, offset: index * stepDuration + swingOffset });
      });
      return { entries, duration: barDuration, medianInterval: stepDuration };
    }

    const safePace = clamp(Number(state.pace) || 1, 0.25, 4);
    const logs = scene.gestures.map((gesture) => Math.log1p(Math.max(0, Number(gesture.delta) || 0)));
    const low = Math.min(...logs);
    const high = Math.max(...logs);
    const intervals = logs.map((value) => lerp(0.20, 1.45, high === low ? 0.5 : (value - low) / (high - low)) / safePace);
    let cursor = 0;
    scene.gestures.forEach((gesture, index) => {
      if (index > 0) cursor += intervals[index];
      let offset = cursor;
      if (state.timeMode === "elastic") {
        const grid = 4 * 60 / clamp(Number(state.bpm) || DEFAULTS.bpm, 40, 220) / count;
        const quantized = Math.round(offset / grid) * grid;
        offset = lerp(offset, quantized, clamp(Number(state.quantize) || 0, 0, 1));
        if (entries.length) offset = Math.max(offset, entries[entries.length - 1].offset + 0.05);
      }
      entries.push({ gesture, index, offset });
    });
    const medianInterval = median(intervals);
    const duration = Math.max(entries[entries.length - 1]?.offset || 0, 0) + medianInterval * state.endBreath;
    return { entries, duration, medianInterval };
  }

  function rebuildMusicalModel({ restart = true } = {}) {
    state.scene = buildScene();
    state.timeline = buildTimeline();
    state.selectedEvent = clamp(state.selectedEvent, 0, state.scene.gestures.length - 1);
    if (restart && state.playing) restartSchedule();
    renderAll();
  }

  function overrideBucket() {
    const profileId = currentProfile().id;
    if (!state.manualOverrides[profileId]) state.manualOverrides[profileId] = {};
    return state.manualOverrides[profileId];
  }

  function baseTrackActive(trackId, gesture) {
    const density = state.structure / 100;
    const threshold = lerp(0.82, 0.18, density);
    if (trackId === "listen") return state.timeMode === "flow" || gesture.ratio >= 50 || gesture.salience >= threshold;
    if (trackId === "length") return gesture.normalized.length >= threshold * 0.82 || gesture.salience >= threshold;
    if (trackId === "discovery") return gesture.transition || Math.abs(gesture.organic - 0.5) >= lerp(0.45, 0.12, density) || gesture.salience >= threshold;
    return gesture.feedback !== 0 || gesture.earlySkip;
  }

  function trackActive(trackId, gesture) {
    if (!state.scene.stage.layers.includes(trackId) || !state.layerState[trackId].enabled) return false;
    const bucket = overrideBucket();
    const values = gesture.sourceIndices.map((index) => bucket[`${trackId}:${index}`]).filter((value) => value !== undefined);
    return values.length ? values.filter(Boolean).length >= Math.ceil(values.length / 2) : baseTrackActive(trackId, gesture);
  }

  function toggleGestureTrack(trackId, gestureIndex) {
    const gesture = state.scene.gestures[gestureIndex];
    const active = trackActive(trackId, gesture);
    const bucket = overrideBucket();
    gesture.sourceIndices.forEach((index) => { bucket[`${trackId}:${index}`] = !active; });
    state.selectedEvent = gestureIndex;
    renderMatrices();
    renderEventInspector();
    if (state.playing) restartSchedule();
  }

  function feedbackLabel(gesture) {
    if (gesture.feedback > 0) return "LIKE";
    if (gesture.feedback < 0) return "DIS";
    if (gesture.earlySkip) return "SKIP";
    return "—";
  }

  function cellValue(trackId, gesture) {
    if (trackId === "listen") return `${Math.round(gesture.ratio)}%`;
    if (trackId === "length") return `${Math.round(gesture.length / 60)}m`;
    if (trackId === "discovery") return gesture.organic >= 0.66 ? "ORG" : gesture.organic <= 0.34 ? "REC" : "MIX";
    return feedbackLabel(gesture);
  }

  function spokenValue(trackId, gesture) {
    if (trackId === "listen") return `прослушано ${Math.round(gesture.ratio)} процентов`;
    if (trackId === "length") return `длина трека ${Math.round(gesture.length)} секунд`;
    if (trackId === "discovery") return `доля органических событий ${Math.round(gesture.organic * 100)} процентов`;
    return feedbackLabel(gesture) === "—" ? "без явной оценки" : feedbackLabel(gesture);
  }

  function renderMatrix(ruler, rows, compact = false) {
    if (!ruler || !rows || !state.scene) return;
    const count = state.scene.gestures.length;
    const grid = rows.closest(".sequence-grid");
    if (grid) grid.style.setProperty("--steps", String(count));
    ruler.style.setProperty("--steps", String(count));
    ruler.innerHTML = state.scene.gestures.map((gesture, index) => {
      const delta = gesture.delta * 5;
      return `<span>${String(index + 1).padStart(2, "0")}${compact ? "" : `<small>Δ${delta}s</small>`}</span>`;
    }).join("");
    rows.textContent = "";
    TRACKS.forEach((track) => {
      const row = document.createElement("div");
      row.className = "track-row";
      row.style.setProperty("--track", track.color);
      row.style.setProperty("--steps", String(count));
      const label = document.createElement("div");
      label.className = "track-label";
      const effective = state.scene.stage.layers.includes(track.id) && state.layerState[track.id].enabled;
      label.innerHTML = `<i></i><span><strong>${track.name}</strong><small>${effective ? track.detail : "layer parked by structure"}</small></span>`;
      label.classList.toggle("is-parked", !effective);
      row.appendChild(label);
      state.scene.gestures.forEach((gesture, index) => {
        const active = trackActive(track.id, gesture);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `step${active ? "" : " is-off"}${index === state.currentEvent ? " is-current" : ""}${index === state.selectedEvent ? " is-selected" : ""}`;
        button.dataset.track = track.id;
        button.dataset.event = String(index);
        button.style.setProperty("--level", gesture.normalized[track.id].toFixed(3));
        button.setAttribute("aria-pressed", String(active));
        button.setAttribute("aria-label", `${track.name}, жест ${index + 1}: ${spokenValue(track.id, gesture)}. ${active ? "Звучит" : "Выключено"}.`);
        button.innerHTML = `<span class="step-value">${cellValue(track.id, gesture)}</span>`;
        button.addEventListener("click", () => toggleGestureTrack(track.id, index));
        button.addEventListener("focus", () => { state.selectedEvent = index; renderEventInspector(); });
        row.appendChild(button);
      });
      rows.appendChild(row);
    });
  }

  function renderMatrices() {
    renderMatrix(els.signalStepRuler, els.signalTrackRows, true);
    renderMatrix(els.labStepRuler, els.labTrackRows, false);
  }

  function renderProfiles() {
    if (els.profileTabs) {
      els.profileTabs.textContent = "";
      source.profiles.forEach((profile, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `profile-tab${index === state.profileIndex ? " is-active" : ""}`;
        button.style.setProperty("--tab-accent", profile.accent);
        button.setAttribute("aria-pressed", String(index === state.profileIndex));
        button.innerHTML = `<b>${String(index + 1).padStart(2, "0")} / ${profile.name}</b><small>${profile.detail}</small>`;
        button.addEventListener("click", () => selectProfile(index));
        els.profileTabs.appendChild(button);
      });
    }
    if (els.profileNote) els.profileNote.textContent = `${currentProfile().name}: ${currentProfile().detail}. ${state.scene.targetResolution} музыкальных жестов из 16 окон Yambda.`;
    if (els.labProfileSelect) {
      if (!els.labProfileSelect.options.length) {
        source.profiles.forEach((profile, index) => els.labProfileSelect.add(new Option(profile.name, String(index))));
      }
      els.labProfileSelect.value = String(state.profileIndex);
    }
    document.documentElement.style.setProperty("--accent", currentProfile().accent);
  }

  function renderStructure() {
    const stage = state.scene.stage;
    [els.structureControl, els.labStructureControl].filter(Boolean).forEach((input) => { input.value = String(state.structure); });
    [els.structureOutput, els.labStructureOutput].filter(Boolean).forEach((output) => { output.textContent = `${stage.name} · ${Math.round(state.structure)}`; });
    [els.structureStage, els.labStructureStage].filter(Boolean).forEach((output) => { output.textContent = stage.name; });
    if (els.complexityDetails) {
      const activeLayers = stage.layers.filter((id) => state.layerState[id].enabled).length;
      const polyphony = Math.max(1, Math.round(activeLayers * (1 + stage.ornament * 0.65)));
      els.complexityDetails.innerHTML = `
        <span><small>EVENTS</small><b>${state.scene.targetResolution}</b></span>
        <span><small>VOICES</small><b>${activeLayers}</b></span>
        <span><small>POLYPHONY</small><b>≈ ${polyphony}</b></span>
        <span><small>MICRO EVENTS</small><b>${stage.ornament ? `${Math.round(stage.ornament * 100)}%` : "OFF"}</b></span>`;
    }
  }

  function renderTimeControls() {
    document.querySelectorAll("[data-time-mode]").forEach((button) => {
      const active = button.dataset.timeMode === state.timeMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const summary = state.timeMode === "pulse"
      ? `PULSE · ${state.bpm} BPM · swing ${Math.round(state.swing * 100)}%`
      : state.timeMode === "elastic"
        ? `ELASTIC · pace ${state.pace.toFixed(2)}× · magnet ${Math.round(state.quantize * 100)}%`
        : `FLOW · pace ${state.pace.toFixed(2)}× · data time`;
    if (els.timeSummary) els.timeSummary.textContent = summary;
    const pulseLike = state.timeMode === "pulse";
    if (els.listenMappingText) els.listenMappingText.textContent = pulseLike
      ? "played_ratio_pct → pulse weight · tail"
      : "played_ratio_pct → breath envelope · filter";
    if (els.listenMappingTarget) els.listenMappingTarget.textContent = pulseLike ? "KICK" : state.timeMode === "elastic" ? "GESTURE" : "BREATH";
    document.querySelectorAll("[data-pulse-only]").forEach((element) => { element.hidden = state.timeMode === "flow"; });
    document.querySelectorAll("[data-flow-only]").forEach((element) => { element.hidden = state.timeMode === "pulse"; });
  }

  function renderLayerControls() {
    if (!els.layerControls) return;
    els.layerControls.textContent = "";
    TRACKS.forEach((track) => {
      const layer = state.layerState[track.id];
      const allowed = state.scene.stage.layers.includes(track.id);
      const row = document.createElement("div");
      row.className = `layer-control${allowed ? "" : " is-parked"}`;
      row.style.setProperty("--track", track.color);
      row.innerHTML = `
        <label class="layer-toggle"><input type="checkbox" data-layer-toggle="${track.id}" ${layer.enabled ? "checked" : ""}><i></i><span><b>${track.name}</b><small>${allowed ? "active in structure" : "parked until higher resolution"}</small></span></label>
        <label class="layer-gain"><span>GAIN</span><input type="range" min="0" max="125" value="${Math.round(layer.gain * 100)}" data-layer-gain="${track.id}"><output>${Math.round(layer.gain * 100)}%</output></label>`;
      els.layerControls.appendChild(row);
    });
    els.layerControls.querySelectorAll("[data-layer-toggle]").forEach((input) => {
      input.addEventListener("change", () => {
        state.layerState[input.dataset.layerToggle].enabled = input.checked;
        rebuildMusicalModel();
      });
    });
    els.layerControls.querySelectorAll("[data-layer-gain]").forEach((input) => {
      input.addEventListener("input", () => {
        state.layerState[input.dataset.layerGain].gain = Number(input.value) / 100;
        input.parentElement.querySelector("output").textContent = `${input.value}%`;
      });
    });
  }

  function renderEventInspector() {
    if (!els.eventInspector || !state.scene) return;
    const gesture = state.scene.gestures[state.selectedEvent];
    const entry = state.timeline.entries[state.selectedEvent];
    const sourceRange = gesture.sourceIndices.length === 1
      ? `raw event ${gesture.sourceIndices[0] + 1}`
      : `raw events ${gesture.sourceIndices[0] + 1}–${gesture.sourceIndices[gesture.sourceIndices.length - 1] + 1}`;
    const rows = [
      ["played_ratio_pct", `${Math.round(gesture.ratio)}%`, gesture.normalized.listen.toFixed(3)],
      ["track_length_seconds", `${Math.round(gesture.length)}s`, gesture.normalized.length.toFixed(3)],
      ["is_organic", `${Math.round(gesture.organic * 100)}%`, gesture.normalized.discovery.toFixed(3)],
      ["feedback", feedbackLabel(gesture), gesture.normalized.feedback.toFixed(3)],
      ["timestamp delta", `${gesture.delta * 5}s`, `${entry.offset.toFixed(2)}s in cycle`]
    ];
    els.eventInspector.innerHTML = `
      <div class="inspector-head"><span>GESTURE ${String(state.selectedEvent + 1).padStart(2, "0")}</span><b>${sourceRange}</b></div>
      <div class="inspector-score"><span>SALIENCE</span><strong>${gesture.salience.toFixed(3)}</strong><i style="--score:${gesture.salience}"></i></div>
      <div class="inspector-table">${rows.map(([field, raw, mapped]) => `<div><code>${field}</code><b>${raw}</b><span>→ ${mapped}</span></div>`).join("")}</div>
      <p>${gesture.feedback !== 0 ? "Feedback сохранён как landmark и не исчезает при агрегации." : gesture.replay ? "Replay выше 100% создаёт семантическое эхо на уровне Swarm." : "Жест агрегирует данные без изменения исходных значений."}</p>`;
  }

  function renderControlValues() {
    const bindings = [
      ["bpmControl", state.bpm, "bpmOutput", `${state.bpm} BPM`],
      ["swingControl", Math.round(state.swing * 100), "swingOutput", `${Math.round(state.swing * 100)}%`],
      ["paceControl", Math.round(state.pace * 100), "paceOutput", `${state.pace.toFixed(2)}×`],
      ["quantizeControl", Math.round(state.quantize * 100), "quantizeOutput", `${Math.round(state.quantize * 100)}%`],
      ["breathControl", Math.round(state.endBreath * 100), "breathOutput", `${state.endBreath.toFixed(1)}×`],
      ["metronomeLevel", Math.round(state.metronomeLevel * 100), "metronomeOutput", `${Math.round(state.metronomeLevel * 100)}%`],
      ["rarityControl", Math.round(state.rarity * 100), "rarityOutput", `${state.rarity.toFixed(1)}×`],
      ["bassCutoffControl", state.bassCutoff, "bassCutoffOutput", `${Math.round(state.bassCutoff)} Hz`],
      ["releaseControl", Math.round(state.release * 1000), "releaseOutput", `${Math.round(state.release * 1000)} ms`],
      ["warmthControl", Math.round(state.warmth * 100), "warmthOutput", `${Math.round(state.warmth * 100)}%`],
      ["fmIndexControl", Math.round(state.fmIndex * 100), "fmIndexOutput", `${Math.round(state.fmIndex * 100)}%`],
      ["delayControl", Math.round(state.delay * 100), "delayOutput", `${Math.round(state.delay * 100)}%`],
      ["feedbackControl", Math.round(state.delayFeedback * 100), "feedbackOutput", `${Math.round(state.delayFeedback * 100)}%`],
      ["reverbControl", Math.round(state.reverb * 100), "reverbOutput", `${Math.round(state.reverb * 100)}%`],
      ["volumeControl", Math.round(state.volume * 100), "volumeOutput", `${Math.round(state.volume * 100)}%`]
    ];
    bindings.forEach(([inputId, value, outputId, label]) => {
      if ($(inputId)) $(inputId).value = String(value);
      if ($(outputId)) $(outputId).textContent = label;
    });
    if (els.labSeed) els.labSeed.value = String(state.seed >>> 0);
    if (els.eventResolution) els.eventResolution.value = String(state.eventResolution);
    if (els.normalizationSelect) els.normalizationSelect.value = state.normalization;
    if (els.rootControl) els.rootControl.value = `${state.root}:${state.scale}`;
    if (els.metronomeToggle) els.metronomeToggle.checked = state.metronome;
  }

  function renderTransport() {
    [els.heroPlay, els.labTransport].filter(Boolean).forEach((button) => button.classList.toggle("is-playing", state.playing));
    const signalLabel = state.playing ? "ОСТАНОВИТЬ СИГНАЛ" : state.pendingStart ? "ЗАПУСКАЮ АУДИО…" : "ПОСЛУШАТЬ ДАННЫЕ";
    const labLabel = state.playing ? "STOP" : state.pendingStart ? "STARTING…" : "PLAY";
    if (els.heroPlayLabel) els.heroPlayLabel.textContent = signalLabel;
    if (els.labTransportLabel) els.labTransportLabel.textContent = labLabel;
    if (els.audioState) {
      els.audioState.textContent = state.playing && state.audioCtx?.state === "running" ? "signal running" : state.pendingStart ? "starting audio" : state.audioCtx?.state === "suspended" ? "tap play to resume" : state.audioCtx ? "audio ready" : "audio asleep";
    }
  }

  function renderView() {
    if (els.signalView) els.signalView.hidden = state.view !== "signal";
    if (els.labView) els.labView.hidden = state.view !== "lab";
    if (els.viewSignalButton) {
      els.viewSignalButton.setAttribute("aria-pressed", String(state.view === "signal"));
      els.viewSignalButton.classList.toggle("is-active", state.view === "signal");
    }
    if (els.viewLabButton) {
      els.viewLabButton.setAttribute("aria-pressed", String(state.view === "lab"));
      els.viewLabButton.classList.toggle("is-active", state.view === "lab");
    }
    document.body.dataset.view = state.view;
    requestAnimationFrame(resizeCanvas);
  }

  function renderAll() {
    renderView();
    renderProfiles();
    renderStructure();
    renderTimeControls();
    renderControlValues();
    renderMatrices();
    renderLayerControls();
    renderEventInspector();
    renderTransport();
    if (els.cycleCount) els.cycleCount.textContent = String(state.cycle).padStart(3, "0");
  }

  function selectProfile(index) {
    state.profileIndex = Number(index);
    state.currentEvent = -1;
    state.selectedEvent = 0;
    state.cycle = 1;
    rebuildMusicalModel();
  }

  function newSlice() {
    state.profileIndex = (state.profileIndex + 1) % source.profiles.length;
    state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
    state.manualOverrides = {};
    state.currentEvent = -1;
    state.selectedEvent = 0;
    state.cycle = 1;
    rebuildMusicalModel();
  }

  function setView(view) {
    state.view = view;
    history.replaceState(null, "", view === "lab" ? "#lab" : "#signal");
    renderView();
  }

  function setTimeMode(mode) {
    if (!new Set(["flow", "pulse", "elastic"]).has(mode)) return;
    state.timeMode = mode;
    rebuildMusicalModel();
  }

  function showStatus(message) {
    const target = $("presetStatus");
    if (!target) return;
    target.textContent = message;
    window.clearTimeout(state.statusTimer);
    state.statusTimer = window.setTimeout(() => { target.textContent = ""; }, 2600);
  }

  function serializablePreset() {
    const keys = Object.keys(DEFAULTS);
    return {
      version: 2,
      parameters: Object.fromEntries(keys.map((key) => [key, state[key]])),
      layers: state.layerState
    };
  }

  function savePreset() {
    localStorage.setItem(PRESET_KEY, JSON.stringify(serializablePreset()));
    showStatus("Preset saved in this browser");
  }

  function loadPreset() {
    try {
      const preset = JSON.parse(localStorage.getItem(PRESET_KEY));
      if (!preset || preset.version !== 2) throw new Error("No compatible preset");
      Object.assign(state, DEFAULTS, preset.parameters || {});
      state.layerState = Object.fromEntries(TRACKS.map((track) => [track.id, { enabled: true, gain: 1, ...(preset.layers?.[track.id] || {}) }]));
      rebuildMusicalModel();
      updateAudioParameters();
      showStatus("Preset loaded");
    } catch (_error) {
      showStatus("No saved preset yet");
    }
  }

  function resetAll() {
    Object.assign(state, DEFAULTS);
    state.manualOverrides = {};
    state.layerState = Object.fromEntries(TRACKS.map((track) => [track.id, { enabled: true, gain: 1 }]));
    state.selectedEvent = 0;
    rebuildMusicalModel();
    updateAudioParameters();
    showStatus("Returned to the Yambda default");
  }

  function createNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0x59414d42;
    for (let index = 0; index < channel.length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      channel[index] = (seed / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  function createImpulse(ctx) {
    const length = Math.floor(ctx.sampleRate * 1.65);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
      const channel = impulse.getChannelData(channelIndex);
      let seed = 0x314159 + channelIndex;
      for (let index = 0; index < length; index += 1) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        channel[index] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - index / length, 2.8);
      }
    }
    return impulse;
  }

  function setAudioState() {
    if (!state.audioCtx) return;
    const contextState = state.audioCtx.state;
    document.body.dataset.audioContext = contextState;
    if (els.statusDot) els.statusDot.classList.toggle("is-on", contextState === "running");
    if (els.engineState) els.engineState.textContent = `${window.webkitAudioContext && !window.AudioContext ? "WebKit" : "Web Audio"} · ${contextState}`;
    renderTransport();
  }

  function resumeAudio() {
    if (!state.audioCtx || state.audioCtx.state === "running") { setAudioState(); return null; }
    try {
      const attempt = state.audioCtx.resume();
      if (attempt?.then) attempt.then(setAudioState).catch(setAudioState);
      return attempt;
    } catch (_error) {
      setAudioState();
      return null;
    }
  }

  function ensureAudio() {
    if (!AudioContextClass) throw new Error("Web Audio API is unavailable");
    if (state.audioCtx) return;
    const ctx = new AudioContextClass();
    const master = ctx.createGain();
    const dry = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    const analyser = ctx.createAnalyser();
    const delayNode = ctx.createDelay(1.2);
    const feedbackNode = ctx.createGain();
    const delayReturn = ctx.createGain();
    const convolver = ctx.createConvolver();
    const reverbReturn = ctx.createGain();

    dry.gain.value = 0.94;
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.19;
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.76;
    delayNode.delayTime.value = 0.24;
    convolver.buffer = createImpulse(ctx);

    master.connect(dry).connect(compressor);
    master.connect(delayNode);
    delayNode.connect(feedbackNode).connect(delayNode);
    delayNode.connect(delayReturn).connect(compressor);
    master.connect(convolver).connect(reverbReturn).connect(compressor);
    compressor.connect(analyser).connect(ctx.destination);

    state.audioCtx = ctx;
    state.master = master;
    state.analyser = analyser;
    state.noiseBuffer = createNoiseBuffer(ctx);
    state.delayNode = delayNode;
    state.delayReturn = delayReturn;
    state.delayFeedbackNode = feedbackNode;
    state.reverbReturn = reverbReturn;
    ctx.onstatechange = setAudioState;
    updateAudioParameters();
    setAudioState();
  }

  function updateAudioParameters() {
    if (!state.audioCtx || !state.master) return;
    const now = state.audioCtx.currentTime;
    state.master.gain.setTargetAtTime(state.volume * 0.55, now, 0.02);
    state.delayReturn.gain.setTargetAtTime(state.delay, now, 0.03);
    state.delayFeedbackNode.gain.setTargetAtTime(state.delayFeedback, now, 0.03);
    state.reverbReturn.gain.setTargetAtTime(state.reverb, now, 0.03);
  }

  function envelope(param, time, peak, attack, release) {
    param.cancelScheduledValues(time);
    param.setValueAtTime(0.0001, time);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
    param.exponentialRampToValueAtTime(0.0001, time + attack + release);
  }

  function playPulse(time, gesture, gainScale) {
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(128 + gesture.normalized.listen * 30, time);
    osc.frequency.exponentialRampToValueAtTime(43, time + 0.14);
    envelope(gain.gain, time, (0.30 + gesture.normalized.listen * 0.28) * gainScale, 0.004, 0.22 + gesture.ratio / 760);
    osc.connect(gain).connect(state.master);
    osc.start(time); osc.stop(time + 0.46);
  }

  function playBreath(time, gesture, gainScale, availableDuration) {
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const release = clamp(availableDuration * 0.78, 0.18, 1.1);
    osc.type = gesture.organic >= 0.5 ? "sine" : "triangle";
    osc.frequency.value = midiToHz(state.root - 12 + Math.round(gesture.normalized.listen * 5));
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(260 + gesture.normalized.listen * 620, time);
    filter.frequency.exponentialRampToValueAtTime(180 + gesture.normalized.listen * 240, time + release);
    envelope(gain.gain, time, (0.09 + gesture.normalized.listen * 0.10) * gainScale, 0.045, release);
    osc.connect(filter).connect(gain).connect(state.master);
    osc.start(time); osc.stop(time + release + 0.09);
  }

  function playBass(time, gesture, gainScale, flow) {
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const scale = SCALES[state.scale] || SCALES.minorPentatonic;
    const note = Number(state.root) + scale[clamp(Math.floor(gesture.normalized.length * scale.length), 0, scale.length - 1)];
    osc.type = gesture.organic >= 0.5 ? "triangle" : "sawtooth";
    sub.type = "sine";
    osc.frequency.setValueAtTime(midiToHz(note), time);
    sub.frequency.setValueAtTime(midiToHz(note - 12), time);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(state.bassCutoff * (0.62 + gesture.normalized.length * 0.55), time);
    filter.Q.value = 2.5;
    const release = flow ? clamp(state.release * 1.55, 0.25, 1.2) : state.release;
    envelope(gain.gain, time, (0.075 + gesture.normalized.length * 0.095) * gainScale, flow ? 0.07 : 0.012, release);
    osc.connect(filter); sub.connect(filter); filter.connect(gain).connect(state.master);
    osc.start(time); sub.start(time); osc.stop(time + release + 0.12); sub.stop(time + release + 0.12);
  }

  function playDiscovery(time, gesture, gainScale, flow) {
    const ctx = state.audioCtx;
    const warm = ctx.createOscillator();
    const digital = ctx.createOscillator();
    const warmGain = ctx.createGain();
    const digitalGain = ctx.createGain();
    const sum = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const organicMix = clamp(gesture.organic * state.warmth + (1 - state.warmth) * 0.5, 0, 1);
    const frequency = midiToHz(Number(state.root) + 24 + Math.round(gesture.normalized.discovery * 7));
    warm.type = "sine"; digital.type = "square";
    warm.frequency.value = frequency; digital.frequency.value = frequency * (1.005 + state.fmIndex * 0.012);
    warmGain.gain.value = Math.sin(organicMix * Math.PI * 0.5);
    digitalGain.gain.value = Math.cos(organicMix * Math.PI * 0.5) * 0.34;
    filter.type = "lowpass"; filter.frequency.value = lerp(1200, 3200, organicMix);
    const release = flow ? 0.48 : 0.11;
    envelope(gain.gain, time, 0.06 * gainScale, flow ? 0.025 : 0.002, release);
    warm.connect(warmGain).connect(sum); digital.connect(digitalGain).connect(sum);
    sum.connect(filter).connect(gain).connect(state.master);
    warm.start(time); digital.start(time); warm.stop(time + release + 0.1); digital.stop(time + release + 0.1);
  }

  function playFeedback(time, gesture, gainScale, kind = gesture.feedback) {
    const ctx = state.audioCtx;
    const rarityGain = clamp(state.rarity, 0.5, 3);
    if (kind > 0) {
      const carrier = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const gain = ctx.createGain();
      const note = Number(state.root) + 36 + (gesture.delta % 5);
      carrier.type = "sine"; overtone.type = "sine";
      carrier.frequency.value = midiToHz(note); overtone.frequency.value = midiToHz(note) * 2.01;
      envelope(gain.gain, time, 0.07 * rarityGain * gainScale, 0.003, 0.52 + state.release * 0.25);
      carrier.connect(gain).connect(state.master); overtone.connect(gain);
      carrier.start(time); overtone.start(time); carrier.stop(time + 0.78); overtone.stop(time + 0.78);
    } else {
      const noise = ctx.createBufferSource();
      const band = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      noise.buffer = state.noiseBuffer;
      band.type = "bandpass"; band.frequency.value = kind < 0 ? 880 : 3100; band.Q.value = kind < 0 ? 4.1 : 1.2;
      envelope(gain.gain, time, (kind < 0 ? 0.075 : 0.035) * rarityGain * gainScale, 0.002, kind < 0 ? 0.24 : 0.08);
      noise.connect(band).connect(gain).connect(state.master);
      noise.start(time); noise.stop(time + 0.32);
    }
  }

  function playGuide(time, strong) {
    if (!state.metronome || state.timeMode === "flow") return;
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine"; osc.frequency.value = strong ? 1320 : 940;
    envelope(gain.gain, time, state.metronomeLevel * (strong ? 0.12 : 0.075), 0.001, 0.025);
    osc.connect(gain).connect(state.master);
    osc.start(time); osc.stop(time + 0.04);
  }

  function scheduleGesture(entry, time) {
    const gesture = entry.gesture;
    const activeTracks = TRACKS.filter((track) => trackActive(track.id, gesture));
    const compensation = Math.sqrt(2 / Math.max(2, activeTracks.length));
    const flow = state.timeMode !== "pulse";
    const nextEntry = state.timeline.entries[entry.index + 1];
    const availableDuration = nextEntry ? Math.max(0.12, nextEntry.offset - entry.offset) : state.timeline.medianInterval * state.endBreath;
    activeTracks.forEach((track) => {
      const gainScale = compensation * state.layerState[track.id].gain;
      if (track.id === "listen") flow ? playBreath(time, gesture, gainScale, availableDuration) : playPulse(time, gesture, gainScale);
      if (track.id === "length") playBass(time, gesture, gainScale, flow);
      if (track.id === "discovery") playDiscovery(time, gesture, gainScale, flow);
      if (track.id === "feedback") {
        if (gesture.landmarks.length) {
          const spacing = Math.min(0.10, availableDuration / Math.max(2, gesture.landmarks.length + 1));
          gesture.landmarks.forEach((landmark, landmarkIndex) => playFeedback(time + landmarkIndex * spacing, gesture, gainScale, landmark.type));
        } else {
          playFeedback(time, gesture, gainScale);
        }
      }
    });
    if (state.scene.stage.id === "swarm") {
      if (gesture.replay) {
        const repeats = 1 + Math.min(2, Math.floor(Math.max(0, gesture.ratio - 100) / 25));
        for (let index = 0; index < repeats; index += 1) playFeedback(time + 0.10 + index * 0.09, gesture, compensation * 0.45, 1);
      }
      if (gesture.transition && seededNoise(entry.index, 11) < state.scene.stage.ornament) playDiscovery(time + Math.min(0.12, availableDuration * 0.28), gesture, compensation * 0.4, true);
    }
    const guideStride = Math.max(1, state.timeline.entries.length / 4);
    if (entry.index % guideStride === 0) playGuide(time, entry.index === 0);
    const wait = Math.max(0, (time - state.audioCtx.currentTime) * 1000);
    state.uiTimers.push(window.setTimeout(() => paintCurrentEvent(entry.index), wait));
  }

  function paintCurrentEvent(index) {
    state.currentEvent = index;
    if (els.orbitStep) els.orbitStep.textContent = String(index + 1).padStart(2, "0");
    document.querySelectorAll(".step.is-current").forEach((cell) => cell.classList.remove("is-current"));
    document.querySelectorAll(`.step[data-event="${index}"]`).forEach((cell) => cell.classList.add("is-current"));
  }

  function scheduler() {
    if (!state.playing || !state.audioCtx || !state.timeline?.entries.length) return;
    while (true) {
      const entry = state.timeline.entries[state.nextTimelineIndex];
      const absoluteTime = state.cycleStartTime + entry.offset;
      if (absoluteTime >= state.audioCtx.currentTime + SCHEDULE_AHEAD) break;
      scheduleGesture(entry, absoluteTime);
      state.nextTimelineIndex += 1;
      if (state.nextTimelineIndex >= state.timeline.entries.length) {
        state.nextTimelineIndex = 0;
        state.cycleStartTime += state.timeline.duration;
        state.cycle += 1;
        if (els.cycleCount) els.cycleCount.textContent = String(state.cycle).padStart(3, "0");
      }
    }
  }

  function restartSchedule() {
    if (!state.audioCtx) return;
    state.uiTimers.forEach(window.clearTimeout);
    state.uiTimers.length = 0;
    state.currentEvent = -1;
    state.nextTimelineIndex = 0;
    state.cycleStartTime = state.audioCtx.currentTime + 0.055;
  }

  function beginPlayback() {
    state.pendingStart = false;
    if (state.playing || state.audioCtx.state !== "running") return;
    state.playing = true;
    restartSchedule();
    state.timer = window.setInterval(scheduler, LOOKAHEAD_MS);
    scheduler();
    renderTransport();
  }

  function start() {
    ensureAudio();
    if (state.playing || state.pendingStart) return;
    if (state.audioCtx.state === "running") { beginPlayback(); return; }
    state.pendingStart = true;
    renderTransport();
    const attempt = resumeAudio();
    if (attempt?.then) attempt.then(() => { if (state.audioCtx.state === "running") beginPlayback(); });
    window.setTimeout(() => {
      if (state.pendingStart && state.audioCtx.state !== "running") {
        state.pendingStart = false;
        renderTransport();
      }
    }, 900);
  }

  function stop() {
    state.playing = false;
    state.pendingStart = false;
    window.clearInterval(state.timer);
    state.timer = null;
    state.uiTimers.forEach(window.clearTimeout);
    state.uiTimers.length = 0;
    renderTransport();
  }

  function togglePlayback() { state.playing ? stop() : start(); }

  function wake() {
    try {
      ensureAudio();
      if (els.wakeLayer) els.wakeLayer.classList.add("is-hidden");
      start();
    } catch (error) {
      if (els.audioState) els.audioState.textContent = "audio unavailable";
      console.error(error);
    }
  }

  function resizeCanvas() {
    const canvas = els.scopeCanvas;
    if (!canvas || canvas.offsetParent === null) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }

  function drawScope() {
    const canvas = els.scopeCanvas;
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) { requestAnimationFrame(drawScope); return; }
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.37;
    ctx.clearRect(0, 0, width, height);
    let waveform = null;
    if (state.analyser) {
      waveform = new Uint8Array(state.analyser.fftSize);
      state.analyser.getByteTimeDomainData(waveform);
    }
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#efff72";
    ctx.lineWidth = Math.max(1, width / 420);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = state.playing ? 0.82 : 0.38;
    ctx.beginPath();
    for (let index = 0; index <= 180; index += 1) {
      const ratio = index / 180;
      const angle = ratio * Math.PI * 2 - Math.PI / 2;
      const sample = waveform ? (waveform[Math.floor(ratio * (waveform.length - 1))] - 128) / 128 : Math.sin(angle * 5 + state.visualPhase) * 0.05;
      const r = radius + sample * radius * (state.playing ? 0.30 : 1);
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
    const timeline = state.timeline?.entries || [];
    timeline.forEach((entry, index) => {
      const progress = state.timeline.duration ? entry.offset / state.timeline.duration : index / Math.max(1, timeline.length);
      const angle = progress * Math.PI * 2 - Math.PI / 2;
      const active = index === state.currentEvent;
      const selected = index === state.selectedEvent;
      ctx.beginPath();
      ctx.fillStyle = currentProfile().accent;
      ctx.globalAlpha = active ? 1 : selected ? 0.8 : 0.42;
      ctx.arc(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, (active ? 5 : selected ? 3.5 : 2.2) * Math.max(1, width / 500), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    state.visualPhase += 0.018;
    requestAnimationFrame(drawScope);
  }

  function bindRange(id, stateKey, transform, { rebuild = false, audio = false } = {}) {
    const input = $(id);
    if (!input) return;
    input.addEventListener("input", () => {
      state[stateKey] = transform(Number(input.value));
      if (audio) updateAudioParameters();
      rebuild ? rebuildMusicalModel() : renderAll();
    });
  }

  function bindControls() {
    els.wakeButton?.addEventListener("click", wake);
    els.heroPlay?.addEventListener("click", togglePlayback);
    els.labTransport?.addEventListener("click", togglePlayback);
    els.randomize?.addEventListener("click", newSlice);
    els.viewSignalButton?.addEventListener("click", () => setView("signal"));
    els.viewLabButton?.addEventListener("click", () => setView("lab"));
    document.querySelectorAll("[data-time-mode]").forEach((button) => button.addEventListener("click", () => setTimeMode(button.dataset.timeMode)));
    els.scoreToggle?.addEventListener("click", () => {
      if (!els.scorePanel) return;
      els.scorePanel.hidden = !els.scorePanel.hidden;
      els.scoreToggle.setAttribute("aria-expanded", String(!els.scorePanel.hidden));
      if (els.scoreTitle) els.scoreTitle.textContent = els.scorePanel.hidden ? "SHOW SCORE" : "HIDE SCORE";
    });
    els.labProfileSelect?.addEventListener("change", () => selectProfile(Number(els.labProfileSelect.value)));
    els.labSeed?.addEventListener("change", () => { state.seed = Number(els.labSeed.value) >>> 0; rebuildMusicalModel(); });
    els.eventResolution?.addEventListener("change", () => { state.eventResolution = Number(els.eventResolution.value); rebuildMusicalModel(); });
    els.normalizationSelect?.addEventListener("change", () => { state.normalization = els.normalizationSelect.value; rebuildMusicalModel(); });
    els.metronomeToggle?.addEventListener("change", () => { state.metronome = els.metronomeToggle.checked; renderControlValues(); });
    els.rootControl?.addEventListener("change", () => {
      const [root, scale] = els.rootControl.value.split(":");
      state.root = Number(root);
      state.scale = SCALES[scale] ? scale : DEFAULTS.scale;
      renderControlValues();
    });
    els.savePreset?.addEventListener("click", savePreset);
    els.loadPreset?.addEventListener("click", loadPreset);
    els.resetAll?.addEventListener("click", resetAll);

    [els.structureControl, els.labStructureControl].filter(Boolean).forEach((input) => input.addEventListener("input", () => { state.structure = Number(input.value); rebuildMusicalModel(); }));
    bindRange("bpmControl", "bpm", (value) => value, { rebuild: true });
    bindRange("swingControl", "swing", (value) => value / 100, { rebuild: true });
    bindRange("paceControl", "pace", (value) => value / 100, { rebuild: true });
    bindRange("quantizeControl", "quantize", (value) => value / 100, { rebuild: true });
    bindRange("breathControl", "endBreath", (value) => value / 100, { rebuild: true });
    bindRange("metronomeLevel", "metronomeLevel", (value) => value / 100);
    bindRange("rarityControl", "rarity", (value) => value / 100);
    bindRange("bassCutoffControl", "bassCutoff", (value) => value);
    bindRange("releaseControl", "release", (value) => value / 1000);
    bindRange("warmthControl", "warmth", (value) => value / 100);
    bindRange("fmIndexControl", "fmIndex", (value) => value / 100);
    bindRange("delayControl", "delay", (value) => value / 100, { audio: true });
    bindRange("feedbackControl", "delayFeedback", (value) => value / 100, { audio: true });
    bindRange("reverbControl", "reverb", (value) => value / 100, { audio: true });
    bindRange("volumeControl", "volume", (value) => value / 100, { audio: true });

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("hashchange", () => setView(location.hash === "#lab" ? "lab" : "signal"));
    document.addEventListener("visibilitychange", () => { if (!document.hidden && state.playing) resumeAudio(); });
  }

  state.scene = buildScene();
  state.timeline = buildTimeline();
  bindControls();
  renderAll();
  resizeCanvas();
  drawScope();

  window.__YAMBDA_DEBUG__ = {
    getState: () => ({
      view: state.view,
      playing: state.playing,
      audioState: state.audioCtx?.state || "uninitialized",
      profile: currentProfile().id,
      structure: state.structure,
      structureStage: state.scene.stage.id,
      timeMode: state.timeMode,
      gestures: state.scene.gestures.length,
      cycleDuration: Number(state.timeline.duration.toFixed(3)),
      currentEvent: state.currentEvent,
      cycle: state.cycle
    }),
    getScene: () => state.scene,
    getTimeline: () => state.timeline,
    source
  };
})();
