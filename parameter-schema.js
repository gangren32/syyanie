"use strict";

(function exposeWordstatParameters() {
  const PROFILE_KEYS = [
    "voiceBudget",
    "eventRate",
    "variation",
    "polyphony",
    "pitchSpan",
    "space",
    "responseDepth",
    "detail"
  ];

  const DEFAULTS = Object.freeze({
    structureIndex: 2,
    timeMode: "grid",

    normalization: "log",
    periodResolution: 16,
    peakThreshold: 0.58,
    minEventStrength: 0.18,

    voiceBudget: 6,
    eventRate: 0.56,
    variation: 0.18,
    polyphony: 4,
    pitchSpan: 12,
    space: 0.36,
    responseDepth: 0.3,
    detail: 0.58,

    bpm: 104,
    cycleDuration: 24,
    quantize: 0.86,
    swing: 0.12,
    jitter: 0.012,
    metronome: false,
    metronomeLevel: 0.18,

    countToVelocity: 0.78,
    deltaToPitch: 0.7,
    affinityToFilter: 0.68,
    trendToDuration: 0.36,

    rootNote: 48,
    scale: "minor-pentatonic",
    waveform: "triangle",
    attack: 0.012,
    release: 0.34,
    filterCutoff: 3400,
    resonance: 1.2,
    stereoWidth: 0.55,

    delayMix: 0.18,
    delayFeedback: 0.24,
    reverbMix: 0.22,
    masterVolume: 0.72
  });

  const STRUCTURE_PROFILES = Object.freeze([
    Object.freeze({
      index: 0,
      name: "СИГНАЛ",
      note: "Один агрегированный голос и только самые сильные импульсы",
      voiceBudget: 1,
      eventRate: 0.18,
      variation: 0.02,
      polyphony: 1,
      pitchSpan: 3,
      space: 0.1,
      responseDepth: 0,
      detail: 0.12
    }),
    Object.freeze({
      index: 1,
      name: "ПРИСОЕДИНЕНИЕ",
      note: "Несколько смысловых семейств входят в общий поток",
      voiceBudget: 3,
      eventRate: 0.34,
      variation: 0.08,
      polyphony: 2,
      pitchSpan: 7,
      space: 0.2,
      responseDepth: 0.14,
      detail: 0.32
    }),
    Object.freeze({
      index: 2,
      name: "ПАТТЕРН",
      note: "Читаемая структура, в которой уже заметна динамика спроса",
      voiceBudget: 6,
      eventRate: 0.56,
      variation: 0.18,
      polyphony: 4,
      pitchSpan: 12,
      space: 0.36,
      responseDepth: 0.3,
      detail: 0.58
    }),
    Object.freeze({
      index: 3,
      name: "СОТВОРЧЕСТВО",
      note: "Голоса перекликаются и развивают реплики друг друга",
      voiceBudget: 9,
      eventRate: 0.74,
      variation: 0.36,
      polyphony: 6,
      pitchSpan: 19,
      space: 0.56,
      responseDepth: 0.62,
      detail: 0.78
    }),
    Object.freeze({
      index: 4,
      name: "ОТКРЫТАЯ ИГРА",
      note: "Независимые часы, ветвящиеся ответы и свободная эволюция",
      voiceBudget: 14,
      eventRate: 0.9,
      variation: 0.65,
      polyphony: 8,
      pitchSpan: 24,
      space: 0.78,
      responseDepth: 0.88,
      detail: 1
    })
  ]);

  const TIME_MODES = Object.freeze({
    grid: Object.freeze({
      id: "grid",
      index: 0,
      label: "СЕТКА",
      title: "Общий пульс",
      note: "Все фразы делят один темп и шестнадцать равных позиций.",
      clock: "shared",
      showsGrid: true,
      supportsMetronome: true
    }),
    elastic: Object.freeze({
      id: "elastic",
      index: 1,
      label: "ДЫХАНИЕ",
      title: "Эластичное время",
      note: "Периоды сохраняют порядок, но расстояния между событиями дышат вместе с данными.",
      clock: "elastic",
      showsGrid: false,
      supportsMetronome: false
    }),
    free: Object.freeze({
      id: "free",
      index: 2,
      label: "ПОЛЕ",
      title: "Независимые часы",
      note: "Каждая фраза возвращается в собственном ритме и может отвечать другим.",
      clock: "independent",
      showsGrid: false,
      supportsMetronome: false
    })
  });

  function option(value, label) {
    return Object.freeze({ value: value, label: label });
  }

  function field(config) {
    return Object.freeze(Object.assign({
      min: null,
      max: null,
      step: null,
      unit: "",
      default: DEFAULTS[config.id]
    }, config));
  }

  function group(id, label, fields) {
    const frozenFields = Object.freeze(fields);
    return Object.freeze({ id: id, label: label, fields: frozenFields });
  }

  const ADVANCED_GROUPS = Object.freeze([
    group("data", "ДАННЫЕ", [
      field({
        id: "normalization", label: "Нормализация", type: "select",
        options: Object.freeze([option("linear", "Линейная"), option("log", "Логарифмическая"), option("rank", "По рангу")])
      }),
      field({ id: "periodResolution", label: "Разрешение периода", type: "range", min: 4, max: 32, step: 1, unit: "периодов" }),
      field({ id: "peakThreshold", label: "Порог пика", type: "range", min: 0.2, max: 0.95, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "minEventStrength", label: "Минимальная сила события", type: "range", min: 0, max: 0.7, step: 0.01, unit: "%", format: "percent" })
    ]),
    group("form", "ФОРМА", [
      field({ id: "structureIndex", label: "Структура", type: "range", min: 0, max: 4, step: 1, unit: "уровень" }),
      field({ id: "voiceBudget", label: "Самостоятельные голоса", type: "range", min: 1, max: 14, step: 1, unit: "голосов" }),
      field({ id: "eventRate", label: "Плотность событий", type: "range", min: 0.05, max: 1, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "variation", label: "Вариативность", type: "range", min: 0, max: 0.85, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "polyphony", label: "Полифония", type: "range", min: 1, max: 12, step: 1, unit: "голосов" }),
      field({ id: "pitchSpan", label: "Диапазон высот", type: "range", min: 0, max: 36, step: 1, unit: "полутонов" }),
      field({ id: "space", label: "Пространство", type: "range", min: 0, max: 0.9, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "responseDepth", label: "Глубина ответа", type: "range", min: 0, max: 1, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "detail", label: "Детализация данных", type: "range", min: 0.05, max: 1, step: 0.01, unit: "%", format: "percent" })
    ]),
    group("time", "ВРЕМЯ", [
      field({
        id: "timeMode", label: "Организация времени", type: "select",
        options: Object.freeze([option("grid", "Сетка"), option("elastic", "Дыхание"), option("free", "Поле")])
      }),
      field({ id: "bpm", label: "Темп", type: "range", min: 36, max: 220, step: 1, unit: "BPM" }),
      field({ id: "cycleDuration", label: "Длительность цикла", type: "range", min: 4, max: 90, step: 0.5, unit: "с" }),
      field({ id: "quantize", label: "Притяжение к сетке", type: "range", min: 0, max: 1, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "swing", label: "Свинг", type: "range", min: 0, max: 0.48, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "jitter", label: "Микросдвиг", type: "range", min: 0, max: 0.18, step: 0.001, unit: "с" }),
      field({ id: "metronome", label: "Контрольный клик", type: "toggle", min: 0, max: 1, step: 1, unit: "" }),
      field({ id: "metronomeLevel", label: "Громкость клика", type: "range", min: 0, max: 0.45, step: 0.01, unit: "%", format: "percent" })
    ]),
    group("mapping", "MAPPING", [
      field({ id: "countToVelocity", label: "Частотность → громкость", type: "range", min: 0, max: 1, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "deltaToPitch", label: "Динамика → высота", type: "range", min: 0, max: 1, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "affinityToFilter", label: "Индекс интереса → тембр", type: "range", min: 0, max: 1, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "trendToDuration", label: "Тренд → длительность", type: "range", min: 0, max: 1, step: 0.01, unit: "%", format: "percent" })
    ]),
    group("sound", "ЗВУК", [
      field({ id: "rootNote", label: "Основная нота", type: "range", min: 36, max: 72, step: 1, unit: "MIDI" }),
      field({
        id: "scale", label: "Лад", type: "select",
        options: Object.freeze([option("minor-pentatonic", "Минорная пентатоника"), option("dorian", "Дорийский"), option("major", "Мажор"), option("chromatic", "Хроматика")])
      }),
      field({
        id: "waveform", label: "Осциллятор", type: "select",
        options: Object.freeze([option("sine", "Синус"), option("triangle", "Треугольник"), option("square", "Прямоугольник"), option("sawtooth", "Пила")])
      }),
      field({ id: "attack", label: "Атака", type: "range", min: 0.002, max: 1, step: 0.001, unit: "с" }),
      field({ id: "release", label: "Затухание", type: "range", min: 0.04, max: 4, step: 0.01, unit: "с" }),
      field({ id: "filterCutoff", label: "Срез фильтра", type: "range", min: 180, max: 16000, step: 10, unit: "Hz", scale: "log" }),
      field({ id: "resonance", label: "Резонанс", type: "range", min: 0.1, max: 18, step: 0.1, unit: "Q" }),
      field({ id: "stereoWidth", label: "Ширина стерео", type: "range", min: 0, max: 1, step: 0.01, unit: "%", format: "percent" })
    ]),
    group("fx", "FX", [
      field({ id: "delayMix", label: "Delay", type: "range", min: 0, max: 0.65, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "delayFeedback", label: "Feedback", type: "range", min: 0, max: 0.78, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "reverbMix", label: "Reverb", type: "range", min: 0, max: 0.75, step: 0.01, unit: "%", format: "percent" }),
      field({ id: "masterVolume", label: "Master", type: "range", min: 0, max: 0.9, step: 0.01, unit: "%", format: "percent" })
    ])
  ]);

  const FIELD_BY_ID = ADVANCED_GROUPS.reduce(function indexGroups(index, currentGroup) {
    currentGroup.fields.forEach(function indexField(currentField) {
      index[currentField.id] = currentField;
    });
    return index;
  }, Object.create(null));

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function precisionFor(step) {
    const asString = String(step);
    const decimal = asString.indexOf(".");
    return decimal === -1 ? 0 : asString.length - decimal - 1;
  }

  function snap(value, config) {
    const bounded = clamp(value, config.min, config.max);
    if (!config.step) return bounded;
    const snapped = config.min + Math.round((bounded - config.min) / config.step) * config.step;
    return Number(clamp(snapped, config.min, config.max).toFixed(precisionFor(config.step)));
  }

  function booleanValue(value, fallback) {
    if (value === true || value === false) return value;
    if (value === "true" || value === 1 || value === "1") return true;
    if (value === "false" || value === 0 || value === "0") return false;
    return fallback;
  }

  function profileAt(index) {
    const numeric = Number(index);
    const safeIndex = Number.isFinite(numeric)
      ? clamp(Math.round(numeric), 0, STRUCTURE_PROFILES.length - 1)
      : DEFAULTS.structureIndex;
    return Object.assign({}, STRUCTURE_PROFILES[safeIndex]);
  }

  function pinnedSet(pinned) {
    if (pinned instanceof Set) return new Set(pinned);
    if (Array.isArray(pinned)) return new Set(pinned);
    if (pinned && typeof pinned === "object") {
      return new Set(Object.keys(pinned).filter(function isPinned(key) { return Boolean(pinned[key]); }));
    }
    return new Set();
  }

  function clampState(state) {
    const source = state && typeof state === "object" ? state : {};
    const result = Object.assign({}, DEFAULTS, source);

    Object.keys(FIELD_BY_ID).forEach(function clampField(id) {
      const config = FIELD_BY_ID[id];
      const fallback = DEFAULTS[id];
      const value = result[id];

      if (config.type === "toggle") {
        result[id] = booleanValue(value, fallback);
        return;
      }

      if (config.type === "select") {
        const allowed = config.options.map(function optionValue(item) { return item.value; });
        result[id] = allowed.indexOf(value) === -1 ? fallback : value;
        return;
      }

      const numeric = Number(value);
      result[id] = snap(Number.isFinite(numeric) ? numeric : fallback, config);
    });

    result.structureIndex = Math.round(result.structureIndex);
    result.voiceBudget = Math.round(result.voiceBudget);
    result.polyphony = Math.min(Math.round(result.polyphony), result.voiceBudget);
    result.periodResolution = Math.round(result.periodResolution);
    result.pitchSpan = Math.round(result.pitchSpan);
    result.rootNote = Math.round(result.rootNote);
    return result;
  }

  function mergeProfile(state, index, pinned) {
    const current = clampState(state);
    const profile = profileAt(index);
    const protectedKeys = pinnedSet(pinned);
    const merged = Object.assign({}, current, { structureIndex: profile.index });

    PROFILE_KEYS.forEach(function mergeKey(key) {
      if (!protectedKeys.has(key)) merged[key] = profile[key];
    });

    return clampState(merged);
  }

  function variationLabel(value) {
    if (value < 0.08) return "почти без вариаций";
    if (value < 0.28) return "умеренная вариативность";
    if (value < 0.52) return "живая вариативность";
    return "открытая вариативность";
  }

  function describeStructure(state, activeTermCount) {
    const safe = clampState(state);
    const profile = profileAt(safe.structureIndex);
    const requestedTerms = Number(activeTermCount);
    const availableTerms = Number.isFinite(requestedTerms) ? Math.max(0, Math.round(requestedTerms)) : safe.voiceBudget;
    const voiceCount = Math.min(availableTerms, safe.voiceBudget);
    const eventsPerVoice = (1 + safe.eventRate * 2.25) * (0.72 + safe.detail * 0.28);
    const eventCount = voiceCount === 0 ? 0 : Math.max(1, Math.round(voiceCount * eventsPerVoice));
    const variability = variationLabel(safe.variation);
    const summary = availableTerms + " " + plural(availableTerms, "фраза", "фразы", "фраз")
      + " → " + voiceCount + " " + plural(voiceCount, "голос", "голоса", "голосов")
      + " · " + eventCount + " " + plural(eventCount, "событие", "события", "событий")
      + " · " + variability;

    return {
      profile: profile,
      activeTermCount: availableTerms,
      voiceCount: voiceCount,
      eventCount: eventCount,
      variationLabel: variability,
      summary: summary
    };
  }

  function plural(number, one, few, many) {
    const absolute = Math.abs(number) % 100;
    const last = absolute % 10;
    if (absolute > 10 && absolute < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  window.WORDSTAT_PARAMETERS = Object.freeze({
    DEFAULTS: DEFAULTS,
    STRUCTURE_PROFILES: STRUCTURE_PROFILES,
    TIME_MODES: TIME_MODES,
    ADVANCED_GROUPS: ADVANCED_GROUPS,
    profileAt: profileAt,
    mergeProfile: mergeProfile,
    describeStructure: describeStructure,
    clampState: clampState
  });
})();
