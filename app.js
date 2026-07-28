"use strict";

const TRACKS = [
  {
    id: "pulse",
    name: "ПУЛЬС",
    detail: "тело / основание",
    color: "#e7b86c",
    soft: "rgba(231, 184, 108, 0.14)",
    glow: "rgba(231, 184, 108, 0.55)"
  },
  {
    id: "trace",
    name: "СЛЕД",
    detail: "волна / идея",
    color: "#7fd4c1",
    soft: "rgba(127, 212, 193, 0.14)",
    glow: "rgba(127, 212, 193, 0.55)"
  },
  {
    id: "dust",
    name: "ПЫЛЬ",
    detail: "шум / материя",
    color: "#a5a593",
    soft: "rgba(165, 165, 147, 0.14)",
    glow: "rgba(165, 165, 147, 0.45)"
  },
  {
    id: "echo",
    name: "ЭХО",
    detail: "машина / ответ",
    color: "#cb81ae",
    soft: "rgba(203, 129, 174, 0.14)",
    glow: "rgba(203, 129, 174, 0.55)"
  }
];

const BUILT_IN_MEMORIES = [
  {
    id: "impulse",
    name: "Импульс",
    author: "участник 01 · первая волна",
    color: "#7fd4c1",
    pattern: [
      "1000100010001010",
      "0010001000100010",
      "0000100000001000",
      "0000001000000010"
    ],
    params: { root: 45, timbre: 0.18, cutoff: 2600, decay: 0.52, fm: 1.8 }
  },
  {
    id: "breath",
    name: "Дыхание",
    author: "участник 02 · открытая форма",
    color: "#8bb6d9",
    pattern: [
      "1000000010000000",
      "0001000100000100",
      "0010001000100010",
      "0000010000001000"
    ],
    params: { root: 48, timbre: 0.63, cutoff: 1480, decay: 1.22, fm: 1.2 }
  },
  {
    id: "metal",
    name: "Металл",
    author: "участник 03 · найденный объект",
    color: "#e7b86c",
    pattern: [
      "1000101010001000",
      "0100001001000010",
      "0010100010100010",
      "0001000000010100"
    ],
    params: { root: 42, timbre: 0.86, cutoff: 5200, decay: 0.34, fm: 4.8 }
  },
  {
    id: "voice",
    name: "Голос",
    author: "участник 04 · общий хор",
    color: "#cb81ae",
    pattern: [
      "1000000010001000",
      "0010010001001001",
      "0000100000000010",
      "0100001000010000"
    ],
    params: { root: 50, timbre: 0.42, cutoff: 3300, decay: 0.86, fm: 2.9 }
  }
];

const SCALE = [0, 3, 5, 7, 10, 12, 15, 17];
const STORAGE_KEY = "living-memory-sequencer-v2";
const LEGACY_STORAGE_KEY = "living-memory-sequencer-v1";
const STRUCTURE_PROFILES = [
  {
    id: "thread",
    label: "Нить",
    layers: 1,
    independence: 0.05,
    connections: 0.08,
    memoryDepth: 0.24,
    note: "Один явный пульс держит общий мотив; остальные голоса сохраняются как латентная память."
  },
  {
    id: "dialogue",
    label: "Диалог",
    layers: 2,
    independence: 0.18,
    connections: 0.22,
    memoryDepth: 0.48,
    note: "Пульс и След делят один цикл и слушают две памяти."
  },
  {
    id: "weave",
    label: "Сплетение",
    layers: 3,
    independence: 0.58,
    connections: 0.56,
    memoryDepth: 0.74,
    note: "Третий голос проявляет материю; периоды расходятся и начинают влиять друг на друга."
  },
  {
    id: "organism",
    label: "Организм",
    layers: 4,
    independence: 0.9,
    connections: 0.86,
    memoryDepth: 1,
    note: "Памяти разветвляются, время дрейфует, а редкие совпадения создают длинную форму."
  }
];

const TIME_MODES = {
  grid: { label: "Сетка", note: "Все голоса разделяют шестнадцать точных шагов." },
  breath: { label: "Дыхание", note: "Цикл возвращается, но интервалы внутри него живут и растягиваются." },
  orbits: { label: "Орбиты", note: "У каждого голоса собственное время и мягкое притяжение к остальным." }
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function expLerp(a, b, amount) {
  return Math.exp(lerp(Math.log(a), Math.log(b), amount));
}

function midiToHz(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedToHex(seed) {
  return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 4);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

class LivingMemorySequencer {
  constructor() {
    this.memories = BUILT_IN_MEMORIES.map(clone);
    this.loadMemories();

    this.state = {
      bpm: 96,
      swing: 0.12,
      morph: 0.35,
      warmth: 0.58,
      echo: 0.32,
      density: 0.64,
      agency: 0.38,
      drift: 0.24,
      master: 0.72,
      memoryA: this.memories[0].id,
      memoryB: this.memories[Math.min(1, this.memories.length - 1)].id,
      seed: 0x7f2a91c3,
      view: "meeting",
      timeMode: "breath",
      quantize: 0.42,
      breathDepth: 0.48,
      cycleDrift: 0.06,
      orbitAttraction: 0.36,
      structureProfile: 1,
      structure: clone(STRUCTURE_PROFILES[1]),
      machine: {
        timingMs: 18,
        velocityDrift: 0.12,
        detuneCents: 12,
        ratchetChance: 0.11,
        memoryChance: 0.62,
        mutationNodes: 5
      },
      fx: {
        feedback: 0.26,
        delayWet: 0.12,
        reverbWet: 0.09,
        drive: 0.41
      },
      orbitRatios: [1, 0.75, 1.25, 0.875]
    };

    this.pattern = this.patternFromMemory(this.memories[0]);
    this.trackState = TRACKS.map(function makeTrackState() {
      return { muted: false, solo: false, gain: 0.84 };
    });
    this.voiceState = [
      { level: 0.84, tone: 0.56, decay: 0.58, space: 0.18 },
      { level: 0.78, tone: 0.52, decay: 0.64, space: 0.28 },
      { level: 0.66, tone: 0.48, decay: 0.42, space: 0.42 },
      { level: 0.72, tone: 0.62, decay: 0.7, space: 0.58 }
    ];
    this.undoStack = [];
    this.machineHistory = [];
    this.eventLog = [];
    this.selectedStep = { track: 1, step: 2 };
    this.guidePressed = false;
    this.guideActive = false;
    this.breathWeights = new Array(16).fill(1);
    this.orbitSteps = [0, 0, 0, 0];
    this.orbitNextTimes = [0, 0, 0, 0];
    this.random = mulberry32(this.state.seed);
    this.ctx = null;
    this.isPlaying = false;
    this.currentStep = 0;
    this.nextNoteTime = 0;
    this.cycle = 1;
    this.schedulerTimer = null;
    this.uiTimers = [];
    this.analyserData = null;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.cacheElements();
    this.renderMemoryList();
    this.renderMemoryOptions();
    this.renderBeatRuler();
    this.renderTracks();
    this.renderVoiceControls();
    this.renderOrbitRatios();
    this.bindEvents();
    this.updateAllReadouts();
    this.updateMemoryIndicators();
    this.updateTimeVisuals();
    this.renderAnatomy();
    this.setupCanvas();
  }

  cacheElements() {
    const ids = [
      "memoryList",
      "memoryA",
      "memoryB",
      "advMemoryA",
      "advMemoryB",
      "trackRows",
      "beatRuler",
      "wakeLayer",
      "wakeButton",
      "exploreSilent",
      "playToggle",
      "playLabel",
      "audioState",
      "stateDot",
      "sessionSeed",
      "cycleCount",
      "agencyPad",
      "padCursor",
      "agencyValue",
      "driftValue",
      "morph",
      "morphOut",
      "warmth",
      "warmthOut",
      "echo",
      "echoOut",
      "density",
      "densityOut",
      "bpm",
      "bpmOut",
      "swing",
      "swingOut",
      "master",
      "masterOut",
      "mutate",
      "undo",
      "newMeeting",
      "saveMemory",
      "machineLog",
      "organismNote",
      "memoryCanvas",
      "announcer",
      "viewMeeting",
      "viewAnatomy",
      "anatomyView",
      "pulseGuide",
      "branching",
      "branchingOut",
      "branchingNote",
      "anatomyMemoryA",
      "anatomyMemoryB",
      "anatomyMorph",
      "advMorph",
      "advMorphOut",
      "advWarmth",
      "advWarmthOut",
      "advEcho",
      "advEchoOut",
      "advDensity",
      "advDensityOut",
      "memoryParameterRows",
      "advQuantize",
      "advQuantizeOut",
      "advBreath",
      "advBreathOut",
      "advCycleDrift",
      "advCycleDriftOut",
      "advAttraction",
      "advAttractionOut",
      "orbitRatios",
      "advTiming",
      "advTimingOut",
      "advAgency",
      "advAgencyOut",
      "advDrift",
      "advDriftOut",
      "advVelocity",
      "advVelocityOut",
      "advDetune",
      "advDetuneOut",
      "advRatchet",
      "advRatchetOut",
      "advMemoryChance",
      "advMemoryChanceOut",
      "advMutationNodes",
      "advMutationNodesOut",
      "structureState",
      "axisLayers",
      "axisLayersOut",
      "axisIndependence",
      "axisIndependenceOut",
      "axisConnections",
      "axisConnectionsOut",
      "axisMemory",
      "axisMemoryOut",
      "structureDescription",
      "eventInspector",
      "voiceControls",
      "fxFeedback",
      "fxFeedbackOut",
      "fxDelayWet",
      "fxDelayWetOut",
      "fxReverbWet",
      "fxReverbWetOut",
      "fxDrive",
      "fxDriveOut",
      "influenceSummary",
      "humanInfluence",
      "memoryInfluence",
      "machineInfluence",
      "humanInfluenceOut",
      "memoryInfluenceOut",
      "machineInfluenceOut",
      "diagnosticsBody"
    ];
    this.el = {};
    ids.forEach(
      function cache(id) {
        this.el[id] = document.getElementById(id);
      }.bind(this)
    );
  }

  patternFromMemory(memory) {
    return memory.pattern.map(function makeTrack(row, trackIndex) {
      return row.split("").map(function makeStep(flag, stepIndex) {
        const saved = memory.events && memory.events[trackIndex] ? memory.events[trackIndex][stepIndex] : null;
        return {
          id: memory.id + "-" + trackIndex + "-" + stepIndex,
          active: flag === "1",
          velocity: saved && Number.isFinite(saved.velocity)
            ? saved.velocity
            : flag === "1"
              ? 0.66 + ((stepIndex + trackIndex) % 3) * 0.12
              : 0.58,
          probability: saved && Number.isFinite(saved.probability) ? saved.probability : 0.9,
          locked: saved ? Boolean(saved.locked) : false,
          note: saved && Number.isFinite(saved.note)
            ? saved.note
            : memory.params.root + SCALE[(stepIndex + trackIndex * 2) % SCALE.length],
          phase: saved && Number.isFinite(saved.phase) ? saved.phase : stepIndex / 16,
          offsetMs: saved && Number.isFinite(saved.offsetMs) ? saved.offsetMs : 0,
          origin: saved && saved.origin ? saved.origin : "memory",
          parents: saved && Array.isArray(saved.parents) ? saved.parents : [memory.id],
          lastChangedBy: saved && saved.lastChangedBy ? saved.lastChangedBy : "memory",
          generation: saved && Number.isFinite(saved.generation) ? saved.generation : 0,
          contributions: saved && saved.contributions
            ? saved.contributions
            : { human: 0, memory: 1, machine: 0 }
        };
      });
    });
  }

  loadMemories() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "[]";
      const saved = JSON.parse(stored);
      if (!Array.isArray(saved)) return;
      saved.slice(-4).forEach(
        function addMemory(memory) {
          const validPattern =
            memory &&
            Array.isArray(memory.pattern) &&
            memory.pattern.length === TRACKS.length &&
            memory.pattern.every(function validateRow(row) {
              return typeof row === "string" && row.length === 16 && /^[01]+$/.test(row);
            });
          if (validPattern && memory.params && memory.id) {
            this.memories.push(memory);
          }
        }.bind(this)
      );
      if (!localStorage.getItem(STORAGE_KEY) && saved.length) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.slice(-4)));
      }
    } catch (error) {
      console.info("Локальная память пока пуста.");
    }
  }

  persistMemories() {
    try {
      const custom = this.memories.filter(function onlyCustom(memory) {
        return memory.custom;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(custom.slice(-4)));
    } catch (error) {
      this.logMachine("след звучит сейчас, но браузер не разрешил сохранить его локально");
    }
  }

  renderMemoryList() {
    this.el.memoryList.textContent = "";
    this.memories.forEach(
      function addMemoryCard(memory) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "memory-card";
        button.dataset.memoryId = memory.id;
        button.style.setProperty("--memory-color", memory.color || "#7fd4c1");
        button.setAttribute("aria-label", "Прослушать след «" + memory.name + "», " + memory.author);

        const glyph = document.createElement("span");
        glyph.className = "memory-glyph";
        glyph.setAttribute("aria-hidden", "true");

        const copy = document.createElement("span");
        const name = document.createElement("span");
        name.className = "memory-name";
        name.textContent = memory.name;
        const author = document.createElement("span");
        author.className = "memory-author";
        author.textContent = memory.author;
        copy.append(name, author);

        const play = document.createElement("span");
        play.className = "memory-play";
        play.setAttribute("aria-hidden", "true");
        play.textContent = "▷";

        button.append(glyph, copy, play);
        button.addEventListener(
          "click",
          function preview() {
            this.previewMemory(memory, button);
          }.bind(this)
        );
        this.el.memoryList.appendChild(button);
      }.bind(this)
    );
  }

  renderMemoryOptions() {
    const previousA = this.state.memoryA;
    const previousB = this.state.memoryB;
    const sourceSelects = [this.el.memoryA, this.el.memoryB, this.el.advMemoryA, this.el.advMemoryB].filter(Boolean);
    sourceSelects.forEach(function clear(select) {
      select.textContent = "";
    });

    this.memories.forEach(
      function addOption(memory) {
        sourceSelects.forEach(function append(select) {
          const option = document.createElement("option");
          option.value = memory.id;
          option.textContent = memory.name;
          select.appendChild(option);
        });
      }.bind(this)
    );

    this.state.memoryA = this.findMemory(previousA) ? previousA : this.memories[0].id;
    this.state.memoryB = this.findMemory(previousB)
      ? previousB
      : this.memories[Math.min(1, this.memories.length - 1)].id;
    this.el.memoryA.value = this.state.memoryA;
    this.el.memoryB.value = this.state.memoryB;
    this.el.advMemoryA.value = this.state.memoryA;
    this.el.advMemoryB.value = this.state.memoryB;
  }

  renderBeatRuler() {
    this.el.beatRuler.textContent = "";
    for (let index = 0; index < 16; index += 1) {
      const span = document.createElement("span");
      span.className = "beat-number" + (index % 4 === 0 ? " is-quarter" : "");
      span.textContent = String(index + 1).padStart(2, "0");
      this.el.beatRuler.appendChild(span);
    }
  }

  renderTracks() {
    this.el.trackRows.textContent = "";
    TRACKS.forEach(
      function renderTrack(track, trackIndex) {
        const meta = document.createElement("div");
        meta.className = "track-meta";
        meta.classList.toggle("is-latent", trackIndex >= this.state.structure.layers);
        meta.dataset.track = String(trackIndex);
        meta.style.setProperty("--track-color", track.color);
        meta.style.setProperty("--track-soft", track.soft);

        const mark = document.createElement("i");
        mark.className = "track-mark";
        mark.style.setProperty("--track-color", track.color);
        mark.style.setProperty("--track-glow", track.glow);
        mark.setAttribute("aria-hidden", "true");

        const copy = document.createElement("span");
        const name = document.createElement("strong");
        name.className = "track-name";
        name.textContent = track.name;
        const detail = document.createElement("span");
        detail.className = "track-detail";
        detail.textContent = track.detail;
        copy.append(name, detail);

        const mute = this.makeTrackToggle("M", "Заглушить дорожку " + track.name, trackIndex, "muted", track);
        const solo = this.makeTrackToggle("S", "Соло дорожки " + track.name, trackIndex, "solo", track);
        meta.append(mark, copy, mute, solo);

        const row = document.createElement("div");
        row.className = "step-row";
        row.classList.toggle("is-latent", trackIndex >= this.state.structure.layers);
        row.dataset.track = String(trackIndex);
        row.style.setProperty("--track-color", track.color);
        row.style.setProperty("--track-glow", track.glow);
        this.pattern[trackIndex].forEach(
          function renderStep(step, stepIndex) {
            row.appendChild(this.makeStepButton(trackIndex, stepIndex));
          }.bind(this)
        );

        this.el.trackRows.append(meta, row);
      }.bind(this)
    );
  }

  makeTrackToggle(label, ariaLabel, trackIndex, key, track) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-toggle";
    button.textContent = label;
    button.setAttribute("aria-label", ariaLabel);
    button.setAttribute("aria-pressed", String(this.trackState[trackIndex][key]));
    button.style.setProperty("--track-color", track.color);
    button.style.setProperty("--track-soft", track.soft);
    button.addEventListener(
      "click",
      function toggleTrack() {
        this.trackState[trackIndex][key] = !this.trackState[trackIndex][key];
        button.setAttribute("aria-pressed", String(this.trackState[trackIndex][key]));
        this.announce(
          TRACKS[trackIndex].name +
            (this.trackState[trackIndex][key] ? (key === "muted" ? " заглушён" : " играет соло") : " возвращён в общий рисунок")
        );
      }.bind(this)
    );
    return button;
  }

  makeStepButton(trackIndex, stepIndex) {
    const step = this.pattern[trackIndex][stepIndex];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "step" + (stepIndex % 4 === 0 ? " is-quarter" : "");
    button.dataset.track = String(trackIndex);
    button.dataset.step = String(stepIndex);
    button.style.setProperty("--velocity", String(step.velocity));

    button.addEventListener(
      "click",
      function toggleStep(event) {
        this.selectedStep = { track: trackIndex, step: stepIndex };
        if (event.shiftKey) {
          step.locked = !step.locked;
          this.stampHumanStep(step, 0.82);
          this.updateStepButton(button, trackIndex, stepIndex);
          this.renderAnatomy();
          this.announce(
            "Шаг " +
              (stepIndex + 1) +
              " дорожки " +
              TRACKS[trackIndex].name +
              (step.locked ? " закреплён" : " освобождён")
          );
          return;
        }

        step.active = !step.active;
        if (step.active) {
          step.velocity = clamp(step.velocity + 0.08, 0.45, 1);
        }
        this.stampHumanStep(step);
        this.updateStepButton(button, trackIndex, stepIndex);
        this.renderAnatomy();
        this.announce(
          "Шаг " +
            (stepIndex + 1) +
            " дорожки " +
            TRACKS[trackIndex].name +
            (step.active ? " включён" : " выключен")
        );
      }.bind(this)
    );

    button.addEventListener(
      "keydown",
      function lockWithKeyboard(event) {
        if (event.shiftKey && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          step.locked = !step.locked;
          this.stampHumanStep(step, 0.82);
          this.updateStepButton(button, trackIndex, stepIndex);
          this.renderAnatomy();
          this.announce(step.locked ? "Опорная точка закреплена" : "Опорная точка освобождена");
        }
      }.bind(this)
    );

    button.addEventListener(
      "contextmenu",
      function lockWithPointer(event) {
        event.preventDefault();
        this.selectedStep = { track: trackIndex, step: stepIndex };
        step.locked = !step.locked;
        this.stampHumanStep(step, 0.82);
        this.updateStepButton(button, trackIndex, stepIndex);
        this.renderAnatomy();
      }.bind(this)
    );

    this.updateStepButton(button, trackIndex, stepIndex);
    return button;
  }

  updateStepButton(button, trackIndex, stepIndex) {
    const step = this.pattern[trackIndex][stepIndex];
    const memoryGate = this.memoryGate(trackIndex, stepIndex);
    button.classList.toggle("is-active", step.active);
    button.classList.toggle("is-locked", step.locked);
    button.classList.toggle("is-memory", memoryGate > 0.22);
    button.classList.toggle("origin-human", step.origin === "human");
    button.classList.toggle("origin-machine", step.origin === "machine");
    button.classList.toggle("is-selected", this.selectedStep.track === trackIndex && this.selectedStep.step === stepIndex);
    button.style.setProperty("--velocity", String(step.velocity));
    button.style.setProperty("--phase", String(step.phase));
    button.dataset.origin = step.origin;
    button.setAttribute("aria-pressed", String(step.active));
    button.setAttribute(
      "aria-label",
      TRACKS[trackIndex].name +
        ", шаг " +
        (stepIndex + 1) +
        (step.active ? ", включён" : ", выключен") +
        (step.locked ? ", закреплён" : "") +
        ". Shift плюс клик закрепляет шаг."
    );
  }

  refreshSteps() {
    document.querySelectorAll(".step").forEach(
      function refresh(button) {
        this.updateStepButton(button, Number(button.dataset.track), Number(button.dataset.step));
      }.bind(this)
    );
  }

  updateMemoryIndicators() {
    if (!this.el.trackRows.children.length) return;
    this.refreshSteps();
  }

  findMemory(id) {
    return this.memories.find(function match(memory) {
      return memory.id === id;
    });
  }

  getMemoryPair() {
    return [this.findMemory(this.state.memoryA) || this.memories[0], this.findMemory(this.state.memoryB) || this.memories[0]];
  }

  memoryGate(trackIndex, stepIndex) {
    const pair = this.getMemoryPair();
    const activeA = pair[0].pattern[trackIndex][stepIndex] === "1" ? 1 : 0;
    const activeB = pair[1].pattern[trackIndex][stepIndex] === "1" ? 1 : 0;
    return lerp(activeA, activeB, this.state.morph);
  }

  memoryParams() {
    const pair = this.getMemoryPair();
    return {
      root: Math.round(lerp(pair[0].params.root, pair[1].params.root, this.state.morph)),
      timbre: lerp(pair[0].params.timbre, pair[1].params.timbre, this.state.morph),
      cutoff: expLerp(pair[0].params.cutoff, pair[1].params.cutoff, this.state.morph),
      decay: lerp(pair[0].params.decay, pair[1].params.decay, this.state.morph),
      fm: lerp(pair[0].params.fm, pair[1].params.fm, this.state.morph)
    };
  }

  renderOrbitRatios() {
    this.el.orbitRatios.textContent = "";
    TRACKS.forEach(
      function addRatio(track, index) {
        const label = document.createElement("label");
        label.className = "orbit-ratio";
        const heading = document.createElement("span");
        const name = document.createElement("b");
        const output = document.createElement("output");
        name.textContent = track.name;
        output.textContent = this.state.orbitRatios[index].toFixed(3) + "×";
        heading.append(name, output);
        const input = document.createElement("input");
        input.type = "range";
        input.min = "50";
        input.max = "150";
        input.value = String(Math.round(this.state.orbitRatios[index] * 100));
        input.dataset.orbitTrack = String(index);
        input.addEventListener(
          "input",
          function changeRatio() {
            this.state.orbitRatios[index] = Number(input.value) / 100;
            output.textContent = this.state.orbitRatios[index].toFixed(2) + "×";
            this.updateTimeVisuals();
          }.bind(this)
        );
        label.append(heading, input);
        this.el.orbitRatios.appendChild(label);
      }.bind(this)
    );
  }

  renderVoiceControls() {
    this.el.voiceControls.textContent = "";
    const toneLabels = ["Высота атаки", "Форма и срез", "Цвет шума", "FM index"];
    TRACKS.forEach(
      function addVoice(track, trackIndex) {
        const module = document.createElement("section");
        module.className = "voice-module";
        module.style.setProperty("--voice-color", track.color);
        const heading = document.createElement("div");
        heading.className = "voice-heading";
        const mark = document.createElement("i");
        mark.setAttribute("aria-hidden", "true");
        const title = document.createElement("strong");
        title.textContent = track.name;
        const state = document.createElement("small");
        state.textContent = trackIndex < this.state.structure.layers ? "явный слой" : "латентный слой";
        heading.append(mark, title, state);
        module.appendChild(heading);

        [
          ["level", "Уровень"],
          ["tone", toneLabels[trackIndex]],
          ["decay", "Длительность"],
          ["space", "Пространство"]
        ].forEach(
          function addVoiceParam(config) {
            const key = config[0];
            const label = document.createElement("label");
            const copy = document.createElement("span");
            const name = document.createElement("b");
            const output = document.createElement("output");
            name.textContent = config[1];
            output.textContent = Math.round(this.voiceState[trackIndex][key] * 100) + "%";
            copy.append(name, output);
            const input = document.createElement("input");
            input.type = "range";
            input.min = "0";
            input.max = "100";
            input.value = String(Math.round(this.voiceState[trackIndex][key] * 100));
            input.dataset.voiceTrack = String(trackIndex);
            input.dataset.voiceParam = key;
            input.addEventListener(
              "input",
              function changeVoice() {
                this.voiceState[trackIndex][key] = Number(input.value) / 100;
                output.textContent = Math.round(this.voiceState[trackIndex][key] * 100) + "%";
                this.applyAudioParams();
              }.bind(this)
            );
            label.append(copy, input);
            module.appendChild(label);
          }.bind(this)
        );
        this.el.voiceControls.appendChild(module);
      }.bind(this)
    );
  }

  renderAnatomy() {
    if (!this.el.memoryParameterRows) return;
    const pair = this.getMemoryPair();
    const result = this.memoryParams();
    this.el.anatomyMemoryA.textContent = pair[0].name;
    this.el.anatomyMemoryB.textContent = pair[1].name;
    this.el.anatomyMorph.textContent = Math.round(this.state.morph * 100) + "%";
    this.el.advMemoryA.value = this.state.memoryA;
    this.el.advMemoryB.value = this.state.memoryB;
    this.el.memoryParameterRows.textContent = "";

    [
      ["root", "Основной тон", "note"],
      ["timbre", "Форма волны", "percent"],
      ["cutoff", "Срез фильтра", "hz"],
      ["decay", "Затухание", "seconds"],
      ["fm", "FM index", "decimal"]
    ].forEach(
      function addMemoryParam(config) {
        const row = document.createElement("tr");
        const name = document.createElement("th");
        const valueA = document.createElement("td");
        const valueB = document.createElement("td");
        const actual = document.createElement("td");
        name.textContent = config[1];
        valueA.textContent = this.formatParameter(pair[0].params[config[0]], config[2]);
        valueB.textContent = this.formatParameter(pair[1].params[config[0]], config[2]);
        actual.textContent = this.formatParameter(result[config[0]], config[2]);
        actual.className = "actual-value";
        row.append(name, valueA, valueB, actual);
        this.el.memoryParameterRows.appendChild(row);
      }.bind(this)
    );

    this.el.advMorph.value = Math.round(this.state.morph * 100);
    this.el.advWarmth.value = Math.round(this.state.warmth * 100);
    this.el.advEcho.value = Math.round(this.state.echo * 100);
    this.el.advDensity.value = Math.round(this.state.density * 100);
    this.el.advAgency.value = Math.round(this.state.agency * 100);
    this.el.advDrift.value = Math.round(this.state.drift * 100);
    this.el.advQuantize.value = Math.round(this.state.quantize * 100);
    this.el.advBreath.value = Math.round(this.state.breathDepth * 100);
    this.el.advCycleDrift.value = Math.round(this.state.cycleDrift * 100);
    this.el.advAttraction.value = Math.round(this.state.orbitAttraction * 100);
    this.el.advTiming.value = Math.round(this.state.machine.timingMs);
    this.el.advVelocity.value = Math.round(this.state.machine.velocityDrift * 100);
    this.el.advDetune.value = Math.round(this.state.machine.detuneCents);
    this.el.advRatchet.value = Math.round(this.state.machine.ratchetChance * 100);
    this.el.advMemoryChance.value = Math.round(this.state.machine.memoryChance * 100);
    this.el.advMutationNodes.value = Math.round(this.state.machine.mutationNodes);
    this.el.fxFeedback.value = Math.round(this.state.fx.feedback * 100);
    this.el.fxDelayWet.value = Math.round(this.state.fx.delayWet * 100);
    this.el.fxReverbWet.value = Math.round(this.state.fx.reverbWet * 100);
    this.el.fxDrive.value = Math.round(this.state.fx.drive * 100);
    this.renderEventInspector();
    this.renderInfluence();
    this.renderDiagnostics();

    this.el.voiceControls.querySelectorAll("[data-voice-track]").forEach(
      function syncVoice(input) {
        const track = Number(input.dataset.voiceTrack);
        const key = input.dataset.voiceParam;
        input.value = Math.round(this.voiceState[track][key] * 100);
        const output = input.parentElement.querySelector("output");
        if (output) output.textContent = input.value + "%";
      }.bind(this)
    );
    this.el.voiceControls.querySelectorAll(".voice-module").forEach(
      function markLatent(module, index) {
        module.classList.toggle("is-latent", index >= this.state.structure.layers);
        const state = module.querySelector(".voice-heading small");
        if (state) state.textContent = index < this.state.structure.layers ? "явный слой" : "латентный слой";
      }.bind(this)
    );
  }

  formatParameter(value, type) {
    if (type === "note") return "MIDI " + Math.round(value);
    if (type === "percent") return Math.round(value * 100) + "%";
    if (type === "hz") return value >= 1000 ? (value / 1000).toFixed(2) + " kHz" : Math.round(value) + " Hz";
    if (type === "seconds") return Number(value).toFixed(2) + " s";
    return Number(value).toFixed(2);
  }

  renderEventInspector() {
    const trackIndex = this.selectedStep.track;
    const stepIndex = this.selectedStep.step;
    const step = this.pattern[trackIndex][stepIndex];
    const latest = this.eventLog.find(function findLatest(event) {
      return event.track === trackIndex && event.step === stepIndex;
    });
    this.el.eventInspector.textContent = "";

    const heading = document.createElement("div");
    heading.className = "inspector-heading";
    const title = document.createElement("strong");
    title.textContent = TRACKS[trackIndex].name + " · узел " + String(stepIndex + 1).padStart(2, "0");
    const origin = document.createElement("span");
    origin.className = "origin-badge origin-" + step.origin;
    origin.textContent =
      step.origin === "human" ? "ваш жест" : step.origin === "machine" ? "ответ машины" : "унаследован";
    heading.append(title, origin);

    const lineage = document.createElement("div");
    lineage.className = "lineage-bar";
    ["human", "memory", "machine"].forEach(function addShare(key) {
      const share = document.createElement("i");
      share.className = "lineage-" + key;
      share.style.width = Math.round(step.contributions[key] * 100) + "%";
      lineage.appendChild(share);
    });

    const facts = document.createElement("dl");
    facts.className = "event-facts";
    const factEntries = [
      ["Фаза", step.phase.toFixed(3)],
      ["Родители", step.parents.join(" + ")],
      ["Поколение", String(step.generation)],
      ["Последнее изменение", step.lastChangedBy],
      ["Реальное время", latest ? (latest.timingMs >= 0 ? "+" : "") + latest.timingMs.toFixed(1) + " мс" : "ещё не звучал"],
      ["Реальный строй", latest ? (latest.detune >= 0 ? "+" : "") + latest.detune.toFixed(1) + " ct" : "—"],
      ["Ratchet", latest ? "×" + latest.ratchet : "—"]
    ];
    factEntries.forEach(function addFact(entry) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = entry[0];
      dd.textContent = entry[1];
      facts.append(dt, dd);
    });

    const controls = document.createElement("div");
    controls.className = "event-controls";
    controls.append(
      this.makeInspectorCheck("Событие активно", step.active, function changeActive(checked) {
        step.active = checked;
        this.stampHumanStep(step);
      }.bind(this)),
      this.makeInspectorCheck("Закреплено человеком", step.locked, function changeLocked(checked) {
        step.locked = checked;
        this.stampHumanStep(step);
      }.bind(this)),
      this.makeInspectorRange("Velocity", 0, 100, Math.round(step.velocity * 100), function changeVelocity(value) {
        step.velocity = value / 100;
        this.stampHumanStep(step);
      }.bind(this)),
      this.makeInspectorRange("Вероятность", 0, 100, Math.round(step.probability * 100), function changeProbability(value) {
        step.probability = value / 100;
        this.stampHumanStep(step);
      }.bind(this)),
      this.makeInspectorRange("Высота MIDI", 36, 84, Math.round(step.note), function changeNote(value) {
        step.note = value;
        this.stampHumanStep(step);
      }.bind(this))
    );
    this.el.eventInspector.append(heading, lineage, facts, controls);
  }

  makeInspectorCheck(labelText, checked, handler) {
    const label = document.createElement("label");
    label.className = "inspector-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    const text = document.createElement("span");
    text.textContent = labelText;
    input.addEventListener(
      "change",
      function inspectorCheckChange() {
        handler(input.checked);
        this.refreshSteps();
        this.renderAnatomy();
      }.bind(this)
    );
    label.append(input, text);
    return label;
  }

  makeInspectorRange(labelText, min, max, value, handler) {
    const label = document.createElement("label");
    const copy = document.createElement("span");
    const name = document.createElement("b");
    const output = document.createElement("output");
    name.textContent = labelText;
    output.textContent = String(value);
    copy.append(name, output);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener(
      "input",
      function inspectorRangeChange() {
        const next = Number(input.value);
        output.textContent = String(next);
        handler(next);
        this.refreshSteps();
      }.bind(this)
    );
    input.addEventListener("change", this.renderAnatomy.bind(this));
    label.append(copy, input);
    return label;
  }

  stampHumanStep(step, share) {
    const humanShare = Number.isFinite(share) ? share : 0.78;
    step.origin = "human";
    step.lastChangedBy = "human";
    step.parents = Array.from(new Set(step.parents.concat(["human"])));
    step.generation += 1;
    step.contributions = { human: humanShare, memory: 1 - humanShare, machine: 0 };
  }

  renderInfluence() {
    const recent = this.eventLog.filter(
      function recentCycle(event) {
        return event.cycle >= this.cycle - 1;
      }.bind(this)
    );
    const totals = recent.reduce(
      function sumContributions(acc, event) {
        acc.human += event.contributions.human || 0;
        acc.memory += event.contributions.memory || 0;
        acc.machine += event.contributions.machine || 0;
        return acc;
      },
      { human: 0, memory: 0, machine: 0 }
    );
    const sum = totals.human + totals.memory + totals.machine;
    const human = sum ? totals.human / sum : 0;
    const memory = sum ? totals.memory / sum : 0;
    const machine = sum ? totals.machine / sum : 0;
    this.el.humanInfluence.style.width = human * 100 + "%";
    this.el.memoryInfluence.style.width = memory * 100 + "%";
    this.el.machineInfluence.style.width = machine * 100 + "%";
    this.el.humanInfluenceOut.textContent = Math.round(human * 100) + "%";
    this.el.memoryInfluenceOut.textContent = Math.round(memory * 100) + "%";
    this.el.machineInfluenceOut.textContent = Math.round(machine * 100) + "%";
    this.el.influenceSummary.textContent = recent.length
      ? recent.length + " событий · " + TIME_MODES[this.state.timeMode].label + " · " + this.state.structure.label
      : "сессия ещё не звучала";
  }

  renderDiagnostics() {
    const audioState = this.ctx ? this.ctx.state : "не создан";
    this.el.diagnosticsBody.textContent =
      "AudioContext: " +
      audioState +
      " · scheduler: 25 ms / horizon 120 ms · compressor: −18 dB, ratio 4:1 · " +
      "noise/reverb seed: " +
      seedToHex(this.state.seed) +
      " · активных слоёв: " +
      Math.round(this.state.structure.layers) +
      " · журнал: " +
      this.eventLog.length +
      " событий.";
  }

  bindEvents() {
    this.el.wakeButton.addEventListener("click", this.wake.bind(this));
    this.el.exploreSilent.addEventListener("click", this.exploreSilently.bind(this));
    this.el.playToggle.addEventListener("click", this.togglePlay.bind(this));
    this.el.viewMeeting.addEventListener("click", this.setView.bind(this, "meeting"));
    this.el.viewAnatomy.addEventListener("click", this.setView.bind(this, "anatomy"));

    document.querySelectorAll("button[data-time-mode]").forEach(
      function bindTimeMode(button) {
        button.addEventListener(
          "click",
          function chooseTimeMode() {
            this.setTimeMode(button.dataset.timeMode);
          }.bind(this)
        );
      }.bind(this)
    );

    document.querySelectorAll("[data-profile]").forEach(
      function bindProfile(button) {
        button.addEventListener(
          "click",
          function chooseProfile() {
            this.setStructureProfile(Number(button.dataset.profile), true);
          }.bind(this)
        );
      }.bind(this)
    );

    this.el.branching.addEventListener(
      "input",
      function branchStructure() {
        this.setStructureProfile(Number(this.el.branching.value), false);
      }.bind(this)
    );
    this.el.branching.addEventListener(
      "change",
      function announceStructure() {
        this.logMachine("структура раскрылась до состояния «" + this.state.structure.label + "»; скрытые слои не удалены");
        this.announce("Структура: " + this.state.structure.label);
      }.bind(this)
    );

    this.el.pulseGuide.addEventListener(
      "pointerdown",
      function beginPulseGuide(event) {
        event.preventDefault();
        this.guidePressed = true;
        this.listenToPulse();
      }.bind(this)
    );
    ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach(
      function bindPulseRelease(eventName) {
        this.el.pulseGuide.addEventListener(eventName, this.stopPulseGuide.bind(this));
      }.bind(this)
    );
    this.el.pulseGuide.addEventListener(
      "keydown",
      function beginPulseGuideWithKeyboard(event) {
        if ((event.key !== " " && event.key !== "Enter") || event.repeat) return;
        event.preventDefault();
        this.guidePressed = true;
        this.listenToPulse();
      }.bind(this)
    );
    this.el.pulseGuide.addEventListener(
      "keyup",
      function releasePulseGuideWithKeyboard(event) {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        this.stopPulseGuide();
      }.bind(this)
    );
    this.el.pulseGuide.addEventListener("blur", this.stopPulseGuide.bind(this));
    window.addEventListener("blur", this.stopPulseGuide.bind(this));

    this.el.memoryA.addEventListener(
      "change",
      function changeMemoryA() {
        this.state.memoryA = this.el.memoryA.value;
        this.el.advMemoryA.value = this.state.memoryA;
        this.updateMemoryIndicators();
        this.renderAnatomy();
        this.logMachine("источник A принял след «" + this.findMemory(this.state.memoryA).name + "»");
      }.bind(this)
    );

    this.el.memoryB.addEventListener(
      "change",
      function changeMemoryB() {
        this.state.memoryB = this.el.memoryB.value;
        this.el.advMemoryB.value = this.state.memoryB;
        this.updateMemoryIndicators();
        this.renderAnatomy();
        this.logMachine("источник B принял след «" + this.findMemory(this.state.memoryB).name + "»");
      }.bind(this)
    );

    this.el.advMemoryA.addEventListener(
      "change",
      function changeAdvancedMemoryA() {
        this.state.memoryA = this.el.advMemoryA.value;
        this.el.memoryA.value = this.state.memoryA;
        this.updateMemoryIndicators();
        this.renderAnatomy();
        this.logMachine("источник A принял след «" + this.findMemory(this.state.memoryA).name + "»");
      }.bind(this)
    );

    this.el.advMemoryB.addEventListener(
      "change",
      function changeAdvancedMemoryB() {
        this.state.memoryB = this.el.advMemoryB.value;
        this.el.memoryB.value = this.state.memoryB;
        this.updateMemoryIndicators();
        this.renderAnatomy();
        this.logMachine("источник B принял след «" + this.findMemory(this.state.memoryB).name + "»");
      }.bind(this)
    );

    this.bindRange("morph", function setMorph(value) {
      this.state.morph = value / 100;
      this.updateMemoryIndicators();
      this.renderAnatomy();
    });
    this.bindRange("warmth", function setWarmth(value) {
      this.state.warmth = value / 100;
      this.applyAudioParams();
    });
    this.bindRange("echo", function setEcho(value) {
      this.state.echo = value / 100;
      this.applyAudioParams();
    });
    this.bindRange("density", function setDensity(value) {
      this.state.density = value / 100;
    });
    this.bindRange("advMorph", function setAdvancedMorph(value) {
      this.state.morph = value / 100;
      this.el.morph.value = value;
      this.updateMemoryIndicators();
      this.renderAnatomy();
    });
    this.bindRange("advWarmth", function setAdvancedWarmth(value) {
      this.state.warmth = value / 100;
      this.el.warmth.value = value;
      this.applyAudioParams();
    });
    this.bindRange("advEcho", function setAdvancedEcho(value) {
      this.state.echo = value / 100;
      this.el.echo.value = value;
      this.applyAudioParams();
    });
    this.bindRange("advDensity", function setAdvancedDensity(value) {
      this.state.density = value / 100;
      this.el.density.value = value;
    });
    this.bindRange("bpm", function setBpm(value) {
      this.state.bpm = value;
      this.applyAudioParams();
    });
    this.bindRange("swing", function setSwing(value) {
      this.state.swing = value / 100;
    });
    this.bindRange("master", function setMaster(value) {
      this.state.master = value / 100;
      this.applyAudioParams();
    });

    this.bindRange("advQuantize", function setQuantize(value) {
      this.state.quantize = value / 100;
      this.updateTimeVisuals();
    });
    this.bindRange("advBreath", function setBreath(value) {
      this.state.breathDepth = value / 100;
      this.regenerateBreathWeights();
      this.updateTimeVisuals();
    });
    this.bindRange("advCycleDrift", function setCycleDrift(value) {
      this.state.cycleDrift = value / 100;
    });
    this.bindRange("advAttraction", function setAttraction(value) {
      this.state.orbitAttraction = value / 100;
    });
    this.bindRange("advTiming", function setTiming(value) {
      this.state.machine.timingMs = value;
    });
    this.bindRange("advAgency", function setAdvancedAgency(value) {
      this.state.agency = value / 100;
    });
    this.bindRange("advDrift", function setAdvancedDrift(value) {
      this.state.drift = value / 100;
    });
    this.bindRange("advVelocity", function setVelocityDrift(value) {
      this.state.machine.velocityDrift = value / 100;
    });
    this.bindRange("advDetune", function setDetune(value) {
      this.state.machine.detuneCents = value;
    });
    this.bindRange("advRatchet", function setRatchet(value) {
      this.state.machine.ratchetChance = value / 100;
    });
    this.bindRange("advMemoryChance", function setMemoryChance(value) {
      this.state.machine.memoryChance = value / 100;
    });
    this.bindRange("advMutationNodes", function setMutationNodes(value) {
      this.state.machine.mutationNodes = value;
    });

    this.bindStructureAxis("axisLayers", "layers", 1);
    this.bindStructureAxis("axisIndependence", "independence", 0.01);
    this.bindStructureAxis("axisConnections", "connections", 0.01);
    this.bindStructureAxis("axisMemory", "memoryDepth", 0.01);

    this.bindRange("fxFeedback", function setFeedback(value) {
      this.state.fx.feedback = value / 100;
      this.applyAudioParams();
    });
    this.bindRange("fxDelayWet", function setDelayWet(value) {
      this.state.fx.delayWet = value / 100;
      this.applyAudioParams();
    });
    this.bindRange("fxReverbWet", function setReverbWet(value) {
      this.state.fx.reverbWet = value / 100;
      this.applyAudioParams();
    });
    this.bindRange("fxDrive", function setDrive(value) {
      this.state.fx.drive = value / 100;
      this.applyAudioParams();
    });

    this.el.mutate.addEventListener("click", this.mutate.bind(this));
    this.el.undo.addEventListener("click", this.undo.bind(this));
    this.el.newMeeting.addEventListener("click", this.newMeeting.bind(this));
    this.el.saveMemory.addEventListener("click", this.saveMemory.bind(this));

    this.el.agencyPad.addEventListener("pointerdown", this.updatePadFromPointer.bind(this));
    this.el.agencyPad.addEventListener("pointermove", this.updatePadFromPointer.bind(this));
    this.el.agencyPad.addEventListener("keydown", this.updatePadFromKeyboard.bind(this));
  }

  bindRange(id, handler) {
    this.el[id].addEventListener(
      "input",
      function updateRange() {
        const value = Number(this.el[id].value);
        handler.call(this, value);
        this.updateAllReadouts();
      }.bind(this)
    );
  }

  bindStructureAxis(id, key, scale) {
    this.bindRange(
      id,
      function setStructureAxis(value) {
        this.state.structure[key] = value * scale;
        this.state.structure.id = "custom";
        this.state.structure.label = "Свой контур";
        this.state.structureProfile = -1;
        this.el.branchingOut.value = "Свой контур";
        this.updateStructureVisuals();
        this.resetSchedulerClock();
      }.bind(this)
    );
  }

  setView(view) {
    if (view !== "meeting" && view !== "anatomy") return;
    this.state.view = view;
    document.body.dataset.view = view;
    document.querySelectorAll(".meeting-surface").forEach(function toggle(surface) {
      surface.hidden = view !== "meeting";
      surface.inert = view !== "meeting";
    });
    this.el.anatomyView.hidden = view !== "anatomy";
    this.el.anatomyView.inert = view !== "anatomy";
    this.el.viewMeeting.classList.toggle("is-active", view === "meeting");
    this.el.viewAnatomy.classList.toggle("is-active", view === "anatomy");
    this.el.viewMeeting.setAttribute("aria-pressed", String(view === "meeting"));
    this.el.viewAnatomy.setAttribute("aria-pressed", String(view === "anatomy"));
    if (view === "meeting") {
      this.updateTimeVisuals();
    } else {
      this.renderAnatomy();
    }
    this.announce(view === "meeting" ? "Открыта поверхность Встреча" : "Открыта Анатомия памяти");
  }

  setTimeMode(mode) {
    if (!TIME_MODES[mode] || mode === this.state.timeMode) return;
    this.state.timeMode = mode;
    this.regenerateBreathWeights();
    this.updateTimeVisuals();
    this.resetSchedulerClock();
    this.renderAnatomy();
    this.logMachine("время перешло в режим «" + TIME_MODES[mode].label + "»: " + TIME_MODES[mode].note.toLowerCase());
    this.announce("Режим времени: " + TIME_MODES[mode].label);
  }

  setStructureProfile(index, recordUndo) {
    const profile = STRUCTURE_PROFILES[index];
    if (!profile) return;
    if (recordUndo) this.snapshotForUndo("разветвление");
    this.state.structureProfile = index;
    this.state.structure = clone(profile);
    this.el.branching.value = String(index);
    this.updateStructureVisuals();
    this.resetSchedulerClock();
  }

  updateStructureVisuals() {
    const structure = this.state.structure;
    this.el.branchingOut.value = structure.label;
    this.el.branchingNote.textContent = structure.note || "Параметры структуры настроены вручную.";
    this.el.structureState.textContent = structure.label;
    this.el.structureDescription.textContent =
      structure.note || "Собственный контур сохраняет все скрытые слои и ваши закреплённые точки.";

    this.el.axisLayers.value = Math.round(structure.layers);
    this.el.axisIndependence.value = Math.round(structure.independence * 100);
    this.el.axisConnections.value = Math.round(structure.connections * 100);
    this.el.axisMemory.value = Math.round(structure.memoryDepth * 100);
    this.el.axisLayersOut.value = Math.round(structure.layers);
    this.el.axisIndependenceOut.value = Math.round(structure.independence * 100) + "%";
    this.el.axisConnectionsOut.value = Math.round(structure.connections * 100) + "%";
    this.el.axisMemoryOut.value = Math.round(structure.memoryDepth * 100) + "%";

    document.querySelectorAll("[data-profile]").forEach(
      function markProfile(button) {
        const active = Number(button.dataset.profile) === this.state.structureProfile;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }.bind(this)
    );

    document.querySelectorAll(".track-meta, .step-row").forEach(
      function foldTrack(element) {
        const trackIndex = Number(element.dataset.track);
        element.classList.toggle("is-latent", trackIndex >= structure.layers);
      }
    );
    this.applyAudioParams();
    this.renderAnatomy();
  }

  async listenToPulse() {
    if (!this.ctx) await this.wake();
    if (!this.ctx || !this.guidePressed || this.guideActive) return;
    this.guideActive = true;
    this.el.pulseGuide.classList.add("is-listening");
    this.el.pulseGuide.setAttribute("aria-pressed", "true");
    if (!this.isPlaying) this.start();
    this.logMachine("опорный пульс проявился, пока вы удерживаете жест");
    this.announce("Опорный пульс включён на время удержания");
  }

  stopPulseGuide() {
    this.guidePressed = false;
    if (!this.guideActive) return;
    this.guideActive = false;
    this.el.pulseGuide.classList.remove("is-listening");
    this.el.pulseGuide.setAttribute("aria-pressed", "false");
    this.announce("Опорный пульс снова скрыт");
  }

  regenerateBreathWeights() {
    const localRandom = mulberry32((this.state.seed ^ (this.cycle * 2654435761)) >>> 0);
    const depth = this.state.breathDepth;
    const raw = [];
    for (let index = 0; index < 16; index += 1) {
      const wave = Math.sin((index / 16) * Math.PI * 2 + this.cycle * 0.47) * 0.42;
      const noise = (localRandom() - 0.5) * 0.7;
      const hasAnchor = this.pattern.some(function hasLocked(row) {
        return row[index].locked;
      });
      const amount = hasAnchor ? depth * 0.18 : depth;
      raw.push(Math.max(0.28, 1 + (wave + noise) * amount));
    }
    const sum = raw.reduce(function add(total, value) {
      return total + value;
    }, 0);
    this.breathWeights = raw.map(function normalize(value) {
      return (value / sum) * 16;
    });
  }

  updateTimeVisuals() {
    document.body.dataset.timeMode = this.state.timeMode;
    const grid = document.getElementById("sequenceGrid");
    if (grid) grid.dataset.timeMode = this.state.timeMode;
    document.querySelectorAll("button[data-time-mode]").forEach(
      function markTimeMode(button) {
        const active = button.dataset.timeMode === this.state.timeMode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      }.bind(this)
    );

    const cumulative = [0];
    for (let index = 1; index < 16; index += 1) {
      cumulative[index] = cumulative[index - 1] + this.breathWeights[index - 1] / 16;
    }
    document.querySelectorAll(".step-row").forEach(
      function positionRow(row) {
        const trackIndex = Number(row.dataset.track);
        const rowWidth = row.getBoundingClientRect().width || 540;
        row.querySelectorAll(".step").forEach(
          function positionStep(button) {
            const stepIndex = Number(button.dataset.step);
            let shift = 0;
            if (this.state.timeMode === "breath") {
              shift = (cumulative[stepIndex] - stepIndex / 16) * rowWidth * (1 - this.state.quantize * 0.72);
            } else if (this.state.timeMode === "orbits") {
              const ratio = this.state.orbitRatios[trackIndex];
              shift = Math.sin(stepIndex * 0.82 + trackIndex * 1.7) * 14 * (1 - this.state.orbitAttraction) * ratio;
            }
            button.style.setProperty("--time-shift", clamp(shift, -22, 22).toFixed(2) + "px");
          }.bind(this)
        );
      }.bind(this)
    );
  }

  resetSchedulerClock() {
    if (!this.ctx || !this.isPlaying) return;
    this.nextNoteTime = this.ctx.currentTime + 0.08;
    this.currentStep = 0;
    this.orbitSteps = [0, 0, 0, 0];
    this.orbitNextTimes = [0, 0, 0, 0].map(
      function setOrbitTime(_, index) {
        return this.ctx.currentTime + 0.08 + index * 0.014;
      }.bind(this)
    );
  }

  updateAllReadouts() {
    this.el.morphOut.value = Math.round(this.state.morph * 100) + "%";
    this.el.warmthOut.value = Math.round(this.state.warmth * 100) + "%";
    this.el.echoOut.value = Math.round(this.state.echo * 100) + "%";
    this.el.densityOut.value = Math.round(this.state.density * 100) + "%";
    this.el.bpmOut.value = Math.round(this.state.bpm);
    this.el.swingOut.value = Math.round(this.state.swing * 100) + "%";
    this.el.masterOut.value = Math.round(this.state.master * 100) + "%";
    this.el.agencyValue.textContent = Math.round(this.state.agency * 100) + "%";
    this.el.driftValue.textContent = Math.round(this.state.drift * 100) + "%";
    this.el.advMorphOut.value = Math.round(this.state.morph * 100) + "%";
    this.el.advWarmthOut.value = Math.round(this.state.warmth * 100) + "%";
    this.el.advEchoOut.value = Math.round(this.state.echo * 100) + "%";
    this.el.advDensityOut.value = Math.round(this.state.density * 100) + "%";
    this.el.advAgencyOut.value = Math.round(this.state.agency * 100) + "%";
    this.el.advDriftOut.value = Math.round(this.state.drift * 100) + "%";
    this.el.sessionSeed.textContent = "seed " + seedToHex(this.state.seed);
    this.el.padCursor.style.left = this.state.agency * 100 + "%";
    this.el.padCursor.style.top = (1 - this.state.drift) * 100 + "%";
    this.el.advQuantizeOut.value = Math.round(this.state.quantize * 100) + "%";
    this.el.advBreathOut.value = Math.round(this.state.breathDepth * 100) + "%";
    this.el.advCycleDriftOut.value = Math.round(this.state.cycleDrift * 100) + "%";
    this.el.advAttractionOut.value = Math.round(this.state.orbitAttraction * 100) + "%";
    this.el.advTimingOut.value = "±" + Math.round(this.state.machine.timingMs) + " мс";
    this.el.advVelocityOut.value = "±" + Math.round(this.state.machine.velocityDrift * 100) + "%";
    this.el.advDetuneOut.value = "±" + Math.round(this.state.machine.detuneCents) + " ct";
    this.el.advRatchetOut.value = Math.round(this.state.machine.ratchetChance * 100) + "%";
    this.el.advMemoryChanceOut.value = Math.round(this.state.machine.memoryChance * 100) + "%";
    this.el.advMutationNodesOut.value = Math.round(this.state.machine.mutationNodes);
    this.el.fxFeedbackOut.value = Math.round(this.state.fx.feedback * 100) + "%";
    this.el.fxDelayWetOut.value = Math.round(this.state.fx.delayWet * 100) + "%";
    this.el.fxReverbWetOut.value = Math.round(this.state.fx.reverbWet * 100) + "%";
    this.el.fxDriveOut.value = Math.round(this.state.fx.drive * 100) + "%";
    this.updateStructureVisuals();
  }

  updatePadFromPointer(event) {
    if (event.type === "pointermove" && event.buttons !== 1) return;
    const bounds = this.el.agencyPad.getBoundingClientRect();
    this.state.agency = clamp((event.clientX - bounds.left) / bounds.width, 0.03, 0.97);
    this.state.drift = clamp(1 - (event.clientY - bounds.top) / bounds.height, 0.03, 0.97);
    this.updateAllReadouts();
  }

  updatePadFromKeyboard(event) {
    const amount = event.shiftKey ? 0.1 : 0.03;
    if (event.key === "ArrowLeft") this.state.agency -= amount;
    else if (event.key === "ArrowRight") this.state.agency += amount;
    else if (event.key === "ArrowDown") this.state.drift -= amount;
    else if (event.key === "ArrowUp") this.state.drift += amount;
    else return;
    event.preventDefault();
    this.state.agency = clamp(this.state.agency, 0.03, 0.97);
    this.state.drift = clamp(this.state.drift, 0.03, 0.97);
    this.updateAllReadouts();
  }

  async wake() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.el.audioState.textContent = "Web Audio недоступен";
        this.el.wakeButton.disabled = true;
        this.el.wakeButton.querySelector("span").textContent = "Откройте инструмент в Chrome или Safari";
        this.el.wakeLayer.querySelector(".wake-card > p:not(.eyebrow)").textContent =
          "Этот просмотрщик не умеет воспроизводить Web Audio. Откройте тот же адрес в Chrome или Safari — интерфейс и синтезатор уже готовы.";
        return;
      }
      this.ctx = new AudioContextClass();
      this.initAudio();
    }

    await this.ctx.resume();
    this.el.wakeLayer.classList.add("is-hidden");
    this.el.wakeLayer.setAttribute("aria-hidden", "true");
    this.el.audioState.textContent = "инструмент бодрствует";
    this.el.stateDot.classList.add("is-awake");
    this.logMachine("память открылась: четыре следа вошли в общий цикл");
    this.announce("Инструмент разбужен и начал играть");
    this.start();
  }

  exploreSilently() {
    this.el.wakeLayer.classList.add("is-hidden");
    this.el.wakeLayer.setAttribute("aria-hidden", "true");
    this.el.audioState.textContent = "режим без звука";
    this.setView("anatomy");
    this.announce("Анатомия открыта без запуска аудио");
  }

  initAudio() {
    const ctx = this.ctx;
    this.masterBus = ctx.createGain();
    this.saturator = ctx.createWaveShaper();
    this.saturator.oversample = "2x";
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.24;
    this.masterGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyserData = new Uint8Array(this.analyser.fftSize);

    this.delayInput = ctx.createGain();
    this.delay = ctx.createDelay(2);
    this.delayFeedback = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.reverbInput = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.makeImpulse(2.7);
    this.reverbWet = ctx.createGain();

    this.masterBus.connect(this.saturator);
    this.saturator.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.delayInput.connect(this.delay);
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.delayWet);
    this.delayWet.connect(this.masterBus);

    this.reverbInput.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(this.masterBus);

    this.delaySends = [];
    this.reverbSends = [];
    this.trackGains = TRACKS.map(
      function makeGain(track, index) {
        const gain = ctx.createGain();
        const delaySend = ctx.createGain();
        const reverbSend = ctx.createGain();
        gain.gain.value = this.trackState[index].gain * this.voiceState[index].level;
        gain.connect(this.masterBus);
        gain.connect(delaySend);
        gain.connect(reverbSend);
        delaySend.connect(this.delayInput);
        reverbSend.connect(this.reverbInput);
        this.delaySends[index] = delaySend;
        this.reverbSends[index] = reverbSend;
        return gain;
      }.bind(this)
    );

    this.noiseBuffer = this.makeNoiseBuffer();
    this.applyAudioParams();
  }

  makeNoiseBuffer() {
    const length = Math.floor(this.ctx.sampleRate * 2);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const noiseRandom = mulberry32((this.state.seed ^ 0xa341316c) >>> 0);
    let previous = 0;
    for (let index = 0; index < length; index += 1) {
      const white = noiseRandom() * 2 - 1;
      previous = previous * 0.88 + white * 0.12;
      data[index] = previous * 1.8;
    }
    return buffer;
  }

  makeImpulse(duration) {
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    const impulseRandom = mulberry32((this.state.seed ^ 0xc8013ea4) >>> 0);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const envelope = Math.pow(1 - index / length, 2.7);
        data[index] = (impulseRandom() * 2 - 1) * envelope;
      }
    }
    return buffer;
  }

  makeSaturationCurve(amount) {
    const samples = 2048;
    const curve = new Float32Array(samples);
    const drive = 1 + amount * 7;
    const norm = Math.tanh(drive);
    for (let index = 0; index < samples; index += 1) {
      const x = (index * 2) / (samples - 1) - 1;
      curve[index] = Math.tanh(x * drive) / norm;
    }
    return curve;
  }

  applyAudioParams() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const stepDuration = 60 / this.state.bpm / 4;
    const timingScale =
      this.state.timeMode === "breath"
        ? 1 + Math.sin(this.cycle * 0.61) * this.state.cycleDrift
        : this.state.timeMode === "orbits"
          ? lerp(this.state.orbitRatios[1], 1, this.state.orbitAttraction)
          : 1;
    this.saturator.curve = this.makeSaturationCurve(clamp(this.state.fx.drive * 0.72 + this.state.warmth * 0.34, 0, 1));
    this.masterGain.gain.setTargetAtTime(this.state.master * 0.66, now, 0.03);
    this.delay.delayTime.setTargetAtTime(stepDuration * 3 * timingScale, now, 0.04);
    this.delayFeedback.gain.setTargetAtTime(clamp(this.state.fx.feedback + this.state.echo * 0.16, 0, 0.7), now, 0.05);
    this.delayWet.gain.setTargetAtTime(this.state.fx.delayWet, now, 0.05);
    this.reverbWet.gain.setTargetAtTime(this.state.fx.reverbWet, now, 0.05);

    if (this.trackGains) {
      this.trackGains.forEach(
        function updateTrackGain(gain, index) {
          const active = index < this.state.structure.layers ? 1 : 0;
          gain.gain.setTargetAtTime(this.trackState[index].gain * this.voiceState[index].level * active, now, 0.08);
          this.delaySends[index].gain.setTargetAtTime(0.12 + this.voiceState[index].space * 0.5, now, 0.08);
          this.reverbSends[index].gain.setTargetAtTime(0.08 + this.voiceState[index].space * 0.58, now, 0.08);
        }.bind(this)
      );
    }
  }

  togglePlay() {
    if (!this.ctx) {
      this.wake();
      return;
    }
    if (this.isPlaying) this.stop();
    else this.start();
  }

  start() {
    if (!this.ctx || this.isPlaying) return;
    this.ctx.resume();
    this.isPlaying = true;
    this.currentStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.06;
    this.orbitSteps = [0, 0, 0, 0];
    this.orbitNextTimes = [0, 0, 0, 0].map(
      function initialOrbitTime(_, index) {
        return this.ctx.currentTime + 0.06 + index * 0.014;
      }.bind(this)
    );
    this.regenerateBreathWeights();
    this.scheduler();
    this.schedulerTimer = window.setInterval(this.scheduler.bind(this), 25);
    if (this.reducedMotion) this.drawCanvas();
    this.el.playToggle.classList.add("is-playing");
    this.el.playLabel.textContent = "Пауза";
    this.el.audioState.textContent = "цикл звучит";
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    window.clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    this.uiTimers.forEach(window.clearTimeout);
    this.uiTimers = [];
    document.querySelectorAll(".step").forEach(function clear(step) {
      step.classList.remove("is-playing", "step-column-active");
    });
    this.el.playToggle.classList.remove("is-playing");
    this.el.playLabel.textContent = "Играть";
    this.el.audioState.textContent = "инструмент бодрствует";
  }

  scheduler() {
    if (!this.isPlaying) return;
    if (this.state.timeMode === "orbits") {
      this.scheduleOrbits();
      return;
    }
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      const stepDuration = 60 / this.state.bpm / 4;
      const swingDelay =
        this.state.timeMode === "grid" && this.currentStep % 2 === 1
          ? stepDuration * this.state.swing * 0.48
          : 0;
      const eventTime = this.nextNoteTime + swingDelay;
      this.scheduleStep(this.currentStep, eventTime);
      this.schedulePlayhead(this.currentStep, eventTime);
      this.scheduleGuidePulse(this.currentStep, eventTime);
      let interval = stepDuration;
      if (this.state.timeMode === "breath") {
        const warped = stepDuration * this.breathWeights[this.currentStep];
        const breathingInterval = lerp(warped, stepDuration, this.state.quantize);
        const cycleScale = 1 + Math.sin((this.cycle + this.currentStep / 16) * 0.73) * this.state.cycleDrift;
        interval = breathingInterval * cycleScale;
      }
      this.nextNoteTime += interval;
      this.currentStep = (this.currentStep + 1) % 16;
      if (this.currentStep === 0) {
        this.cycle += 1;
        this.regenerateBreathWeights();
        this.updateTimeVisuals();
        this.applyAudioParams();
      }
    }
  }

  scheduleOrbits() {
    const baseStep = 60 / this.state.bpm / 4;
    for (let trackIndex = 0; trackIndex < TRACKS.length; trackIndex += 1) {
      if (trackIndex >= this.state.structure.layers) continue;
      while (this.orbitNextTimes[trackIndex] < this.ctx.currentTime + 0.12) {
        const stepIndex = this.orbitSteps[trackIndex];
        const eventTime = this.orbitNextTimes[trackIndex];
        this.scheduleTrackEvent(trackIndex, stepIndex, eventTime);
        this.schedulePlayhead(stepIndex, eventTime, trackIndex);
        if (trackIndex === 0) this.scheduleGuidePulse(stepIndex, eventTime);
        const freeRatio = this.state.orbitRatios[trackIndex];
        const ratio = lerp(freeRatio, 1, this.state.orbitAttraction);
        const independence = this.state.structure.independence;
        const slowDrift =
          1 +
          Math.sin((this.cycle + stepIndex / 16) * (0.42 + trackIndex * 0.11)) *
            this.state.cycleDrift *
            independence;
        this.orbitNextTimes[trackIndex] += baseStep * lerp(1, ratio, independence) * slowDrift;
        this.orbitSteps[trackIndex] = (stepIndex + 1) % 16;
        if (trackIndex === 0 && this.orbitSteps[trackIndex] === 0) {
          this.cycle += 1;
          this.applyAudioParams();
        }
      }
    }
  }

  schedulePlayhead(stepIndex, time, trackIndex) {
    const delay = Math.max(0, (time - this.ctx.currentTime) * 1000);
    const timer = window.setTimeout(
      function showPlayhead() {
        if (!this.isPlaying) return;
        if (Number.isFinite(trackIndex)) {
          const row = document.querySelector('.step-row[data-track="' + trackIndex + '"]');
          if (row) {
            row.querySelectorAll(".step").forEach(function clear(step) {
              step.classList.remove("is-playing", "step-column-active");
            });
            const target = row.querySelector('.step[data-step="' + stepIndex + '"]');
            if (target) target.classList.add("is-playing");
          }
        } else {
          document.querySelectorAll(".step").forEach(function clear(step) {
            step.classList.remove("is-playing", "step-column-active");
          });
          document.querySelectorAll('.step[data-step="' + stepIndex + '"]').forEach(function light(step) {
            step.classList.add("is-playing", "step-column-active");
          });
        }
        this.el.cycleCount.textContent = String(this.cycle).padStart(2, "0");
        this.renderInfluence();
      }.bind(this),
      delay
    );
    this.uiTimers.push(timer);
    if (this.uiTimers.length > 40) this.uiTimers.splice(0, 20);
  }

  scheduleGuidePulse(stepIndex, time) {
    if (!this.guideActive) return;
    if (stepIndex % 4 === 0) this.triggerReferencePulse(time, stepIndex === 0);
  }

  scheduleStep(stepIndex, baseTime) {
    let tracePlayed = false;
    for (let trackIndex = 0; trackIndex < TRACKS.length; trackIndex += 1) {
      const played = this.scheduleTrackEvent(trackIndex, stepIndex, baseTime);
      if (trackIndex === 1) tracePlayed = played;
    }

    if (
      tracePlayed &&
      this.state.structure.layers > 3 &&
      this.random() < this.state.structure.connections * 0.22
    ) {
      const linkedTime = baseTime + (60 / this.state.bpm / 4) * 0.5;
      const sourceStep = this.pattern[1][stepIndex];
      this.triggerVoice(3, linkedTime, sourceStep.velocity * 0.54, stepIndex, 0, sourceStep.note + 12);
      this.recordEvent({
        track: 3,
        step: stepIndex,
        source: "machine",
        velocity: sourceStep.velocity * 0.54,
        timingMs: (linkedTime - baseTime) * 1000,
        detune: 0,
        ratchet: 1,
        note: sourceStep.note + 12,
        contributions: { human: 0.18, memory: 0.32, machine: 0.5 },
        message: "Эхо ответило на сильный След"
      });
    }
  }

  scheduleTrackEvent(trackIndex, stepIndex, baseTime) {
    const trackStatus = this.trackState[trackIndex];
    const anySolo = this.trackState.some(function checkSolo(track) {
      return track.solo;
    });
    if (
      trackIndex >= this.state.structure.layers ||
      trackStatus.muted ||
      (anySolo && !trackStatus.solo)
    ) {
      return false;
    }

    const step = this.pattern[trackIndex][stepIndex];
    const gate = this.memoryGate(trackIndex, stepIndex);
    let probability;
    if (step.locked) {
      probability = step.active ? 1 : 0;
    } else if (step.active) {
      probability = clamp(step.probability * (0.72 + this.state.density * 0.3), 0, 1);
    } else {
      probability =
        gate *
        this.state.machine.memoryChance *
        (0.22 + this.state.agency * 0.72) *
        this.state.density *
        (0.42 + this.state.structure.memoryDepth * 0.58);
    }
    if (this.random() > probability) return false;

    const humanAnchor = step.active ? 1 : 0.72;
    const velocityRange =
      this.state.machine.velocityDrift * this.state.agency * (step.locked ? 0.12 : 1);
    const velocityDelta = (this.random() - 0.5) * velocityRange * 2;
    const velocity = clamp(step.velocity * humanAnchor + velocityDelta, 0.12, 1);
    const timingRange =
      (this.state.machine.timingMs / 1000) *
      this.state.agency *
      this.state.drift *
      (step.locked ? 0.08 : 1);
    const timingDelta = (this.random() - 0.5) * timingRange * 2;
    const time = Math.max(this.ctx.currentTime + 0.002, baseTime + timingDelta);
    const detuneRange =
      this.state.machine.detuneCents *
      (0.28 + this.state.agency * this.state.drift * 0.72) *
      (step.locked ? 0.18 : 1);
    const detune = (this.random() - 0.5) * detuneRange * 2;
    let ratchet = 1;
    if (
      !step.locked &&
      this.random() < this.state.machine.ratchetChance * this.state.agency
    ) {
      ratchet = this.state.structure.connections > 0.72 && this.random() < 0.28 ? 3 : 2;
    }
    const ratchetGap = (60 / this.state.bpm / 4) / ratchet;
    const params = this.memoryParams();
    const note = step.active
      ? step.note
      : params.root + SCALE[(stepIndex + trackIndex * 2) % SCALE.length];
    const source = step.active ? step.origin : "memory";
    const contributions = step.active
      ? clone(step.contributions)
      : { human: 0, memory: 0.76, machine: 0.24 };
    const deviationWeight = clamp(
      Math.abs(timingDelta) / Math.max(0.001, timingRange) * 0.08 +
        Math.abs(detune) / Math.max(1, detuneRange) * 0.07 +
        (ratchet > 1 ? 0.12 : 0),
      0,
      0.2
    );
    contributions.machine = clamp(contributions.machine + deviationWeight, 0, 1);
    const remaining = Math.max(0.001, contributions.human + contributions.memory);
    const scale = (1 - contributions.machine) / remaining;
    contributions.human *= scale;
    contributions.memory *= scale;

    for (let hit = 0; hit < ratchet; hit += 1) {
      this.triggerVoice(
        trackIndex,
        time + hit * ratchetGap,
        velocity / Math.sqrt(ratchet),
        stepIndex,
        detune,
        note
      );
    }
    this.recordEvent({
      track: trackIndex,
      step: stepIndex,
      source: source,
      velocity: velocity,
      timingMs: timingDelta * 1000,
      detune: detune,
      ratchet: ratchet,
      note: note,
      contributions: contributions,
      parents: step.parents.slice()
    });
    return true;
  }

  recordEvent(event) {
    event.cycle = this.cycle;
    event.timeMode = this.state.timeMode;
    this.eventLog.unshift(event);
    this.eventLog = this.eventLog.slice(0, 96);
  }

  triggerVoice(trackIndex, time, velocity, stepIndex, detune, note) {
    if (trackIndex === 0) this.triggerPulse(time, velocity, detune);
    else if (trackIndex === 1) this.triggerTrace(time, velocity, stepIndex, detune, note);
    else if (trackIndex === 2) this.triggerDust(time, velocity);
    else this.triggerEcho(time, velocity, stepIndex, detune, note);
  }

  triggerPulse(time, velocity, detune) {
    const voice = this.voiceState[0];
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const click = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    osc.type = "sine";
    osc.detune.value = detune;
    const startPitch = 72 + voice.tone * 52 + velocity * 12;
    const endPitch = 34 + voice.tone * 16;
    const decay = 0.18 + voice.decay * 0.34;
    osc.frequency.setValueAtTime(startPitch, time);
    osc.frequency.exponentialRampToValueAtTime(endPitch, time + 0.115);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.72 * velocity, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    osc.connect(gain);
    gain.connect(this.trackGains[0]);

    click.type = "triangle";
    click.frequency.value = 680;
    clickGain.gain.setValueAtTime(0.08 * velocity, time);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);
    click.connect(clickGain);
    clickGain.connect(this.trackGains[0]);

    osc.start(time);
    click.start(time);
    osc.stop(time + decay + 0.04);
    click.stop(time + 0.025);
  }

  triggerTrace(time, velocity, stepIndex, detune, eventNote) {
    const params = this.memoryParams();
    const voice = this.voiceState[1];
    const note = Number.isFinite(eventNote)
      ? eventNote
      : params.root + SCALE[(stepIndex + Math.round(this.state.morph * 3)) % SCALE.length];
    const frequency = midiToHz(note);
    const saw = this.ctx.createOscillator();
    const triangle = this.ctx.createOscillator();
    const sawGain = this.ctx.createGain();
    const triangleGain = this.ctx.createGain();
    const filterA = this.ctx.createBiquadFilter();
    const filterB = this.ctx.createBiquadFilter();
    const envelope = this.ctx.createGain();
    const timbre = clamp(params.timbre * 0.62 + this.state.morph * 0.22 + voice.tone * 0.16, 0, 1);
    const cutoff = clamp(
      params.cutoff * (0.42 + this.state.warmth * 0.82 + voice.tone * 0.46),
      180,
      12000
    );
    const decay = clamp(
      params.decay * (0.46 + this.state.warmth * 0.34 + voice.decay * 0.62),
      0.14,
      2.2
    );

    saw.type = "sawtooth";
    triangle.type = "triangle";
    saw.frequency.value = frequency;
    triangle.frequency.value = frequency * 0.997;
    saw.detune.value = detune;
    triangle.detune.value = -detune * 0.72;
    sawGain.gain.value = Math.cos(timbre * Math.PI * 0.5) * 0.52;
    triangleGain.gain.value = Math.sin(timbre * Math.PI * 0.5) * 0.72;

    filterA.type = "lowpass";
    filterB.type = "lowpass";
    filterA.Q.value = 2.2 + this.state.warmth * 4;
    filterB.Q.value = 0.8;
    filterA.frequency.setValueAtTime(cutoff, time);
    filterA.frequency.exponentialRampToValueAtTime(Math.max(180, cutoff * 0.22), time + decay);
    filterB.frequency.value = Math.min(12000, cutoff * 1.2);

    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(0.25 * velocity, time + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + decay);

    saw.connect(sawGain);
    triangle.connect(triangleGain);
    sawGain.connect(filterA);
    triangleGain.connect(filterA);
    filterA.connect(filterB);
    filterB.connect(envelope);
    envelope.connect(this.trackGains[1]);

    saw.start(time);
    triangle.start(time);
    saw.stop(time + decay + 0.05);
    triangle.stop(time + decay + 0.05);
  }

  triggerDust(time, velocity) {
    const voice = this.voiceState[2];
    const source = this.ctx.createBufferSource();
    const highpass = this.ctx.createBiquadFilter();
    const bandpass = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    const duration = 0.045 + voice.decay * 0.28 + this.random() * 0.08;
    source.buffer = this.noiseBuffer;
    highpass.type = "highpass";
    highpass.frequency.value = 180 + this.state.warmth * 520 + voice.tone * 880;
    bandpass.type = "bandpass";
    bandpass.frequency.value = 620 + voice.tone * 2600 + this.random() * (1200 + this.state.agency * 1200);
    bandpass.Q.value = 0.7 + this.state.drift * 2.2 + voice.tone * 1.4;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.16 * velocity, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(highpass);
    highpass.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(this.trackGains[2]);
    source.start(time, this.random() * 1.4);
    source.stop(time + duration + 0.02);
  }

  triggerEcho(time, velocity, stepIndex, detune, eventNote) {
    const params = this.memoryParams();
    const voice = this.voiceState[3];
    const note = Number.isFinite(eventNote)
      ? eventNote
      : params.root + 12 + SCALE[(stepIndex * 3 + 1) % SCALE.length];
    const frequency = midiToHz(note);
    const carrier = this.ctx.createOscillator();
    const modulator = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    const envelope = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    const decay = 0.14 + params.decay * 0.24 + this.state.echo * 0.22 + voice.decay * 0.48;

    carrier.type = "sine";
    carrier.frequency.value = frequency;
    carrier.detune.value = detune;
    modulator.type = "sine";
    modulator.frequency.value = frequency * (1.98 + this.state.drift * 0.07);
    modGain.gain.setValueAtTime(frequency * params.fm * (0.42 + voice.tone * 0.56), time);
    modGain.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.7);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(0.18 * velocity, time + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    if ("pan" in panner) {
      panner.pan.value =
        (this.random() - 0.5) * (0.2 + this.state.drift * 0.52 + voice.space * 0.62);
    }

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(envelope);
    envelope.connect(panner);
    panner.connect(this.trackGains[3]);
    carrier.start(time);
    modulator.start(time);
    carrier.stop(time + decay + 0.04);
    modulator.stop(time + decay + 0.04);
  }

  triggerReferencePulse(time, accent) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = accent ? 1080 : 760;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.055 : 0.035, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    osc.connect(gain);
    gain.connect(this.masterBus);
    osc.start(time);
    osc.stop(time + 0.045);
  }

  async previewMemory(memory, button) {
    if (!this.ctx) {
      await this.wake();
    }
    if (!this.ctx) return;
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.stop();
    const oldA = this.state.memoryA;
    const oldB = this.state.memoryB;
    const oldMorph = this.state.morph;
    this.state.memoryA = memory.id;
    this.state.memoryB = memory.id;
    this.state.morph = 0;
    button.classList.add("is-previewing");
    const now = this.ctx.currentTime + 0.04;
    this.triggerPulse(now, 0.7, 0);
    this.triggerTrace(now + 0.18, 0.72, 3, 0);
    this.triggerDust(now + 0.4, 0.62);
    this.triggerEcho(now + 0.57, 0.7, 7, 0);
    window.setTimeout(
      function finishPreview() {
        button.classList.remove("is-previewing");
        this.state.memoryA = oldA;
        this.state.memoryB = oldB;
        this.state.morph = oldMorph;
        if (wasPlaying) this.start();
      }.bind(this),
      1250
    );
  }

  snapshotForUndo(label) {
    this.undoStack.push({
      label: label,
      pattern: clone(this.pattern),
      state: clone(this.state),
      voiceState: clone(this.voiceState),
      trackState: clone(this.trackState),
      selectedStep: clone(this.selectedStep)
    });
    if (this.undoStack.length > 10) this.undoStack.shift();
    this.el.undo.disabled = false;
  }

  mutate() {
    this.snapshotForUndo("случайность");
    const count = Math.max(
      1,
      Math.round(this.state.machine.mutationNodes * (0.55 + this.state.agency * 0.72))
    );
    const messages = [];
    let changed = 0;
    let guard = 0;

    while (changed < count && guard < 100) {
      guard += 1;
      const trackIndex = Math.floor(this.random() * Math.max(1, this.state.structure.layers));
      const stepIndex = Math.floor(this.random() * 16);
      const step = this.pattern[trackIndex][stepIndex];
      if (step.locked) continue;
      if (this.random() < 0.62) {
        step.active = !step.active;
      } else {
        step.velocity = clamp(step.velocity + (this.random() - 0.5) * 0.38, 0.35, 1);
      }
      step.origin = "machine";
      step.lastChangedBy = "machine";
      step.generation += 1;
      step.parents = Array.from(new Set(step.parents.concat(["machine:" + seedToHex(this.state.seed)])));
      const oldHuman = step.contributions.human || 0;
      const oldMemory = step.contributions.memory || 0;
      step.contributions = {
        human: oldHuman * 0.72,
        memory: oldMemory * 0.72,
        machine: clamp((step.contributions.machine || 0) * 0.72 + 0.28, 0, 1)
      };
      changed += 1;
      if (messages.length < 2) {
        messages.push(TRACKS[trackIndex].name.toLowerCase() + " изменил узел " + (stepIndex + 1));
      }
    }

    if (changed === 0) {
      this.undoStack.pop();
      this.el.undo.disabled = this.undoStack.length === 0;
      this.logMachine("все доступные узлы закреплены — машина оставила рисунок без изменений");
      this.announce("Мутация не применена: все узлы закреплены");
      return;
    }

    this.state.morph = clamp(this.state.morph + (this.random() - 0.5) * 0.14 * this.state.agency, 0, 1);
    this.el.morph.value = Math.round(this.state.morph * 100);
    this.refreshSteps();
    this.updateAllReadouts();
    this.logMachine(messages.join("; ") + " — закреплённые точки сохранены");
    this.announce("Мутация применена. Закреплённые шаги не изменились.");
  }

  undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.pattern = previous.pattern;
    this.state = previous.state;
    this.voiceState = previous.voiceState;
    this.trackState = previous.trackState;
    this.selectedStep = previous.selectedStep;
    this.random = mulberry32(this.state.seed);
    this.renderTracks();
    this.renderVoiceControls();
    this.renderOrbitRatios();
    this.updateAllReadouts();
    this.el.morph.value = Math.round(this.state.morph * 100);
    this.el.warmth.value = Math.round(this.state.warmth * 100);
    this.el.echo.value = Math.round(this.state.echo * 100);
    this.el.density.value = Math.round(this.state.density * 100);
    this.applyAudioParams();
    this.updateTimeVisuals();
    this.el.undo.disabled = this.undoStack.length === 0;
    this.logMachine("ваш жест возвращён; ответ «" + previous.label + "» отпущен");
    this.announce("Предыдущий жест восстановлен");
  }

  newMeeting() {
    this.snapshotForUndo("новая встреча");
    this.state.seed = Math.floor(Math.random() * 0xffffffff);
    this.random = mulberry32(this.state.seed);
    let inherited = 0;
    this.pattern.forEach(
      function transformTrack(row) {
        row.forEach(
          function transformStep(step) {
            if (step.locked) {
              inherited += 1;
              return;
            }
            if (this.random() < 0.24) step.active = !step.active;
            else if (step.active) inherited += 1;
            step.velocity = clamp(step.velocity + (this.random() - 0.5) * 0.22, 0.35, 1);
            step.origin = "machine";
            step.lastChangedBy = "machine";
            step.generation += 1;
            step.parents = Array.from(new Set(step.parents.concat(["meeting:" + seedToHex(this.state.seed)])));
            step.contributions = {
              human: (step.contributions.human || 0) * 0.8,
              memory: (step.contributions.memory || 0) * 0.8,
              machine: clamp((step.contributions.machine || 0) * 0.8 + 0.2, 0, 1)
            };
          }.bind(this)
        );
      }.bind(this)
    );
    this.cycle = 1;
    this.regenerateBreathWeights();
    if (this.ctx) {
      this.noiseBuffer = this.makeNoiseBuffer();
      this.convolver.buffer = this.makeImpulse(2.7);
      this.resetSchedulerClock();
    }
    this.refreshSteps();
    this.updateAllReadouts();
    this.logMachine("новый seed сохранил " + inherited + " опор и предложил соседнее развитие");
    this.announce("Началась новая встреча. Часть прежнего рисунка сохранена.");
  }

  saveMemory() {
    const customCount = this.memories.filter(function count(memory) {
      return memory.custom;
    }).length;
    const params = this.memoryParams();
    const memory = {
      id: "you-" + Date.now(),
      name: "Ваш след " + String(customCount + 1).padStart(2, "0"),
      author: "вы · локальная память",
      color: "#86d0b2",
      custom: true,
      schemaVersion: 2,
      pattern: this.pattern.map(function rowToString(row) {
        return row
          .map(function stepToFlag(step) {
            return step.active ? "1" : "0";
          })
          .join("");
      }),
      events: this.pattern.map(function serializeRow(row) {
        return row.map(function serializeStep(step) {
          return {
            velocity: step.velocity,
            probability: step.probability,
            locked: step.locked,
            note: step.note,
            phase: step.phase,
            offsetMs: step.offsetMs,
            origin: step.origin,
            parents: step.parents,
            lastChangedBy: step.lastChangedBy,
            generation: step.generation,
            contributions: step.contributions
          };
        });
      }),
      lineage: this.aggregatePatternLineage(),
      params: {
        root: params.root,
        timbre: this.state.morph,
        cutoff: params.cutoff * (0.7 + this.state.warmth * 0.6),
        decay: params.decay,
        fm: params.fm
      }
    };
    this.memories.push(memory);
    const customs = this.memories.filter(function isCustom(item) {
      return item.custom;
    });
    if (customs.length > 4) {
      const removeId = customs[0].id;
      this.memories = this.memories.filter(function keep(item) {
        return item.id !== removeId;
      });
    }
    this.state.memoryB = memory.id;
    this.persistMemories();
    this.renderMemoryList();
    this.renderMemoryOptions();
    this.updateMemoryIndicators();
    this.renderAnatomy();
    this.logMachine("«" + memory.name + "» вошёл в память браузера и стал источником B");
    this.announce("Текущий рисунок сохранён как " + memory.name);
  }

  aggregatePatternLineage() {
    const totals = { human: 0, memory: 0, machine: 0 };
    let count = 0;
    this.pattern.forEach(function sumRow(row) {
      row.forEach(function sumStep(step) {
        if (!step.active) return;
        count += 1;
        totals.human += step.contributions.human || 0;
        totals.memory += step.contributions.memory || 0;
        totals.machine += step.contributions.machine || 0;
      });
    });
    if (!count) return totals;
    totals.human /= count;
    totals.memory /= count;
    totals.machine /= count;
    return totals;
  }

  logMachine(message) {
    this.machineHistory.unshift(message);
    this.machineHistory = this.machineHistory.slice(0, 8);
    this.el.machineLog.textContent = message;
    this.el.organismNote.textContent = message.charAt(0).toUpperCase() + message.slice(1) + ".";
  }

  announce(message) {
    this.el.announcer.textContent = "";
    window.setTimeout(
      function setAnnouncement() {
        this.el.announcer.textContent = message;
      }.bind(this),
      20
    );
  }

  setupCanvas() {
    this.visualCtx = this.el.memoryCanvas.getContext("2d");
    const resize = this.resizeCanvas.bind(this);
    if ("ResizeObserver" in window) {
      this.canvasObserver = new ResizeObserver(resize);
      this.canvasObserver.observe(this.el.memoryCanvas);
    } else {
      window.addEventListener("resize", resize);
    }
    this.resizeCanvas();
    this.drawCanvas();
  }

  resizeCanvas() {
    const bounds = this.el.memoryCanvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvasWidth = Math.max(1, bounds.width);
    this.canvasHeight = Math.max(1, bounds.height);
    this.el.memoryCanvas.width = Math.floor(this.canvasWidth * ratio);
    this.el.memoryCanvas.height = Math.floor(this.canvasHeight * ratio);
    this.visualCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  drawCanvas() {
    const ctx = this.visualCtx;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    ctx.clearRect(0, 0, width, height);

    const startX = width < 700 ? width * 0.38 : width * 0.31;
    const endX = width * 0.95;
    const span = Math.max(1, endX - startX);
    const time = performance.now() * 0.00025;
    const amp = this.isPlaying ? 1 : 0.45;
    const breathDenominator = this.breathWeights.slice(0, 15).reduce(function add(total, value) {
      return total + value;
    }, 0);
    const visualX = function positionNode(trackIndex, stepIndex) {
      const gridPhase = stepIndex / 15;
      let phase = gridPhase;
      if (this.state.timeMode === "breath" && stepIndex > 0) {
        const elapsed = this.breathWeights.slice(0, stepIndex).reduce(function add(total, value) {
          return total + value;
        }, 0);
        const breathPhase = elapsed / Math.max(0.001, breathDenominator);
        phase = lerp(breathPhase, gridPhase, this.state.quantize);
      } else if (this.state.timeMode === "orbits") {
        const orbitShift =
          Math.sin(stepIndex * 0.82 + trackIndex * 1.7) *
          0.018 *
          (1 - this.state.orbitAttraction) *
          this.state.orbitRatios[trackIndex];
        phase = clamp(gridPhase + orbitShift, 0, 1);
      }
      return startX + span * phase;
    }.bind(this);

    TRACKS.forEach(
      function drawTrack(track, trackIndex) {
        const isLatent = trackIndex >= this.state.structure.layers;
        const baseY = height * (0.23 + trackIndex * 0.17);
        ctx.beginPath();
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = track.color;
        ctx.globalAlpha = isLatent ? 0.035 : 0.18;
        for (let stepIndex = 0; stepIndex < 16; stepIndex += 1) {
          const x = visualX(trackIndex, stepIndex);
          const active = this.pattern[trackIndex][stepIndex].active ? 1 : this.memoryGate(trackIndex, stepIndex) * 0.36;
          const wave = Math.sin(time * (3 + trackIndex) + stepIndex * 0.76) * (4 + active * 10) * amp;
          const y = baseY + wave;
          if (stepIndex === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        this.pattern[trackIndex].forEach(
          function drawNode(step, stepIndex) {
            if (!step.active && this.memoryGate(trackIndex, stepIndex) < 0.34) return;
            const x = visualX(trackIndex, stepIndex);
            const wave = Math.sin(time * (3 + trackIndex) + stepIndex * 0.76) * (4 + (step.active ? 10 : 4)) * amp;
            const y = baseY + wave;
            ctx.beginPath();
            ctx.globalAlpha = isLatent ? 0.08 : step.active ? 0.72 : 0.3;
            ctx.fillStyle = step.active ? track.color : "#cb81ae";
            ctx.arc(x, y, step.locked ? 3.4 : 2.2, 0, Math.PI * 2);
            ctx.fill();
            if (step.active && !isLatent) {
              ctx.beginPath();
              ctx.globalAlpha = 0.48;
              ctx.strokeStyle =
                step.origin === "human" ? "#7fd4c1" : step.origin === "machine" ? "#cb81ae" : "#e7b86c";
              ctx.lineWidth = 0.7;
              ctx.arc(x, y, step.locked ? 5.6 : 4.2, 0, Math.PI * 2);
              ctx.stroke();
            }
          }.bind(this)
        );
      }.bind(this)
    );

    if (this.analyser && this.analyserData) {
      this.analyser.getByteTimeDomainData(this.analyserData);
      ctx.beginPath();
      ctx.globalAlpha = 0.27;
      ctx.strokeStyle = "#efece3";
      ctx.lineWidth = 0.75;
      const waveY = height * 0.88;
      for (let index = 0; index < this.analyserData.length; index += 1) {
        const x = startX + (span * index) / (this.analyserData.length - 1);
        const value = (this.analyserData[index] - 128) / 128;
        const y = waveY + value * 22;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (!this.reducedMotion || this.isPlaying) {
      window.requestAnimationFrame(this.drawCanvas.bind(this));
    }
  }
}

window.addEventListener("DOMContentLoaded", function initialize() {
  window.livingMemory = new LivingMemorySequencer();
});
