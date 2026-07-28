"use strict";

(function startWordstatSequencerV2() {
  const SOURCE = window.WORDSTAT_SEQUENCE;
  const PARAMETERS = window.WORDSTAT_PARAMETERS;
  const EVENT_ENGINE = window.WORDSTAT_EVENT_ENGINE;
  const STEPS = 16;
  const PROFILE_KEYS = new Set(["voiceBudget", "eventRate", "variation", "polyphony", "pitchSpan", "space", "responseDepth", "detail"]);
  const STORAGE_KEY = "wordstat-seq-v2-settings";
  const SCENE_RECIPES = {
    connection: { timeMode: "grid", structureIndex: 2, quantize: 0.86, swing: 0.12, jitter: 0.012, behavior: "общий пульс" },
    chance: { timeMode: "free", structureIndex: 4, quantize: 0.06, swing: 0, jitter: 0.055, behavior: "независимые часы" },
    feedback: { timeMode: "elastic", structureIndex: 3, quantize: 0.24, swing: 0, jitter: 0.028, behavior: "эластичный вопрос–ответ" }
  };
  const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function midiToHz(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function midiName(note) {
    const rounded = Math.round(note);
    return NOTE_NAMES[((rounded % 12) + 12) % 12] + (Math.floor(rounded / 12) - 1);
  }

  function escapeText(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHtml(value) {
    return escapeText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function pluralRu(number, one, few, many) {
    const absolute = Math.abs(number) % 100;
    const last = absolute % 10;
    if (absolute > 10 && absolute < 20) return many;
    if (last === 1) return one;
    if (last > 1 && last < 5) return few;
    return many;
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  class WordstatSequencerV2 {
    constructor() {
      if (!SOURCE || !PARAMETERS || !EVENT_ENGINE) {
        throw new Error("Wordstat / Seq modules are incomplete");
      }

      this.data = {
        meta: Object.assign({}, SOURCE.meta),
        weeks: SOURCE.weeks.slice(),
        scenes: SOURCE.scenes.map((scene) => Object.assign({}, scene, { terms: scene.terms.slice() })),
        terms: SOURCE.terms.map((term, index) => Object.assign({}, term, { engineIndex: index, values: term.values.slice() }))
      };
      this.params = PARAMETERS.mergeProfile(PARAMETERS.DEFAULTS, 2, new Set());
      this.state = { scene: "connection", seed: 92831, view: location.hash === "#advanced" ? "advanced" : "basic" };
      this.activeTerms = new Set(this.data.scenes[0].terms);
      this.pinned = new Set();
      this.muted = new Set();
      this.soloed = new Set();
      this.overrides = new Map();
      this.locked = new Set();
      this.trackSettings = new Map();
      this.plan = { duration: 1, events: [] };
      this.planKeys = new Set();
      this.ctx = null;
      this.master = null;
      this.delay = null;
      this.reverb = null;
      this.noiseBuffer = null;
      this.isPlaying = false;
      this.schedulerTimer = null;
      this.cycleStart = 0;
      this.planIndex = 0;
      this.cycle = 1;
      this.transportGeneration = 0;
      this.uiTimers = new Set();
      this.activeVoiceEnds = [];
      this.currentEvent = null;
      this.currentPeriod = 0;
      this.lastEventAt = new Map();
      this.recentEvents = [];
      this.toastTimer = null;
      this.rebuildTimer = null;
      this.visualFrame = null;
      this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      this.cacheElements();
      this.restoreSettings();
      this.ensureTrackSettings();
      this.renderAdvancedShell();
      this.bindEvents();
      this.buildPlan();
      this.renderAll();
      this.setupCanvases();
      this.setView(this.state.view, false);
      this.visualLoop();
    }

    cacheElements() {
      const ids = [
        "basicView", "advancedView", "basicViewButton", "advancedViewButton", "engineDot", "engineText",
        "heroPlay", "heroPlayLabel", "surpriseButton", "trendCanvas", "trendDirection", "weekLabel", "pulseCount",
        "csvInput", "dataBadge", "dataNoticeText", "sceneTabs", "structureControl", "structureOut", "structureIndex",
        "structureSummary", "timeModeTabs", "timeModeOut", "cycleDurationOut", "timeDescription", "fieldCanvas",
        "fieldLegend", "fieldModeHint", "nowPlayingLabel", "phraseToggle", "activeCount", "transportButton",
        "transportLabel", "phrasePanel", "closePhrasePanel", "termSearch", "termList", "gridSection", "weekRuler",
        "trackList", "cycleCount", "advancedTransportButton", "advancedTransportLabel", "exportSettingsButton",
        "advancedNav", "advancedPatchName", "advancedStatusText", "relinkButton", "advancedControls", "inspectorDot",
        "inspectorTerm", "inspectorPeriod", "inspectorVelocity", "inspectorPitch", "inspectorFilter", "inspectorTime",
        "inspectorSource", "inspectorCanvas", "mixerList", "mixerCount", "eventCountDiagnostic", "responseCountDiagnostic", "durationDiagnostic",
        "polyphonyDiagnostic", "wakeLayer", "wakeButton", "toast"
      ];
      this.el = {};
      ids.forEach((id) => { this.el[id] = document.getElementById(id); });
    }

    restoreSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (!saved || saved.version !== 2) return;
        if (saved.params) this.params = PARAMETERS.clampState(Object.assign({}, this.params, saved.params));
        if (Number.isFinite(saved.seed)) this.state.seed = saved.seed >>> 0;
        if (typeof saved.scene === "string") this.state.scene = saved.scene;
        if (Array.isArray(saved.pinned)) this.pinned = new Set(saved.pinned.filter((id) => PROFILE_KEYS.has(id)));
        const validIds = new Set(this.data.terms.map((term) => term.id));
        if (Array.isArray(saved.activeTerms)) {
          const restored = saved.activeTerms.filter((id) => validIds.has(id));
          if (restored.length) this.activeTerms = new Set(restored);
        }
      } catch (error) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    persistSettings() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: 2,
          params: this.params,
          seed: this.state.seed,
          scene: this.state.scene,
          pinned: Array.from(this.pinned),
          activeTerms: Array.from(this.activeTerms)
        }));
      } catch (error) {
        // The instrument remains fully functional without persistence.
      }
    }

    ensureTrackSettings() {
      this.data.terms.forEach((term, index) => {
        if (!this.trackSettings.has(term.id)) {
          this.trackSettings.set(term.id, {
            gain: 0.82,
            pan: clamp(((index % 7) - 3) / 4, -0.75, 0.75)
          });
        }
      });
    }

    bindEvents() {
      this.el.wakeButton.addEventListener("click", () => this.wakeAudio(true));
      this.el.heroPlay.addEventListener("click", () => this.togglePlayback());
      this.el.transportButton.addEventListener("click", () => this.togglePlayback());
      this.el.advancedTransportButton.addEventListener("click", () => this.togglePlayback());
      this.el.surpriseButton.addEventListener("click", () => this.newVersion());
      this.el.basicViewButton.addEventListener("click", () => this.setView("basic", true));
      this.el.advancedViewButton.addEventListener("click", () => this.setView("advanced", true));
      this.el.phraseToggle.addEventListener("click", () => this.togglePhrasePanel());
      this.el.closePhrasePanel.addEventListener("click", () => this.togglePhrasePanel(false));
      this.el.termSearch.addEventListener("input", () => this.renderTermList());
      this.el.csvInput.addEventListener("change", (event) => this.importCsv(event));
      this.el.exportSettingsButton.addEventListener("click", () => this.exportSettings());
      this.el.relinkButton.addEventListener("click", () => this.relinkProfile());

      this.el.structureControl.addEventListener("input", () => {
        this.params = PARAMETERS.mergeProfile(this.params, Number(this.el.structureControl.value), this.pinned);
        this.updateStructureUI();
        this.renderAdvancedValues();
      });
      this.el.structureControl.addEventListener("change", () => this.commitParameterChange("Структура изменила оркестровку"));

      this.el.timeModeTabs.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-time-mode]");
        if (!button) return;
        this.setTimeMode(button.dataset.timeMode);
      });

      window.addEventListener("resize", () => {
        this.drawTrend();
        this.drawInspectorCurve();
      });
      window.addEventListener("hashchange", () => this.setView(location.hash === "#advanced" ? "advanced" : "basic", false));
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.isPlaying) this.stop();
      });
    }

    renderAll() {
      this.renderSceneTabs();
      this.renderTermList();
      this.renderWeekRuler();
      this.renderTracks();
      this.updateStructureUI();
      this.updateTimeUI();
      this.updateTransport();
      this.renderAdvancedValues();
      this.renderMixer();
      this.updateDiagnostics();
      this.drawTrend();
      this.drawInspectorCurve();
    }

    setView(view, updateHash) {
      this.state.view = view === "advanced" ? "advanced" : "basic";
      const advanced = this.state.view === "advanced";
      this.el.basicView.hidden = advanced;
      this.el.advancedView.hidden = !advanced;
      this.el.basicViewButton.classList.toggle("is-active", !advanced);
      this.el.advancedViewButton.classList.toggle("is-active", advanced);
      if (updateHash) history.replaceState(null, "", advanced ? "#advanced" : location.pathname + location.search);
      if (advanced) this.renderAdvancedValues();
      window.scrollTo({ top: 0, behavior: this.reducedMotion ? "auto" : "smooth" });
    }

    renderSceneTabs() {
      this.el.sceneTabs.textContent = "";
      this.data.scenes.forEach((scene) => {
        const recipe = SCENE_RECIPES[scene.id];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scene-tab" + (scene.id === this.state.scene ? " is-active" : "");
        button.dataset.scene = scene.id;
        const note = recipe ? recipe.behavior : scene.note;
        button.innerHTML = "<b>" + escapeHtml(scene.name) + "</b><small>" + escapeHtml(note) + "</small>";
        button.addEventListener("click", () => this.selectScene(scene));
        this.el.sceneTabs.appendChild(button);
      });
    }

    selectScene(scene) {
      this.state.scene = scene.id;
      this.activeTerms = new Set(scene.terms.filter((id) => this.termById(id)));
      this.muted.clear();
      this.soloed.clear();
      const recipe = SCENE_RECIPES[scene.id];
      if (recipe) {
        this.params = PARAMETERS.mergeProfile(this.params, recipe.structureIndex, this.pinned);
        this.params.timeMode = recipe.timeMode;
        this.params.quantize = recipe.quantize;
        this.params.swing = recipe.swing;
        this.params.jitter = recipe.jitter;
        if (recipe.timeMode !== "grid") this.params.metronome = false;
      }
      this.commitParameterChange("«" + scene.name.toLowerCase() + "» — " + (recipe ? recipe.behavior : scene.note).toLowerCase());
    }

    setTimeMode(mode) {
      if (!PARAMETERS.TIME_MODES[mode] || mode === this.params.timeMode) return;
      this.params.timeMode = mode;
      this.params.quantize = mode === "grid" ? 0.86 : mode === "elastic" ? 0.24 : 0.06;
      if (mode !== "grid") this.params.metronome = false;
      this.commitParameterChange(PARAMETERS.TIME_MODES[mode].title + " — новый способ организации времени");
    }

    updateStructureUI() {
      const profile = PARAMETERS.profileAt(this.params.structureIndex);
      const description = PARAMETERS.describeStructure(this.params, this.activeTerms.size);
      const custom = this.pinned.size > 0;
      this.el.structureControl.value = String(profile.index);
      this.el.structureControl.style.background = "linear-gradient(90deg, var(--yellow) 0 " + (profile.index * 25) + "%, var(--line-dark) " + (profile.index * 25) + "% 100%)";
      this.el.structureOut.textContent = profile.name + (custom ? " · CUSTOM" : "");
      this.el.structureIndex.textContent = String(profile.index + 1).padStart(2, "0") + " / 05";
      const eventCount = this.plan.events.filter((event) => event.source !== "metronome").length;
      this.el.structureSummary.textContent = this.activeTerms.size + " " + pluralRu(this.activeTerms.size, "фраза", "фразы", "фраз")
        + " → " + description.voiceCount + " " + pluralRu(description.voiceCount, "голос", "голоса", "голосов")
        + " · " + eventCount + " " + pluralRu(eventCount, "событие", "события", "событий")
        + " · " + description.variationLabel;
      this.el.advancedPatchName.textContent = profile.name + " / " + PARAMETERS.TIME_MODES[this.params.timeMode].label;
      this.el.advancedStatusText.textContent = this.activeTerms.size + " фраз · " + description.voiceCount + " голосов · seed " + this.state.seed;
    }

    updateTimeUI() {
      const metadata = PARAMETERS.TIME_MODES[this.params.timeMode];
      this.el.timeModeOut.textContent = metadata.label;
      this.el.timeDescription.textContent = metadata.note + (this.params.timeMode === "grid" ? (this.params.metronome ? " Контрольный клик включён." : " Контрольный клик выключен.") : "");
      this.el.cycleDurationOut.textContent = this.plan.duration.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " SEC";
      this.el.fieldModeHint.textContent = this.params.timeMode === "grid" ? "общая вертикаль = текущий период" : this.params.timeMode === "elastic" ? "расстояние = скорость изменения спроса" : "каждое слово живёт в собственном времени";
      this.el.gridSection.classList.toggle("is-source-map", this.params.timeMode !== "grid");
      this.el.timeModeTabs.querySelectorAll("button[data-time-mode]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.timeMode === this.params.timeMode);
      });
    }

    togglePhrasePanel(force) {
      const shouldOpen = typeof force === "boolean" ? force : this.el.phrasePanel.hidden;
      this.el.phrasePanel.hidden = !shouldOpen;
      this.el.phraseToggle.setAttribute("aria-expanded", String(shouldOpen));
      if (shouldOpen) this.el.termSearch.focus();
    }

    renderTermList() {
      const query = this.el.termSearch.value.trim().toLocaleLowerCase("ru");
      this.el.termList.textContent = "";
      this.data.terms.forEach((term) => {
        const button = document.createElement("button");
        const hidden = query && !term.phrase.toLocaleLowerCase("ru").includes(query);
        button.type = "button";
        button.className = "term-chip" + (this.activeTerms.has(term.id) ? " is-active" : "") + (hidden ? " is-hidden" : "");
        button.style.setProperty("--chip", term.color);
        button.setAttribute("aria-pressed", String(this.activeTerms.has(term.id)));
        button.innerHTML = "<i aria-hidden=\"true\"></i><span>" + escapeHtml(term.phrase) + "</span>";
        button.addEventListener("click", () => this.toggleTerm(term.id));
        this.el.termList.appendChild(button);
      });
      this.el.activeCount.textContent = String(this.activeTerms.size);
    }

    toggleTerm(id) {
      if (this.activeTerms.has(id)) {
        if (this.activeTerms.size === 1) {
          this.showToast("Оставьте хотя бы одну фразу — иначе поле замолчит.");
          return;
        }
        this.activeTerms.delete(id);
      } else {
        this.activeTerms.add(id);
      }
      this.state.scene = "custom";
      this.commitParameterChange("Состав поля изменён");
    }

    termById(id) {
      return this.data.terms.find((term) => term.id === id);
    }

    activeTermObjects() {
      return this.data.terms.filter((term) => this.activeTerms.has(term.id));
    }

    audibleTermObjects() {
      const terms = this.activeTermObjects();
      if (this.soloed.size) return terms.filter((term) => this.soloed.has(term.id));
      return terms.filter((term) => !this.muted.has(term.id));
    }

    renderWeekRuler() {
      this.el.weekRuler.textContent = "";
      for (let step = 0; step < STEPS; step += 1) {
        const span = document.createElement("span");
        span.textContent = String(step + 1).padStart(2, "0");
        span.title = this.data.weeks[step] || "Период " + (step + 1);
        this.el.weekRuler.appendChild(span);
      }
    }

    renderTracks() {
      this.el.trackList.textContent = "";
      this.activeTermObjects().forEach((term) => {
        const row = document.createElement("div");
        row.className = "track-row" + (this.muted.has(term.id) ? " is-muted" : "");
        row.dataset.term = term.id;
        row.style.setProperty("--track", term.color);

        const name = document.createElement("div");
        name.className = "track-name";
        const latest = term.values[term.values.length - 1] || 0;
        name.innerHTML = "<i aria-hidden=\"true\"></i><div><b>" + escapeHtml(term.phrase) + "</b><small>" + latest.toLocaleString("ru-RU") + " · ИНДЕКС " + Math.round(term.affinity || 100) + "%</small></div>";
        const mute = document.createElement("button");
        mute.type = "button";
        mute.className = "track-mute";
        mute.textContent = this.muted.has(term.id) ? "ON" : "MUTE";
        mute.addEventListener("click", () => {
          if (this.muted.has(term.id)) this.muted.delete(term.id); else this.muted.add(term.id);
          this.commitParameterChange("Канал «" + term.phrase + "» " + (this.muted.has(term.id) ? "выключен" : "включён"), false);
        });
        name.appendChild(mute);
        row.appendChild(name);

        term.values.slice(0, STEPS).forEach((count, periodIndex) => {
          const key = term.id + ":" + periodIndex;
          const active = this.planKeys.has(key);
          const intensity = this.termIntensity(term, periodIndex);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "step" + (active ? "" : " is-off") + (this.locked.has(key) ? " is-locked" : "") + (periodIndex === this.currentPeriod && this.isPlaying ? " is-current" : "");
          button.style.setProperty("--size", (10 + intensity * 28).toFixed(1) + "px");
          button.style.setProperty("--power", (0.3 + intensity * 0.7).toFixed(2));
          button.dataset.period = String(periodIndex);
          button.title = (this.data.weeks[periodIndex] || "Период " + (periodIndex + 1)) + ": " + Math.round(count).toLocaleString("ru-RU") + " запросов";
          button.setAttribute("aria-label", term.phrase + ", " + button.title + ", " + (active ? "есть событие" : "нет события"));
          button.innerHTML = "<i aria-hidden=\"true\"></i>";
          button.addEventListener("click", (event) => this.toggleStep(term, periodIndex, event.shiftKey));
          row.appendChild(button);
        });
        this.el.trackList.appendChild(row);
      });
    }

    toggleStep(term, periodIndex, lock) {
      if (this.params.timeMode !== "grid") {
        this.showToast("В «Дыхании» и «Поле» период — источник события, а не музыкальная ячейка. Редактирование доступно в «Сетке».");
        return;
      }
      const key = term.id + ":" + periodIndex;
      if (lock) {
        if (this.locked.has(key)) this.locked.delete(key); else this.locked.add(key);
      } else {
        const current = this.overrides.has(key) ? this.overrides.get(key) : this.planKeys.has(key);
        this.overrides.set(key, !current);
      }
      this.commitParameterChange("Событие изменено вручную", false);
    }

    termIntensity(term, periodIndex) {
      const values = term.values.slice(0, STEPS);
      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      if (max === min) return 0.6;
      return clamp(((term.values[periodIndex] || min) - min) / (max - min), 0, 1);
    }

    buildPlan() {
      const terms = this.activeTermObjects();
      const rawPlan = EVENT_ENGINE.buildEventPlan({
        terms: terms,
        weeks: this.data.weeks,
        params: this.params,
        seed: this.state.seed
      });
      let events = rawPlan.events.map((event) => Object.assign({}, event));
      const duration = Math.max(0.5, Number(rawPlan.duration) || 1);

      if (this.params.timeMode === "grid") {
        events = events.filter((event) => this.overrides.get(event.termId + ":" + event.periodIndex) !== false);
        this.overrides.forEach((enabled, key) => {
          if (!enabled) return;
          const parts = key.split(":");
          const term = this.termById(parts[0]);
          const periodIndex = Number(parts[1]);
          if (!term || events.some((event) => event.termId === term.id && event.periodIndex === periodIndex)) return;
          events.push(this.manualEvent(term, periodIndex, duration));
        });
      }

      events = events.concat(this.buildResponseEvents(events, duration, terms));

      if (this.params.metronome && this.params.timeMode === "grid") {
        const stepDuration = duration / STEPS;
        for (let periodIndex = 0; periodIndex < STEPS; periodIndex += 1) {
          events.push({ termId: null, termIndex: -1, periodIndex: periodIndex, atSeconds: periodIndex * stepDuration, velocity: periodIndex % 4 === 0 ? 0.72 : 0.38, noteOffset: 0, brightness: 1, pan: 0, kind: "metronome", source: "metronome" });
        }
      }

      events.sort((a, b) => a.atSeconds - b.atSeconds || a.termIndex - b.termIndex);
      this.plan = { duration: duration, events: events };
      this.planKeys = new Set(events.filter((event) => event.termId).map((event) => event.termId + ":" + event.periodIndex));
      if (EVENT_ENGINE.validatePlan) {
        const validation = EVENT_ENGINE.validatePlan({
          duration: duration,
          events: events.filter((event) => event.source === "data" || event.source === "response")
        });
        if (validation && validation.valid === false) console.warn("Invalid event plan", validation.errors || validation);
      }
    }

    buildResponseEvents(events, duration, terms) {
      const depth = clamp(Number(this.params.responseDepth) || 0, 0, 1);
      const sourceEvents = events.filter((event) => event.termId && event.source !== "metronome");
      const soundingIds = Array.from(new Set(sourceEvents.map((event) => event.termId)));
      if (depth <= 0 || soundingIds.length < 2 || !sourceEvents.length) return [];

      const byId = new Map(terms.map((term) => [term.id, term]));
      const random = seededRandom((this.state.seed ^ 0xa5b35705 ^ Math.round(depth * 1000)) >>> 0);
      const maximum = Math.max(1, Math.ceil(sourceEvents.length * depth * 0.28));
      const responseChance = depth * (0.1 + this.params.variation * 0.24);
      const stepDuration = duration / STEPS;
      const intervals = [2, 3, 5, 7, 10];
      const responses = [];

      sourceEvents.forEach((parent) => {
        if (responses.length >= maximum || random() > responseChance) return;
        const candidates = soundingIds.filter((id) => id !== parent.termId);
        const targetId = candidates[Math.floor(random() * candidates.length)];
        const target = byId.get(targetId);
        if (!target) return;

        let delay;
        if (this.params.timeMode === "grid") {
          delay = stepDuration * (random() > 0.58 ? 1 : 0.5);
        } else if (this.params.timeMode === "elastic") {
          delay = 0.16 + random() * Math.min(1.8, duration * 0.09);
        } else {
          delay = 0.12 + random() * Math.min(2.8, duration * 0.16);
        }
        const atSeconds = parent.atSeconds + delay;
        if (atSeconds >= duration - 0.015) return;

        const direction = random() > 0.38 ? 1 : -1;
        const interval = intervals[Math.floor(random() * intervals.length)] * direction;
        responses.push({
          termId: target.id,
          termIndex: Number.isFinite(target.engineIndex) ? target.engineIndex : terms.indexOf(target),
          periodIndex: parent.periodIndex,
          atSeconds: atSeconds,
          velocity: clamp(parent.velocity * (0.42 + random() * 0.28), 0.08, 0.72),
          noteOffset: (parent.noteOffset || 0) + interval,
          brightness: clamp((target.affinity || 100) / 180, 0.3, 1),
          pan: clamp(((target.engineIndex || 0) % 5 - 2) * 0.24, -0.72, 0.72),
          kind: target.group || "feedback",
          source: "response",
          parentTermId: parent.termId,
          _priority: (parent._priority || parent.velocity || 0.5) * 0.64
        });
      });
      return responses;
    }

    manualEvent(term, periodIndex, duration) {
      const intensity = this.termIntensity(term, periodIndex);
      const previous = term.values[Math.max(0, periodIndex - 1)] || term.values[periodIndex] || 1;
      const delta = clamp(((term.values[periodIndex] || previous) - previous) / Math.max(1, previous), -0.25, 0.25);
      const stepDuration = duration / STEPS;
      const swing = periodIndex % 2 ? stepDuration * this.params.swing : 0;
      return {
        termId: term.id,
        termIndex: term.engineIndex,
        periodIndex: periodIndex,
        atSeconds: periodIndex * stepDuration + swing,
        velocity: 0.3 + intensity * 0.55,
        noteOffset: Math.round(delta * this.params.pitchSpan) + (term.engineIndex % 5),
        brightness: clamp((term.affinity || 100) / 180, 0.3, 1),
        pan: clamp(((term.engineIndex % 7) - 3) / 4, -0.75, 0.75),
        kind: term.group || "connection",
        source: "manual",
        probability: 1
      };
    }

    commitParameterChange(message, persist) {
      this.params = PARAMETERS.clampState(this.params);
      this.buildPlan();
      this.ensureTrackSettings();
      this.renderAll();
      this.restartTransportIfNeeded();
      if (persist !== false) this.persistSettings();
      if (message) this.showToast(message);
    }

    scheduleRebuild(message) {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = window.setTimeout(() => this.commitParameterChange(message || "Параметры применены"), 90);
    }

    restartTransportIfNeeded() {
      if (!this.isPlaying || !this.ctx) return;
      this.transportGeneration += 1;
      if (this.schedulerTimer) window.clearInterval(this.schedulerTimer);
      this.clearUiTimers();
      this.planIndex = 0;
      this.cycle = 1;
      this.cycleStart = this.ctx.currentTime + 0.08;
      this.scheduler();
      this.schedulerTimer = window.setInterval(() => this.scheduler(), 25);
    }

    newVersion() {
      this.state.seed = (this.state.seed * 1664525 + 1013904223) >>> 0;
      this.overrides.forEach((value, key) => { if (!this.locked.has(key)) this.overrides.delete(key); });
      this.commitParameterChange("Та же сцена развивается из нового seed");
    }

    relinkProfile() {
      this.pinned.clear();
      this.params = PARAMETERS.mergeProfile(this.params, this.params.structureIndex, this.pinned);
      this.commitParameterChange("Все параметры снова связаны со структурой");
    }

    renderAdvancedShell() {
      this.el.advancedNav.textContent = "";
      this.el.advancedControls.textContent = "";
      PARAMETERS.ADVANCED_GROUPS.forEach((group, groupIndex) => {
        const navButton = document.createElement("button");
        navButton.type = "button";
        navButton.textContent = group.label;
        navButton.className = groupIndex === 0 ? "is-active" : "";
        navButton.addEventListener("click", () => {
          const target = document.getElementById("advanced-group-" + group.id);
          if (target) target.scrollIntoView({ behavior: this.reducedMotion ? "auto" : "smooth", block: "start" });
          this.el.advancedNav.querySelectorAll("button").forEach((button) => button.classList.toggle("is-active", button === navButton));
        });
        this.el.advancedNav.appendChild(navButton);

        const section = document.createElement("section");
        section.className = "advanced-group";
        section.id = "advanced-group-" + group.id;
        section.innerHTML = "<div class=\"advanced-group-head\"><h2>" + escapeHtml(group.label) + "</h2><span>" + String(groupIndex + 1).padStart(2, "0") + " / " + String(PARAMETERS.ADVANCED_GROUPS.length).padStart(2, "0") + "</span></div>";
        const fields = document.createElement("div");
        fields.className = "advanced-fields";
        group.fields.forEach((field) => fields.appendChild(this.createAdvancedField(field)));
        section.appendChild(fields);
        this.el.advancedControls.appendChild(section);
      });
    }

    createAdvancedField(field) {
      const wrapper = document.createElement("div");
      wrapper.className = "advanced-field";
      wrapper.dataset.param = field.id;
      const head = document.createElement("div");
      head.className = "advanced-field-head";
      const label = document.createElement("label");
      label.htmlFor = "advanced-" + field.id;
      label.textContent = field.label;
      const actions = document.createElement("span");
      const output = document.createElement("output");
      output.id = "advanced-out-" + field.id;
      actions.appendChild(output);
      if (PROFILE_KEYS.has(field.id)) {
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "pin-button";
        pin.dataset.pin = field.id;
        pin.title = "Закрепить параметр относительно макроконтрола";
        pin.textContent = "◇";
        pin.addEventListener("click", () => {
          if (this.pinned.has(field.id)) this.pinned.delete(field.id); else this.pinned.add(field.id);
          this.renderAdvancedValues();
          this.persistSettings();
        });
        actions.appendChild(pin);
      }
      head.append(label, actions);
      wrapper.appendChild(head);

      let input;
      if (field.type === "select") {
        input = document.createElement("select");
        field.options.forEach((option) => {
          const node = document.createElement("option");
          node.value = option.value;
          node.textContent = option.label;
          input.appendChild(node);
        });
      } else if (field.type === "toggle") {
        const toggle = document.createElement("label");
        toggle.className = "toggle-control";
        toggle.innerHTML = "<span>OFF</span>";
        input = document.createElement("input");
        input.type = "checkbox";
        toggle.appendChild(input);
        wrapper.appendChild(toggle);
      } else {
        input = document.createElement("input");
        input.type = "range";
        input.min = field.min;
        input.max = field.max;
        input.step = field.step;
      }
      input.id = "advanced-" + field.id;
      input.dataset.param = field.id;
      input.addEventListener("input", () => this.handleAdvancedInput(field, input, false));
      input.addEventListener("change", () => this.handleAdvancedInput(field, input, true));
      if (field.type !== "toggle") wrapper.appendChild(input);
      return wrapper;
    }

    handleAdvancedInput(field, input, commit) {
      let value;
      if (field.type === "toggle") value = input.checked;
      else if (field.type === "select") value = input.value;
      else value = Number(input.value);

      if (field.id === "structureIndex") {
        this.params = PARAMETERS.mergeProfile(this.params, value, this.pinned);
      } else {
        this.params[field.id] = value;
        if (PROFILE_KEYS.has(field.id)) this.pinned.add(field.id);
      }
      if (field.id === "timeMode" && value !== "grid") this.params.metronome = false;
      this.params = PARAMETERS.clampState(this.params);
      this.applyAudioParams();
      this.updateStructureUI();
      this.updateTimeUI();
      this.renderAdvancedValues();
      if (commit) this.scheduleRebuild(field.label + " — новое значение применено");
    }

    formatField(field, value) {
      if (field.type === "toggle") return value ? "ON" : "OFF";
      if (field.type === "select") {
        const option = field.options.find((item) => item.value === value);
        return option ? option.label : value;
      }
      if (field.format === "percent") return Math.round(value * 100) + "%";
      const digits = field.step && field.step < 0.01 ? 3 : field.step && field.step < 1 ? 2 : 0;
      return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: digits }) + (field.unit ? " " + field.unit : "");
    }

    renderAdvancedValues() {
      PARAMETERS.ADVANCED_GROUPS.forEach((group) => group.fields.forEach((field) => {
        const input = document.getElementById("advanced-" + field.id);
        const output = document.getElementById("advanced-out-" + field.id);
        if (!input || !output) return;
        const unavailableOutsideGrid = (field.id === "metronome" || field.id === "metronomeLevel") && this.params.timeMode !== "grid";
        input.disabled = unavailableOutsideGrid;
        const fieldWrapper = input.closest(".advanced-field");
        if (fieldWrapper) fieldWrapper.classList.toggle("is-disabled", unavailableOutsideGrid);
        if (field.type === "toggle") {
          input.checked = Boolean(this.params[field.id]);
          const text = input.parentElement.querySelector("span");
          if (text) text.textContent = input.checked ? "ON" : "OFF";
        } else input.value = String(this.params[field.id]);
        output.textContent = this.formatField(field, this.params[field.id]);
        const pin = this.el.advancedControls.querySelector("button[data-pin=\"" + field.id + "\"]");
        if (pin) {
          pin.classList.toggle("is-pinned", this.pinned.has(field.id));
          pin.textContent = this.pinned.has(field.id) ? "◆" : "◇";
        }
      }));
      this.updateStructureUI();
      this.updateTimeUI();
      this.updateDiagnostics();
    }

    renderMixer() {
      this.el.mixerList.textContent = "";
      const terms = this.activeTermObjects();
      terms.forEach((term) => {
        const settings = this.trackSettings.get(term.id);
        const channel = document.createElement("article");
        channel.className = "mixer-channel";
        channel.style.setProperty("--track", term.color);
        channel.innerHTML = "<div class=\"mixer-channel-head\"><i></i><b>" + escapeHtml(term.phrase) + "</b></div>";
        const buttons = document.createElement("div");
        buttons.className = "mixer-buttons";
        const mute = document.createElement("button");
        mute.type = "button";
        mute.textContent = "MUTE";
        mute.classList.toggle("is-active", this.muted.has(term.id));
        mute.addEventListener("click", () => {
          if (this.muted.has(term.id)) this.muted.delete(term.id); else this.muted.add(term.id);
          this.commitParameterChange("Mixer: " + term.phrase, false);
        });
        const solo = document.createElement("button");
        solo.type = "button";
        solo.textContent = "SOLO";
        solo.classList.toggle("is-active", this.soloed.has(term.id));
        solo.addEventListener("click", () => {
          if (this.soloed.has(term.id)) this.soloed.delete(term.id); else this.soloed.add(term.id);
          this.commitParameterChange("Mixer: " + term.phrase, false);
        });
        buttons.append(mute, solo);
        channel.appendChild(buttons);
        channel.appendChild(this.createMixerRange("GAIN", 0, 1, 0.01, settings.gain, (value) => { settings.gain = value; }));
        channel.appendChild(this.createMixerRange("PAN", -1, 1, 0.01, settings.pan, (value) => { settings.pan = value; }));
        this.el.mixerList.appendChild(channel);
      });
      this.el.mixerCount.textContent = terms.length + " CHANNELS";
    }

    createMixerRange(labelText, min, max, step, value, handler) {
      const label = document.createElement("label");
      const copy = document.createElement("span");
      const name = document.createElement("b");
      const out = document.createElement("output");
      name.textContent = labelText;
      out.textContent = Number(value).toFixed(2);
      copy.append(name, out);
      const input = document.createElement("input");
      input.type = "range";
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = value;
      input.addEventListener("input", () => { handler(Number(input.value)); out.textContent = Number(input.value).toFixed(2); });
      input.addEventListener("change", () => this.persistSettings());
      label.append(copy, input);
      return label;
    }

    updateDiagnostics() {
      if (!this.el.eventCountDiagnostic) return;
      this.el.eventCountDiagnostic.textContent = String(this.plan.events.filter((event) => event.source !== "metronome").length);
      this.el.responseCountDiagnostic.textContent = String(this.plan.events.filter((event) => event.source === "response").length);
      this.el.durationDiagnostic.textContent = this.plan.duration.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + " sec";
      this.el.polyphonyDiagnostic.textContent = this.activeVoiceEnds.length + " / " + this.params.polyphony;
    }

    exportSettings() {
      const payload = JSON.stringify({ version: 2, params: this.params, scene: this.state.scene, seed: this.state.seed, activeTerms: Array.from(this.activeTerms), pinned: Array.from(this.pinned) }, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "wordstat-seq-patch.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      this.showToast("Патч экспортирован в JSON");
    }

    setupCanvases() {
      this.trendContext = this.el.trendCanvas.getContext("2d");
      this.fieldContext = this.el.fieldCanvas.getContext("2d");
      this.inspectorContext = this.el.inspectorCanvas.getContext("2d");
      this.drawTrend();
      this.drawInspectorCurve();
    }

    sizeCanvas(canvas, context) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      return rect;
    }

    aggregateSeries() {
      const terms = this.activeTermObjects().filter((term) => !this.muted.has(term.id));
      return Array.from({ length: STEPS }, (_, periodIndex) => terms.reduce((sum, term) => sum + (term.values[periodIndex] || 0), 0));
    }

    drawTrend() {
      if (!this.trendContext) return;
      const rect = this.sizeCanvas(this.el.trendCanvas, this.trendContext);
      if (!rect) return;
      const ctx = this.trendContext;
      ctx.clearRect(0, 0, rect.width, rect.height);
      const values = this.aggregateSeries();
      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      const x = (index) => 5 + index * ((rect.width - 10) / (STEPS - 1));
      const y = (value) => rect.height - 19 - ((value - min) / Math.max(1, max - min)) * (rect.height - 44);
      const gradient = ctx.createLinearGradient(0, 0, 0, rect.height);
      gradient.addColorStop(0, "rgba(255,204,0,.38)");
      gradient.addColorStop(1, "rgba(255,204,0,0)");
      ctx.beginPath();
      values.forEach((value, index) => { if (index === 0) ctx.moveTo(x(index), y(value)); else ctx.lineTo(x(index), y(value)); });
      ctx.lineTo(x(STEPS - 1), rect.height); ctx.lineTo(x(0), rect.height); ctx.closePath();
      ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath();
      values.forEach((value, index) => { if (index === 0) ctx.moveTo(x(index), y(value)); else ctx.lineTo(x(index), y(value)); });
      ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.strokeStyle = "#171714"; ctx.stroke();
      values.forEach((value, index) => {
        ctx.beginPath(); ctx.arc(x(index), y(value), index === this.currentPeriod && this.isPlaying ? 5 : 2.4, 0, Math.PI * 2);
        ctx.fillStyle = index === this.currentPeriod && this.isPlaying ? "#ff4b3e" : "#171714"; ctx.fill();
      });
      const start = values[0] || 1;
      const change = ((values[values.length - 1] - start) / start) * 100;
      this.el.trendDirection.textContent = (change >= 0 ? "+" : "") + change.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "%";
    }

    visualLoop() {
      this.drawField();
      this.visualFrame = window.requestAnimationFrame(() => this.visualLoop());
    }

    drawField() {
      if (!this.fieldContext || this.el.basicView.hidden) return;
      const rect = this.sizeCanvas(this.el.fieldCanvas, this.fieldContext);
      if (!rect) return;
      const ctx = this.fieldContext;
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, width, height);
      const terms = this.activeTermObjects();
      if (!terms.length) return;
      if (this.params.timeMode === "grid") this.drawGridField(ctx, width, height, terms);
      else if (this.params.timeMode === "elastic") this.drawElasticField(ctx, width, height, terms);
      else this.drawFreeField(ctx, width, height, terms);
    }

    eventPulse(termId) {
      const at = this.lastEventAt.get(termId);
      if (!at) return 0;
      return Math.exp(-Math.max(0, performance.now() - at) / 480);
    }

    drawGridField(ctx, width, height, terms) {
      const marginX = 38;
      const marginY = 35;
      for (let periodIndex = 0; periodIndex < STEPS; periodIndex += 1) {
        const x = marginX + periodIndex * ((width - marginX * 2) / (STEPS - 1));
        ctx.beginPath(); ctx.moveTo(x, marginY); ctx.lineTo(x, height - marginY); ctx.strokeStyle = periodIndex === this.currentPeriod && this.isPlaying ? "rgba(255,204,0,.5)" : "rgba(255,255,255,.07)"; ctx.lineWidth = periodIndex === this.currentPeriod ? 2 : 1; ctx.stroke();
      }
      terms.forEach((term, termIndex) => {
        const y = marginY + (termIndex + .5) * ((height - marginY * 2) / terms.length);
        ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.font = "9px sans-serif"; ctx.fillText(term.phrase, 16, y - 10);
        this.plan.events.filter((event) => event.termId === term.id && event.source !== "metronome").forEach((event) => {
          const x = marginX + event.periodIndex * ((width - marginX * 2) / (STEPS - 1));
          const pulse = this.eventPulse(term.id);
          ctx.beginPath(); ctx.arc(x, y, 3 + event.velocity * 10 + pulse * 5, 0, Math.PI * 2); ctx.fillStyle = term.color; ctx.globalAlpha = .3 + event.velocity * .7; ctx.fill(); ctx.globalAlpha = 1;
        });
      });
    }

    drawElasticField(ctx, width, height, terms) {
      const margin = 44;
      terms.forEach((term, termIndex) => {
        const events = this.plan.events.filter((event) => event.termId === term.id && event.source !== "metronome");
        const baseY = margin + (termIndex + .5) * ((height - margin * 2) / terms.length);
        ctx.beginPath();
        events.forEach((event, index) => {
          const x = margin + (event.atSeconds / this.plan.duration) * (width - margin * 2);
          const y = baseY + Math.sin(event.periodIndex * .72 + termIndex) * 9;
          if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = term.color; ctx.globalAlpha = .3; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
        events.forEach((event) => {
          const x = margin + (event.atSeconds / this.plan.duration) * (width - margin * 2);
          const y = baseY + Math.sin(event.periodIndex * .72 + termIndex) * 9;
          const pulse = this.eventPulse(term.id);
          ctx.beginPath(); ctx.arc(x, y, 3 + event.velocity * 8 + pulse * 6, 0, Math.PI * 2); ctx.fillStyle = term.color; ctx.fill();
        });
        ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.font = "9px sans-serif"; ctx.fillText(term.phrase, margin, baseY - 12);
      });
      const progress = this.isPlaying && this.ctx ? clamp((this.ctx.currentTime - this.cycleStart) / this.plan.duration, 0, 1) : 0;
      const playheadX = margin + progress * (width - margin * 2);
      ctx.beginPath(); ctx.moveTo(playheadX, 18); ctx.lineTo(playheadX, height - 18); ctx.strokeStyle = "rgba(255,204,0,.7)"; ctx.stroke();
    }

    drawFreeField(ctx, width, height, terms) {
      const centerX = width / 2;
      const centerY = height / 2;
      const radiusX = Math.max(110, width * .34);
      const radiusY = Math.max(90, height * .31);
      const positions = new Map();
      terms.forEach((term, index) => {
        const angle = (Math.PI * 2 * index / terms.length) - Math.PI / 2 + (term.engineIndex % 3) * .08;
        positions.set(term.id, { x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY });
      });
      this.recentEvents.filter((event) => event.source === "response" && event.parentTermId).forEach((event) => {
        const previous = positions.get(event.parentTermId);
        const current = positions.get(event.termId);
        if (!previous || !current) return;
        const age = performance.now() - event.at;
        if (age > 2400) return;
        ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.quadraticCurveTo(centerX, centerY, current.x, current.y); ctx.strokeStyle = "rgba(255,255,255," + (0.24 * (1 - age / 2400)).toFixed(3) + ")"; ctx.stroke();
      });
      terms.forEach((term) => {
        const point = positions.get(term.id);
        const pulse = this.eventPulse(term.id);
        const latest = term.values[term.values.length - 1] || 1;
        const energy = clamp(Math.log10(latest) / 5, .2, 1);
        ctx.beginPath(); ctx.arc(point.x, point.y, 11 + energy * 13 + pulse * 15, 0, Math.PI * 2); ctx.fillStyle = term.color; ctx.globalAlpha = .26 + pulse * .72; ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(point.x, point.y, 4 + pulse * 4, 0, Math.PI * 2); ctx.fillStyle = "#f3f2ee"; ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.font = "10px sans-serif"; ctx.textAlign = point.x < centerX ? "right" : "left"; ctx.fillText(term.phrase, point.x + (point.x < centerX ? -22 : 22), point.y + 3); ctx.textAlign = "left";
      });
      ctx.beginPath(); ctx.arc(centerX, centerY, 19 + this.params.responseDepth * 28, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,204,0,.5)"; ctx.setLineDash([3, 5]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,204,0,.75)"; ctx.font = "8px monospace"; ctx.textAlign = "center"; ctx.fillText("ОТВЕТ", centerX, centerY + 3); ctx.textAlign = "left";
    }

    updateTrendReadout(periodIndex) {
      const values = this.aggregateSeries();
      this.el.weekLabel.textContent = "ПЕРИОД " + String(periodIndex + 1).padStart(2, "0") + " · " + (this.data.weeks[periodIndex] || "");
      this.el.pulseCount.textContent = Math.round(values[periodIndex] || 0).toLocaleString("ru-RU");
    }

    updateInspector(event) {
      if (!event || !event.termId) return;
      const term = this.termById(event.termId);
      if (!term) return;
      const count = term.values[event.periodIndex] || 0;
      const previous = term.values[Math.max(0, event.periodIndex - 1)] || count || 1;
      const delta = ((count - previous) / Math.max(1, previous)) * 100;
      const midi = Number.isFinite(event.playedMidi) ? event.playedMidi : this.params.rootNote + (event.noteOffset || 0);
      const cutoff = Math.round(this.params.filterCutoff * (0.45 + (event.brightness || .5) * this.params.affinityToFilter));
      this.el.inspectorDot.classList.add("is-on");
      this.el.inspectorTerm.textContent = term.phrase;
      this.el.inspectorPeriod.textContent = (this.data.weeks[event.periodIndex] || "Период " + (event.periodIndex + 1)) + " · " + count.toLocaleString("ru-RU") + " запросов";
      this.el.inspectorVelocity.textContent = count.toLocaleString("ru-RU") + " → " + Number(event.velocity || 0).toFixed(2);
      this.el.inspectorPitch.textContent = (delta >= 0 ? "+" : "") + delta.toLocaleString("ru-RU", { maximumFractionDigits: 1 }) + "% → " + midiName(midi);
      this.el.inspectorFilter.textContent = Math.round(term.affinity || 100) + "% → " + cutoff.toLocaleString("ru-RU") + " Hz";
      this.el.inspectorTime.textContent = Number(event.atSeconds || 0).toFixed(2) + " s · " + PARAMETERS.TIME_MODES[this.params.timeMode].label;
      this.el.inspectorSource.textContent = event.source === "response" ? "ответ другого голоса" : event.source === "manual" ? "жест человека" : "динамика данных";
      this.drawInspectorCurve(term, event.periodIndex);
    }

    drawInspectorCurve(term, activePeriod) {
      if (!this.inspectorContext) return;
      const rect = this.sizeCanvas(this.el.inspectorCanvas, this.inspectorContext);
      if (!rect) return;
      const ctx = this.inspectorContext;
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (!term) term = this.currentEvent ? this.termById(this.currentEvent.termId) : this.activeTermObjects()[0];
      if (!term) return;
      const values = term.values.slice(0, STEPS);
      const min = Math.min.apply(null, values);
      const max = Math.max.apply(null, values);
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = 2 + index * ((rect.width - 4) / (STEPS - 1));
        const y = rect.height - 7 - ((value - min) / Math.max(1, max - min)) * (rect.height - 14);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = term.color; ctx.lineWidth = 2; ctx.stroke();
      if (Number.isFinite(activePeriod)) {
        const x = 2 + activePeriod * ((rect.width - 4) / (STEPS - 1));
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.strokeStyle = "rgba(255,75,62,.6)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }

    showToast(message) {
      this.el.toast.textContent = message;
      this.el.toast.classList.add("is-visible");
      window.clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => this.el.toast.classList.remove("is-visible"), 3600);
    }

    async importCsv(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = this.parseCsv(text, file.name);
        if (!parsed.length) throw new Error("no rows");
        this.applyImportedTerms(parsed);
        this.showToast("CSV стал новым музыкальным полем: " + parsed.length + " " + (parsed.length === 1 ? "фраза" : "фраз") + ".");
      } catch (error) {
        this.showToast("Не удалось прочитать CSV. Нужны столбцы date и count; phrase — опционально.");
      } finally {
        event.target.value = "";
      }
    }

    parseCsv(text, filename) {
      const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) return [];
      const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
      const split = (line) => {
        const values = []; let value = ""; let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
          const char = line[i];
          if (char === '"') { if (quoted && line[i + 1] === '"') { value += '"'; i += 1; } else quoted = !quoted; }
          else if (char === delimiter && !quoted) { values.push(value.trim()); value = ""; }
          else value += char;
        }
        values.push(value.trim()); return values;
      };
      const headers = split(lines[0]).map((header) => header.toLocaleLowerCase("ru").replace(/[\s_%]+/g, ""));
      const findHeader = (patterns) => headers.findIndex((header) => patterns.some((pattern) => header.includes(pattern)));
      const dateIndex = findHeader(["date", "дата", "period", "период", "week", "недел"]);
      const countIndex = findHeader(["count", "impression", "показ", "частот", "числозапрос"]);
      const phraseIndex = findHeader(["phrase", "фраза", "keyword", "ключ"]);
      const affinityIndex = findHeader(["affinity", "индексинтерес", "индекссоответ"]);
      if (countIndex < 0) return [];
      const fallbackPhrase = filename.replace(/\.csv$/i, "").replace(/[_-]+/g, " ");
      const groups = new Map();
      lines.slice(1).forEach((line) => {
        const cells = split(line);
        const phrase = escapeText(phraseIndex >= 0 ? cells[phraseIndex] : fallbackPhrase) || fallbackPhrase;
        const numeric = escapeText(cells[countIndex]).replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/[^\d.-]/g, "");
        const count = Number(numeric);
        if (!Number.isFinite(count)) return;
        if (!groups.has(phrase)) groups.set(phrase, []);
        groups.get(phrase).push({ date: dateIndex >= 0 ? escapeText(cells[dateIndex]) : "Период " + (groups.get(phrase).length + 1), count: Math.max(0, count), affinity: affinityIndex >= 0 ? Number(escapeText(cells[affinityIndex]).replace(",", ".").replace(/[^\d.-]/g, "")) : 100 });
      });
      const palette = ["#ffcc00", "#ff765f", "#d8659b", "#8b73de", "#4d9be4", "#36ad96", "#7ba43a", "#b48c2a"];
      return Array.from(groups.entries()).map(([phrase, rows], index) => {
        const selected = rows.slice(-STEPS);
        const values = selected.map((row) => row.count);
        while (values.length < STEPS) values.unshift(values[0] || 0);
        const dates = selected.map((row) => row.date);
        while (dates.length < STEPS) dates.unshift(dates[0] || "Период");
        const affinities = selected.map((row) => row.affinity).filter(Number.isFinite);
        return { id: "csv_" + index + "_" + phrase.toLocaleLowerCase("ru").replace(/[^a-zа-яё0-9]+/gi, "_").slice(0, 24), phrase: phrase, group: ["connection", "chance", "feedback"][index % 3], affinity: affinities.length ? affinities.reduce((sum, value) => sum + value, 0) / affinities.length : 100, color: palette[index % palette.length], values: values, dates: dates, engineIndex: index };
      });
    }

    applyImportedTerms(terms) {
      this.data.terms = terms;
      this.data.weeks = terms[0].dates || Array.from({ length: STEPS }, (_, index) => "Период " + (index + 1));
      this.data.scenes = [{ id: "csv", name: "CSV / LIVE", note: "Импортированная динамика", terms: terms.map((term) => term.id) }];
      this.state.scene = "csv";
      this.activeTerms = new Set(terms.map((term) => term.id));
      this.trackSettings.clear();
      this.muted.clear(); this.soloed.clear(); this.overrides.clear(); this.locked.clear();
      this.ensureTrackSettings();
      this.el.dataBadge.textContent = "CSV / LOCAL";
      this.el.dataNoticeText.textContent = "Сейчас звучит локально загруженная динамика. Файл не отправлялся на сервер.";
      this.commitParameterChange("Данные CSV загружены");
    }

    ensureAudio() {
      if (this.ctx) return this.ctx;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("Web Audio API is unavailable");

      const ctx = new AudioContext();
      const master = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 18;
      compressor.ratio.value = 3.2;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.24;
      master.connect(compressor);
      compressor.connect(ctx.destination);

      const delaySend = ctx.createGain();
      const delayNode = ctx.createDelay(3);
      const delayFilter = ctx.createBiquadFilter();
      const delayFeedback = ctx.createGain();
      delayFilter.type = "lowpass";
      delayFilter.frequency.value = 4800;
      delaySend.connect(delayNode);
      delayNode.connect(delayFilter);
      delayFilter.connect(master);
      delayFilter.connect(delayFeedback);
      delayFeedback.connect(delayNode);

      const reverbSend = ctx.createGain();
      const convolver = ctx.createConvolver();
      const reverbFilter = ctx.createBiquadFilter();
      reverbFilter.type = "lowpass";
      reverbFilter.frequency.value = 7200;
      convolver.buffer = this.createImpulse(ctx, 2.35, 2.8);
      reverbSend.connect(convolver);
      convolver.connect(reverbFilter);
      reverbFilter.connect(master);

      const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 1.25), ctx.sampleRate);
      const noiseData = noise.getChannelData(0);
      const random = seededRandom(0x7f4a7c15);
      for (let index = 0; index < noiseData.length; index += 1) noiseData[index] = random() * 2 - 1;

      this.ctx = ctx;
      this.master = master;
      this.compressor = compressor;
      this.delay = { send: delaySend, node: delayNode, filter: delayFilter, feedback: delayFeedback };
      this.reverb = { send: reverbSend, convolver: convolver, filter: reverbFilter };
      this.noiseBuffer = noise;
      this.applyAudioParams();
      return ctx;
    }

    createImpulse(ctx, duration, decay) {
      const length = Math.max(1, Math.round(ctx.sampleRate * duration));
      const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
      const random = seededRandom(0x51f15e77);
      for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
        const data = impulse.getChannelData(channel);
        for (let index = 0; index < length; index += 1) {
          const envelope = Math.pow(1 - index / length, decay);
          data[index] = (random() * 2 - 1) * envelope * (channel ? 0.92 : 1);
        }
      }
      return impulse;
    }

    applyAudioParams() {
      if (!this.ctx || !this.master) return;
      const now = this.ctx.currentTime;
      const compensation = clamp(1 - Math.log2(Math.max(1, this.params.polyphony)) * 0.09, 0.64, 1);
      const masterLevel = clamp(this.params.masterVolume * compensation, 0, 0.9);
      this.master.gain.setTargetAtTime(masterLevel, now, 0.025);

      const space = clamp(this.params.space, 0, 1);
      this.delay.send.gain.setTargetAtTime(this.params.delayMix * (0.32 + space * 0.68), now, 0.03);
      this.delay.feedback.gain.setTargetAtTime(clamp(this.params.delayFeedback + space * 0.12, 0, 0.82), now, 0.03);
      this.reverb.send.gain.setTargetAtTime(this.params.reverbMix * (0.38 + space * 0.62), now, 0.03);
      this.delay.filter.frequency.setTargetAtTime(clamp(this.params.filterCutoff * 1.35, 900, 10500), now, 0.03);
      this.reverb.filter.frequency.setTargetAtTime(clamp(this.params.filterCutoff * 1.75, 1500, 12500), now, 0.03);

      let delayTime;
      if (this.params.timeMode === "grid") delayTime = (60 / this.params.bpm) * (this.params.structureIndex >= 3 ? 0.75 : 0.5);
      else if (this.params.timeMode === "elastic") delayTime = this.params.cycleDuration / 32;
      else delayTime = this.params.cycleDuration / 27;
      this.delay.node.delayTime.setTargetAtTime(clamp(delayTime, 0.055, 1.4), now, 0.025);
    }

    async wakeAudio(autoplay) {
      try {
        const ctx = this.ensureAudio();
        if (ctx.state !== "running") await ctx.resume();
        this.el.wakeLayer.classList.add("is-hidden");
        this.updateTransport();
        if (autoplay && !this.isPlaying) await this.play();
      } catch (error) {
        console.error(error);
        this.showToast("Браузер не смог запустить Web Audio. Проверьте разрешение на звук.");
      }
    }

    async togglePlayback() {
      if (this.isPlaying) {
        this.stop();
        return;
      }
      if (!this.ctx || this.ctx.state !== "running") {
        await this.wakeAudio(true);
        return;
      }
      await this.play();
    }

    async play() {
      const ctx = this.ensureAudio();
      if (ctx.state !== "running") await ctx.resume();
      if (this.isPlaying) return;
      this.el.wakeLayer.classList.add("is-hidden");
      this.isPlaying = true;
      this.transportGeneration += 1;
      this.planIndex = 0;
      this.cycle = 1;
      this.activeVoiceEnds = [];
      this.cycleStart = ctx.currentTime + 0.075;
      this.updateTransport();
      this.scheduler();
      this.schedulerTimer = window.setInterval(() => this.scheduler(), 25);
    }

    stop() {
      this.isPlaying = false;
      this.transportGeneration += 1;
      if (this.schedulerTimer) window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      this.clearUiTimers();
      this.activeVoiceEnds = [];
      this.planIndex = 0;
      this.el.inspectorDot.classList.remove("is-on");
      this.updateTransport();
      this.renderTracks();
      this.drawTrend();
      this.updateDiagnostics();
    }

    updateTransport() {
      const audioReady = Boolean(this.ctx && this.ctx.state === "running");
      const buttons = [this.el.heroPlay, this.el.transportButton, this.el.advancedTransportButton];
      buttons.forEach((button) => {
        button.classList.toggle("is-playing", this.isPlaying);
        button.setAttribute("aria-pressed", String(this.isPlaying));
      });
      this.el.heroPlayLabel.textContent = this.isPlaying ? "ОСТАНОВИТЬ" : "ПОСЛУШАТЬ ПОЛЕ";
      this.el.transportLabel.textContent = this.isPlaying ? "STOP" : "PLAY";
      this.el.advancedTransportLabel.textContent = this.isPlaying ? "STOP ENGINE" : "PLAY ENGINE";
      this.el.engineDot.classList.toggle("is-on", audioReady);
      this.el.engineText.textContent = this.isPlaying ? "поле звучит" : audioReady ? "аудио готово" : "аудио выключено";
      this.el.nowPlayingLabel.textContent = this.isPlaying && this.currentEvent
        ? (this.termById(this.currentEvent.termId) || {}).phrase || "музыкальное поле"
        : this.isPlaying ? "первый сигнал уже в пути" : "поле ожидает первого жеста";
      this.el.cycleCount.textContent = String(this.cycle).padStart(3, "0");
    }

    scheduler() {
      if (!this.isPlaying || !this.ctx) return;
      const horizon = this.ctx.currentTime + 0.12;
      const generation = this.transportGeneration;
      let guard = 0;

      while (guard < 4096) {
        guard += 1;
        if (!this.plan.events.length) {
          if (this.cycleStart + this.plan.duration <= horizon) this.advanceCycle(generation);
          break;
        }

        if (this.planIndex < this.plan.events.length) {
          const event = this.plan.events[this.planIndex];
          const when = this.cycleStart + event.atSeconds;
          if (when > horizon) break;
          this.planIndex += 1;
          if (when >= this.ctx.currentTime - 0.025) this.scheduleEvent(event, when, generation);
          continue;
        }

        const cycleEnd = this.cycleStart + this.plan.duration;
        if (cycleEnd > horizon) break;
        this.advanceCycle(generation);
      }
    }

    advanceCycle(generation) {
      this.cycleStart += this.plan.duration;
      this.planIndex = 0;
      this.cycle += 1;
      const displayedCycle = this.cycle;
      const delay = Math.max(0, (this.cycleStart - this.ctx.currentTime) * 1000);
      const timer = window.setTimeout(() => {
        this.uiTimers.delete(timer);
        if (!this.isPlaying || generation !== this.transportGeneration) return;
        this.el.cycleCount.textContent = String(displayedCycle).padStart(3, "0");
      }, delay);
      this.uiTimers.add(timer);
    }

    scheduleEvent(event, when, generation) {
      if (!this.triggerEvent(event, when)) return;
      const delay = Math.max(0, (when - this.ctx.currentTime) * 1000);
      const timer = window.setTimeout(() => {
        this.uiTimers.delete(timer);
        if (!this.isPlaying || generation !== this.transportGeneration) return;
        this.paintEvent(event);
      }, delay);
      this.uiTimers.add(timer);
    }

    triggerEvent(event, when) {
      if (!this.ctx) return false;
      const startAt = Math.max(when, this.ctx.currentTime + 0.003);
      if (event.source === "metronome") {
        this.voiceMetronome(startAt, event.velocity || 0.4);
        return true;
      }

      const term = this.termById(event.termId);
      if (!term || this.muted.has(term.id) || (this.soloed.size && !this.soloed.has(term.id))) return false;
      this.activeVoiceEnds = this.activeVoiceEnds.filter((end) => end > startAt);
      if (this.activeVoiceEnds.length >= Math.max(1, this.params.polyphony)) return false;

      const settings = this.trackSettings.get(term.id) || { gain: 0.82, pan: 0 };
      const responseGain = event.source === "response" ? 0.7 : 1;
      const velocityMap = 0.18 + clamp(event.velocity || 0.4, 0, 1) * this.params.countToVelocity;
      const velocity = clamp(velocityMap * settings.gain * responseGain, 0.02, 0.94);
      const pitchScale = 0.28 + this.params.deltaToPitch * 0.72;
      const mappedOffset = clamp((event.noteOffset || 0) * pitchScale, -this.params.pitchSpan, this.params.pitchSpan);
      const midi = clamp(this.params.rootNote + mappedOffset, 24, 100);
      const pan = clamp((event.pan || 0) * this.params.stereoWidth + settings.pan * 0.42, -1, 1);
      const brightness = clamp(0.22 + (event.brightness || 0.5) * (0.24 + this.params.affinityToFilter * 0.76), 0.12, 1);
      event.playedMidi = midi;

      let duration;
      if (event.kind === "chance") duration = this.voiceChance(startAt, midi, velocity, brightness, pan, event.source === "response");
      else if (event.kind === "feedback" || event.source === "response") duration = this.voiceFeedback(startAt, midi, velocity, brightness, pan, event.source === "response");
      else duration = this.voiceConnection(startAt, midi, velocity, brightness, pan);
      this.activeVoiceEnds.push(startAt + duration);
      this.updateDiagnostics();
      return true;
    }

    createVoiceBus(pan, sendAmount) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      const output = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      const delaySend = ctx.createGain();
      const reverbSend = ctx.createGain();
      gain.connect(output);
      output.connect(this.master);
      output.connect(delaySend);
      output.connect(reverbSend);
      delaySend.connect(this.delay.send);
      reverbSend.connect(this.reverb.send);
      if (output.pan) output.pan.value = pan;
      delaySend.gain.value = 0.35 + sendAmount * 0.65;
      reverbSend.gain.value = 0.28 + sendAmount * 0.72;
      return { gain: gain, output: output, delaySend: delaySend, reverbSend: reverbSend };
    }

    setEnvelope(gainParam, when, peak, attack, hold, release) {
      const top = Math.max(0.0002, peak);
      gainParam.cancelScheduledValues(when);
      gainParam.setValueAtTime(0.0001, when);
      gainParam.linearRampToValueAtTime(top, when + attack);
      gainParam.setValueAtTime(top, when + attack + hold);
      gainParam.exponentialRampToValueAtTime(0.0001, when + attack + hold + release);
      return attack + hold + release;
    }

    voiceConnection(when, midi, velocity, brightness, pan) {
      const ctx = this.ctx;
      const attack = Math.max(0.002, this.params.attack);
      const release = Math.max(0.04, this.params.release * (0.72 + this.params.trendToDuration * 0.8));
      const duration = attack + 0.035 + release;
      const bus = this.createVoiceBus(pan, this.params.space);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(clamp(this.params.filterCutoff * (0.36 + brightness * 0.92), 160, 16000), when);
      filter.Q.value = this.params.resonance;
      filter.connect(bus.gain);

      const fundamental = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const overtoneGain = ctx.createGain();
      fundamental.type = this.params.waveform;
      overtone.type = "sine";
      fundamental.frequency.setValueAtTime(midiToHz(midi), when);
      overtone.frequency.setValueAtTime(midiToHz(midi + 12), when);
      overtoneGain.gain.value = 0.2 + brightness * 0.12;
      fundamental.connect(filter);
      overtone.connect(overtoneGain);
      overtoneGain.connect(filter);
      this.setEnvelope(bus.gain.gain, when, velocity * 0.24, attack, 0.035, release);
      fundamental.start(when); overtone.start(when);
      fundamental.stop(when + duration + 0.03); overtone.stop(when + duration + 0.03);
      return duration;
    }

    voiceChance(when, midi, velocity, brightness, pan, isResponse) {
      const ctx = this.ctx;
      const attack = Math.min(0.035, Math.max(0.002, this.params.attack * 0.45));
      const release = Math.max(0.05, this.params.release * (isResponse ? 0.82 : 0.42));
      const duration = attack + 0.018 + release;
      const bus = this.createVoiceBus(pan, clamp(this.params.space + 0.18, 0, 1));
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(clamp(this.params.filterCutoff * (0.5 + brightness), 280, 15000), when);
      filter.Q.value = clamp(this.params.resonance * 0.72, 0.2, 12);
      filter.connect(bus.gain);

      const oscillator = ctx.createOscillator();
      oscillator.type = this.params.waveform === "sine" ? "triangle" : this.params.waveform;
      oscillator.frequency.setValueAtTime(midiToHz(midi + 12), when);
      oscillator.detune.setValueAtTime(-8 + brightness * 16, when);
      oscillator.connect(filter);
      const noise = ctx.createBufferSource();
      const noiseGain = ctx.createGain();
      const noiseFilter = ctx.createBiquadFilter();
      noise.buffer = this.noiseBuffer;
      noiseFilter.type = "highpass";
      noiseFilter.frequency.value = 1500 + brightness * 4800;
      noiseGain.gain.value = 0.12 + brightness * 0.1;
      noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(filter);
      this.setEnvelope(bus.gain.gain, when, velocity * 0.18, attack, 0.018, release);
      oscillator.start(when); noise.start(when);
      oscillator.stop(when + duration + 0.02); noise.stop(when + Math.min(duration, 0.16));
      return duration;
    }

    voiceFeedback(when, midi, velocity, brightness, pan, isResponse) {
      const ctx = this.ctx;
      const attack = Math.max(0.004, this.params.attack * (isResponse ? 1.6 : 1.1));
      const release = Math.max(0.08, this.params.release * (0.9 + this.params.trendToDuration * 0.9));
      const duration = attack + 0.055 + release;
      const bus = this.createVoiceBus(pan, clamp(this.params.space + 0.26, 0, 1));
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(clamp(this.params.filterCutoff * (0.28 + brightness * 0.82), 180, 14000), when);
      filter.Q.value = clamp(this.params.resonance * 1.18, 0.2, 16);
      filter.connect(bus.gain);

      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const modulation = ctx.createGain();
      carrier.type = this.params.waveform;
      modulator.type = "sine";
      carrier.frequency.setValueAtTime(midiToHz(midi), when);
      modulator.frequency.setValueAtTime(midiToHz(midi - 12) * (isResponse ? 1.5 : 1), when);
      modulation.gain.setValueAtTime(4 + brightness * (isResponse ? 24 : 15), when);
      modulator.connect(modulation); modulation.connect(carrier.frequency);
      carrier.connect(filter);
      this.setEnvelope(bus.gain.gain, when, velocity * (isResponse ? 0.17 : 0.21), attack, 0.055, release);
      carrier.start(when); modulator.start(when);
      carrier.stop(when + duration + 0.03); modulator.stop(when + duration + 0.03);
      return duration;
    }

    voiceMetronome(when, velocity) {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const level = clamp(this.params.metronomeLevel * velocity, 0.001, 0.24);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(velocity > 0.6 ? 1760 : 1180, when);
      oscillator.frequency.exponentialRampToValueAtTime(520, when + 0.028);
      gain.gain.setValueAtTime(level, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.034);
      oscillator.connect(gain); gain.connect(this.master);
      oscillator.start(when); oscillator.stop(when + 0.04);
    }

    paintEvent(event) {
      if (event.source === "metronome") return;
      const term = this.termById(event.termId);
      if (!term) return;
      this.currentEvent = event;
      this.currentPeriod = event.periodIndex;
      this.lastEventAt.set(term.id, performance.now());
      this.recentEvents.push({ termId: term.id, at: performance.now(), source: event.source, parentTermId: event.parentTermId || null });
      this.recentEvents = this.recentEvents.filter((item) => performance.now() - item.at < 3600).slice(-18);
      this.el.nowPlayingLabel.textContent = event.source === "response"
        ? "«" + term.phrase + "» отвечает"
        : "«" + term.phrase + "» · период " + String(event.periodIndex + 1).padStart(2, "0");
      this.updateTrendReadout(event.periodIndex);
      this.updateInspector(event);
      this.el.trackList.querySelectorAll(".step.is-current").forEach((step) => step.classList.remove("is-current"));
      const currentStep = this.el.trackList.querySelector(".track-row[data-term=\"" + term.id + "\"] .step[data-period=\"" + event.periodIndex + "\"]");
      if (currentStep) currentStep.classList.add("is-current");
      this.drawTrend();
    }

    clearUiTimers() {
      this.uiTimers.forEach((timer) => window.clearTimeout(timer));
      this.uiTimers.clear();
    }
  }

  window.wordstatSequencer = new WordstatSequencerV2();
})();
