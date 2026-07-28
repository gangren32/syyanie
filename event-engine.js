"use strict";

(function exposeWordstatEventEngine(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.WORDSTAT_EVENT_ENGINE = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createWordstatEventEngine() {
  "use strict";

  const SCALES = Object.freeze({
    "minor-pentatonic": Object.freeze([0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27]),
    dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19]),
    major: Object.freeze([0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19]),
    chromatic: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])
  });
  const TIME_MODES = Object.freeze(["grid", "elastic", "free"]);
  const DEFAULTS = Object.freeze({
    timeMode: "grid",
    bpm: 104,
    swing: 0.12,
    structureIndex: 2,
    complexity: 0.5,
    voiceBudget: 6,
    eventRate: 0.56,
    variation: 0.18,
    polyphony: 4,
    cycleDuration: 24,
    elasticity: 0.72,
    // 0.011 reproduces the original maximum humanize of chance * 0.011 s.
    jitter: 0.011,
    collisionWindow: 0.035,
    normalization: "log",
    periodResolution: 16,
    peakThreshold: 0.58,
    minEventStrength: 0.18,
    detail: 0.58,
    quantize: 0.86,
    scale: "minor-pentatonic",
    steps: 16
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function unitValue(value, fallback) {
    const number = finiteNumber(value, fallback);
    // Percentage-like values are accepted for small hand-authored integrations.
    return clamp(number > 1 && number <= 100 ? number / 100 : number, 0, 1);
  }

  function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function roundNumber(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  function mix32(value) {
    let result = value >>> 0;
    result = Math.imul(result ^ (result >>> 16), 0x21f0aaad);
    result = Math.imul(result ^ (result >>> 15), 0x735a2d97);
    return (result ^ (result >>> 15)) >>> 0;
  }

  function hashString(value) {
    const text = String(value == null ? "" : value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return mix32(hash);
  }

  function seedToUint(seed) {
    if (typeof seed === "number" && Number.isFinite(seed)) return mix32(seed >>> 0);
    return hashString(seed == null ? 0 : seed);
  }

  function mixSeed(seed) {
    let result = seedToUint(seed);
    for (let index = 1; index < arguments.length; index += 1) {
      result = mix32(result ^ hashString(arguments[index]) ^ Math.imul(index, 0x9e3779b9));
    }
    return result >>> 0;
  }

  /** Mulberry32: small, repeatable and intentionally not cryptographic. */
  function createPRNG(seed) {
    let state = seedToUint(seed);
    return function nextRandom() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The hash used by the original 16-step sequencer. */
  function legacyHashUnit(termIndex, periodIndex, seed) {
    const numericSeed = typeof seed === "number" && Number.isFinite(seed)
      ? seed >>> 0
      : seedToUint(seed);
    let value = Math.imul((termIndex + 1) ^ numericSeed, 0x45d9f3b)
      ^ Math.imul(periodIndex + 17, 0x27d4eb2d);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }

  function stableUnit(seed, termId, periodIndex, tag) {
    return createPRNG(mixSeed(seed, termId, periodIndex, tag))();
  }

  function inferPeriodCount(terms, weeks, requestedSteps) {
    const weekCount = Array.isArray(weeks) ? weeks.length : 0;
    const valueCount = Array.isArray(terms)
      ? terms.reduce(function longest(current, term) {
        return Math.max(current, term && Array.isArray(term.values) ? term.values.length : 0);
      }, 0)
      : 0;
    const available = weekCount || valueCount || DEFAULTS.steps;
    const fallback = Math.min(DEFAULTS.steps, available);
    return clamp(Math.round(finiteNumber(requestedSteps, fallback)), 1, 256);
  }

  function normalizeComplexity(params) {
    if (Number.isFinite(Number(params.complexity))) {
      const raw = Number(params.complexity);
      // A 1..5 value is also accepted for early UI prototypes.
      if (raw > 1 && raw <= 5) return clamp((raw - 1) / 4, 0, 1);
      return clamp(raw, 0, 1);
    }
    if (Number.isFinite(Number(params.structureIndex))) {
      return clamp(Number(params.structureIndex) / 4, 0, 1);
    }
    return DEFAULTS.complexity;
  }

  function normalizeParams(params, termCount, periodCount) {
    const input = params && typeof params === "object" ? params : {};
    const safeTermCount = Math.max(0, Math.floor(finiteNumber(termCount, DEFAULTS.voiceBudget)));
    const safePeriodCount = Math.max(1, Math.floor(finiteNumber(periodCount, DEFAULTS.steps)));
    const requestedMode = String(input.timeMode || DEFAULTS.timeMode).toLowerCase();
    const timeMode = TIME_MODES.indexOf(requestedMode) >= 0 ? requestedMode : DEFAULTS.timeMode;
    const complexity = normalizeComplexity(input);
    const rawBudget = finiteNumber(input.voiceBudget, DEFAULTS.voiceBudget);
    const voiceBudget = clamp(Math.floor(rawBudget), 0, safeTermCount);
    const rawPolyphony = finiteNumber(input.polyphony, DEFAULTS.polyphony);
    const polyphony = clamp(Math.floor(rawPolyphony), 0, Math.max(0, voiceBudget));
    const eventRateInput = input.eventRate != null ? input.eventRate : input.density;
    const variationInput = input.variation != null ? input.variation : input.chance;
    const requestedNormalization = String(input.normalization || DEFAULTS.normalization).toLowerCase();
    const normalization = ["linear", "log", "rank"].indexOf(requestedNormalization) >= 0
      ? requestedNormalization
      : DEFAULTS.normalization;
    const requestedScale = String(input.scale || DEFAULTS.scale).toLowerCase();
    const scale = Object.prototype.hasOwnProperty.call(SCALES, requestedScale)
      ? requestedScale
      : DEFAULTS.scale;

    return {
      timeMode: timeMode,
      bpm: clamp(finiteNumber(input.bpm, DEFAULTS.bpm), 20, 360),
      swing: unitValue(input.swing, DEFAULTS.swing),
      complexity: complexity,
      structureIndex: Math.round(complexity * 4),
      voiceBudget: voiceBudget,
      eventRate: unitValue(eventRateInput, DEFAULTS.eventRate),
      variation: unitValue(variationInput, DEFAULTS.variation),
      polyphony: polyphony,
      cycleDuration: clamp(
        finiteNumber(input.cycleDuration, finiteNumber(input.durationSeconds, DEFAULTS.cycleDuration)),
        0.5,
        300
      ),
      elasticity: unitValue(
        input.elasticity != null ? input.elasticity : input.elasticStrength,
        DEFAULTS.elasticity
      ),
      jitter: clamp(finiteNumber(input.jitter, DEFAULTS.jitter), 0, 0.5),
      collisionWindow: clamp(
        finiteNumber(input.collisionWindow, DEFAULTS.collisionWindow),
        0.001,
        0.5
      ),
      normalization: normalization,
      periodResolution: clamp(
        Math.round(finiteNumber(input.periodResolution, DEFAULTS.periodResolution)),
        4,
        32
      ),
      peakThreshold: clamp(finiteNumber(input.peakThreshold, DEFAULTS.peakThreshold), 0, 1),
      minEventStrength: clamp(finiteNumber(input.minEventStrength, DEFAULTS.minEventStrength), 0, 1),
      detail: unitValue(input.detail, DEFAULTS.detail),
      quantize: unitValue(input.quantize, DEFAULTS.quantize),
      scale: scale,
      scaleIntervals: SCALES[scale],
      periodCount: safePeriodCount
    };
  }

  function normalizeTerm(term, inputIndex, periodCount) {
    const source = term && typeof term === "object" ? term : {};
    const rawValues = Array.isArray(source.values) ? source.values.slice(0, periodCount) : [];
    const values = [];
    let lastValue = 0;

    for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
      if (periodIndex < rawValues.length && Number.isFinite(Number(rawValues[periodIndex]))) {
        lastValue = Math.max(0, Number(rawValues[periodIndex]));
      }
      values.push(lastValue);
    }

    const id = source.id == null ? "term-" + inputIndex : String(source.id);
    const engineIndex = Number.isInteger(source.engineIndex) && source.engineIndex >= 0
      ? source.engineIndex
      : inputIndex;

    return {
      id: id,
      inputIndex: inputIndex,
      engineIndex: engineIndex,
      values: values,
      affinity: finiteNumber(source.affinity, 100),
      kind: source.group == null ? "connection" : String(source.group)
    };
  }

  function localWeightedAverage(values, center, radius) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const index = clamp(center + offset, 0, values.length - 1);
      const weight = radius + 1 - Math.abs(offset);
      weightedSum += values[index] * weight;
      totalWeight += weight;
    }
    return totalWeight > 0 ? weightedSum / totalWeight : values[center];
  }

  /**
   * periodResolution changes analytical granularity, never the source indices.
   * Below the native period count it increasingly smooths neighbouring periods;
   * above it a bounded unsharp pass reveals local movement without inventing new
   * periodIndex values.
   */
  function resolvePeriodValues(values, periodResolution) {
    const nativeResolution = Math.max(1, values.length);
    if (!values.length || periodResolution === nativeResolution) return values.slice();

    if (periodResolution < nativeResolution) {
      const blend = clamp(
        (nativeResolution - periodResolution) / Math.max(1, nativeResolution - 4),
        0,
        1
      );
      const radius = Math.max(1, Math.ceil(nativeResolution / Math.max(1, periodResolution)));
      return values.map(function smooth(value, periodIndex) {
        const average = localWeightedAverage(values, periodIndex, radius);
        return Math.max(0, value * (1 - blend) + average * blend);
      });
    }

    const enhancement = clamp((periodResolution / nativeResolution - 1) * 0.25, 0, 0.35);
    return values.map(function revealDetail(value, periodIndex) {
      const average = localWeightedAverage(values, periodIndex, 1);
      return Math.max(0, value + (value - average) * enhancement);
    });
  }

  function applyPeriodResolution(terms, params) {
    return terms.map(function resolveTerm(term) {
      return {
        id: term.id,
        inputIndex: term.inputIndex,
        engineIndex: term.engineIndex,
        values: resolvePeriodValues(term.values, params.periodResolution),
        affinity: term.affinity,
        kind: term.kind
      };
    });
  }

  function termRange(term) {
    if (!term.values.length) return { min: 0, max: 0 };
    return {
      min: Math.min.apply(null, term.values),
      max: Math.max.apply(null, term.values)
    };
  }

  function termIntensity(term, periodIndex) {
    if (Array.isArray(term.intensities)) return term.intensities[periodIndex];
    const range = termRange(term);
    if (range.max === range.min) return 0.6;
    return clamp((term.values[periodIndex] - range.min) / (range.max - range.min), 0, 1);
  }

  function voiceScore(term) {
    if (!term.values.length) return 0;
    const logs = term.values.map(function toLog(value) { return Math.log10(Math.max(1, value)); });
    const mean = logs.reduce(function sum(total, value) { return total + value; }, 0) / logs.length;
    let motion = 0;
    for (let index = 1; index < logs.length; index += 1) {
      motion += Math.abs(logs[index] - logs[index - 1]);
    }
    motion /= Math.max(1, logs.length - 1);
    return mean + motion * 1.8 + clamp(term.affinity / 180, 0, 1) * 0.18;
  }

  function rankedVoices(terms, limit) {
    if (limit >= terms.length) return terms.slice();
    return terms
      .map(function scoreTerm(term) { return { term: term, score: voiceScore(term) }; })
      .sort(function bySignal(left, right) {
        return right.score - left.score || left.term.inputIndex - right.term.inputIndex;
      })
      .slice(0, limit)
      .map(function takeTerm(item) { return item.term; })
      .sort(function restoreInputOrder(left, right) { return left.inputIndex - right.inputIndex; });
  }

  /**
   * At the simplest structure level no selected phrase disappears from the data
   * story. Query counts are affinity-weighted into one shared curve. The curve is
   * then voiced by the requested representatives, so voiceBudget remains the one
   * and only voice-count limit while every input term still affects count, delta,
   * velocity and brightness.
   */
  function aggregateSignalVoices(terms, representatives, periodCount) {
    if (!terms.length || !representatives.length) return [];
    const values = new Array(periodCount).fill(0);
    let affinityNumerator = 0;
    let affinityDenominator = 0;

    terms.forEach(function addContribution(term) {
      const affinityWeight = clamp(term.affinity / 100, 0.35, 2.5);
      let termVolume = 0;
      for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
        const contribution = term.values[periodIndex] * affinityWeight;
        values[periodIndex] += contribution;
        termVolume += term.values[periodIndex];
      }
      const brightnessWeight = Math.max(1, termVolume) * affinityWeight;
      affinityNumerator += term.affinity * brightnessWeight;
      affinityDenominator += brightnessWeight;
    });

    const aggregateAffinity = affinityDenominator > 0
      ? affinityNumerator / affinityDenominator
      : 100;

    return representatives.map(function buildAggregateVoice(representative) {
      return {
        id: representative.id,
        inputIndex: representative.inputIndex,
        engineIndex: representative.engineIndex,
        values: values.slice(),
        affinity: aggregateAffinity,
        kind: representative.kind
      };
    });
  }

  function selectVoices(terms, params) {
    if (!terms.length || params.voiceBudget === 0) return [];
    const limit = Math.min(params.voiceBudget, terms.length);
    const representatives = rankedVoices(terms, limit);
    return params.complexity === 0
      ? aggregateSignalVoices(terms, representatives, params.periodCount)
      : representatives;
  }

  function rankNormalize(values, fallback) {
    const unique = Array.from(new Set(values)).sort(function ascending(left, right) { return left - right; });
    if (unique.length <= 1) return values.map(function constantRank() { return fallback; });
    const ranks = new Map();
    unique.forEach(function storeRank(value, index) {
      ranks.set(value, index / (unique.length - 1));
    });
    return values.map(function readRank(value) { return ranks.get(value); });
  }

  function normalizeDataSeries(values, normalization, fallback) {
    if (!values.length) return [];
    if (normalization === "rank") return rankNormalize(values, fallback);
    const transformed = normalization === "log"
      ? values.map(function logarithmic(value) { return Math.log10(Math.max(1, value)); })
      : values.slice();
    const min = Math.min.apply(null, transformed);
    const max = Math.max.apply(null, transformed);
    if (max === min) return transformed.map(function constantValue() { return fallback; });
    return transformed.map(function normalize(value) { return clamp((value - min) / (max - min), 0, 1); });
  }

  function findPeakAccents(intensities, threshold) {
    return intensities.map(function findPeak(value, periodIndex) {
      const previous = intensities[Math.max(0, periodIndex - 1)];
      const next = intensities[Math.min(intensities.length - 1, periodIndex + 1)];
      if (value < previous || value < next) return 0;
      const prominence = Math.max(0, value - (previous + next) / 2);
      const score = clamp(value * 0.72 + prominence * 0.9, 0, 1);
      if (score < threshold) return 0;
      return clamp(0.35 + 0.65 * ((score - threshold) / Math.max(0.001, 1 - threshold)), 0, 1);
    });
  }

  function prepareDataMapping(terms, params) {
    const allValues = [];
    terms.forEach(function collectTerm(term) {
      term.values.forEach(function collectValue(value) { allValues.push(value); });
    });
    const allPowers = normalizeDataSeries(allValues, params.normalization, 0.65);
    let powerCursor = 0;

    return terms.map(function mapTerm(term) {
      const intensities = normalizeDataSeries(term.values, params.normalization, 0.6);
      const powers = allPowers.slice(powerCursor, powerCursor + term.values.length);
      powerCursor += term.values.length;
      return {
        id: term.id,
        inputIndex: term.inputIndex,
        engineIndex: term.engineIndex,
        values: term.values.slice(),
        affinity: term.affinity,
        kind: term.kind,
        intensities: intensities,
        powers: powers,
        peakAccents: findPeakAccents(intensities, params.peakThreshold)
      };
    });
  }

  function termPower(term, periodIndex) {
    return Array.isArray(term.powers) ? term.powers[periodIndex] : 0.65;
  }

  function termPeakAccent(term, periodIndex) {
    return Array.isArray(term.peakAccents) ? term.peakAccents[periodIndex] : 0;
  }

  function eventMetrics(term, periodIndex) {
    const intensity = termIntensity(term, periodIndex);
    const power = termPower(term, periodIndex);
    const peakAccent = termPeakAccent(term, periodIndex);
    return {
      intensity: intensity,
      power: power,
      peakAccent: peakAccent,
      strength: clamp(intensity * 0.55 + power * 0.3 + peakAccent * 0.15, 0, 1)
    };
  }

  function effectiveEventRate(params) {
    // Complexity and detail thin the form monotonically without changing seed.
    return clamp(
      params.eventRate
        * (0.45 + params.complexity * 0.55)
        * (0.52 + params.detail * 0.48),
      0,
      1
    );
  }

  function isCandidateActive(metrics, rhythmicBias, activationRandom, dropoutRandom, params) {
    if (metrics.strength < params.minEventStrength) return false;
    const threshold = 0.78 - effectiveEventRate(params) * 0.62;
    const peakBoost = metrics.peakAccent * (0.12 + params.detail * 0.12);
    if (metrics.intensity + rhythmicBias + peakBoost + activationRandom * 0.22 <= threshold) return false;
    return dropoutRandom >= params.variation * 0.18;
  }

  function eventKindOffset(kind) {
    if (kind === "chance") return 12;
    if (kind === "feedback") return 5;
    return 0;
  }

  function createDataEvent(term, periodIndex, atSeconds, params) {
    const metrics = eventMetrics(term, periodIndex);
    const current = term.values[periodIndex];
    const previous = term.values[Math.max(0, periodIndex - 1)];
    const delta = clamp((current - previous) / Math.max(1, previous), -0.25, 0.25);
    const scale = params.scaleIntervals;
    const scaleIndex = positiveModulo(periodIndex + Math.round(delta * 20), scale.length);
    const noteOffset = (term.engineIndex % 7) + scale[scaleIndex] + eventKindOffset(term.kind);
    const priority = metrics.intensity * 0.44
      + metrics.power * 0.28
      + metrics.peakAccent * 0.12
      + clamp(term.affinity / 180, 0, 1) * 0.16;

    return {
      termId: term.id,
      termIndex: term.inputIndex,
      periodIndex: periodIndex,
      atSeconds: atSeconds,
      velocity: clamp(
        0.13 + metrics.intensity * 0.28 + metrics.power * 0.24 + metrics.peakAccent * 0.12,
        0,
        1
      ),
      noteOffset: noteOffset,
      brightness: clamp(term.affinity / 180, 0.35, 1),
      pan: clamp(((term.engineIndex % 5) - 2) * 0.24, -0.72, 0.72),
      kind: term.kind,
      source: "data",
      _priority: priority
    };
  }

  function quantizeToPeriod(rawTime, periodIndex, duration, params, customAnchor) {
    const anchor = Number.isFinite(customAnchor)
      ? customAnchor
      : periodIndex * duration / params.periodCount;
    return clamp(
      rawTime + (anchor - rawTime) * params.quantize,
      0,
      duration - 1e-6
    );
  }

  function buildGridCandidates(terms, params, seed, duration) {
    const candidates = [];
    const stepDuration = duration / params.periodCount;

    terms.forEach(function buildTerm(term) {
      for (let periodIndex = 0; periodIndex < params.periodCount; periodIndex += 1) {
        const metrics = eventMetrics(term, periodIndex);
        const rhythmicBias = periodIndex % 4 === 0 ? 0.2 : (periodIndex % 2 === 0 ? 0.08 : 0);
        const activation = legacyHashUnit(term.engineIndex, periodIndex, seed);
        // Original scheduleStep starts at cycle 1, hence period + 3.
        const legacySeed = typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : seedToUint(seed);
        const variation = legacyHashUnit(term.engineIndex, periodIndex + 3, legacySeed + 77);
        if (!isCandidateActive(metrics, rhythmicBias, activation, variation, params)) continue;

        const swingOffset = periodIndex % 2 ? stepDuration * params.swing : 0;
        const anchor = periodIndex * stepDuration + swingOffset;
        const humanOffset = (variation - 0.5)
          * 2
          * params.jitter
          * params.variation
          * params.detail;
        const atSeconds = quantizeToPeriod(anchor + humanOffset, periodIndex, duration, params, anchor);
        candidates.push(createDataEvent(term, periodIndex, atSeconds, params));
      }
    });

    return candidates;
  }

  function aggregateSeries(terms, periodCount) {
    const aggregate = new Array(periodCount).fill(0);
    terms.forEach(function addTerm(term) {
      for (let periodIndex = 0; periodIndex < periodCount; periodIndex += 1) {
        aggregate[periodIndex] += term.values[periodIndex];
      }
    });
    return aggregate;
  }

  /**
   * Returns variable segment starts and lengths. Sharp aggregate movement and a
   * high aggregate level shorten a segment; plateaus are allowed to breathe.
   * The weights are normalized, so their sum remains exactly cycleDuration.
   */
  function buildElasticTimeline(terms, periodCount, cycleDuration, elasticity) {
    const aggregate = aggregateSeries(terms, periodCount);
    const changes = aggregate.map(function relativeLogChange(value, periodIndex) {
      if (periodIndex === 0) return 0;
      return Math.min(1, Math.abs(Math.log((value + 1) / (aggregate[periodIndex - 1] + 1))));
    });
    const maxChange = Math.max.apply(null, changes.concat([0]));
    const minValue = Math.min.apply(null, aggregate.concat([0]));
    const maxValue = Math.max.apply(null, aggregate.concat([0]));
    const weights = aggregate.map(function segmentWeight(value, periodIndex) {
      const changeUnit = maxChange > 0 ? changes[periodIndex] / maxChange : 0;
      const levelUnit = maxValue > minValue ? (value - minValue) / (maxValue - minValue) : 0.5;
      const movementWeight = 1.18 - elasticity * 0.68 * changeUnit;
      const levelWeight = 1.08 - elasticity * 0.18 * levelUnit;
      return Math.max(0.2, movementWeight * levelWeight);
    });
    const totalWeight = weights.reduce(function sum(total, weight) { return total + weight; }, 0) || 1;
    const lengths = weights.map(function scaleWeight(weight) {
      return cycleDuration * weight / totalWeight;
    });
    const starts = [];
    let cursor = 0;
    lengths.forEach(function addLength(length) {
      starts.push(cursor);
      cursor += length;
    });
    // Remove floating point drift from the public duration contract.
    lengths[lengths.length - 1] += cycleDuration - cursor;
    return { aggregate: aggregate, starts: starts, lengths: lengths };
  }

  function buildElasticCandidates(terms, params, seed, duration) {
    const timeline = buildElasticTimeline(terms, params.periodCount, duration, params.elasticity);
    const candidates = [];

    terms.forEach(function buildTerm(term) {
      for (let periodIndex = 0; periodIndex < params.periodCount; periodIndex += 1) {
        const metrics = eventMetrics(term, periodIndex);
        const activation = stableUnit(seed, term.id, periodIndex, "elastic-active");
        const variation = stableUnit(seed, term.id, periodIndex, "elastic-drop");
        if (!isCandidateActive(metrics, 0, activation, variation, params)) continue;

        const start = timeline.starts[periodIndex];
        const length = timeline.lengths[periodIndex];
        const placement = stableUnit(seed, term.id, periodIndex, "elastic-place");
        const timingDetail = 0.2 + params.detail * 0.8;
        const localFraction = 0.08 + placement * params.variation * timingDetail * 0.54;
        const microOffset = (variation - 0.5)
          * 2
          * params.jitter
          * params.variation
          * params.detail;
        // Every event remains inside its own segment, hence period order is kept.
        const elasticTime = clamp(
          start + length * localFraction + microOffset,
          start + Math.min(1e-6, length * 0.01),
          start + length - Math.min(1e-6, length * 0.01)
        );
        const atSeconds = quantizeToPeriod(elasticTime, periodIndex, duration, params);
        candidates.push(createDataEvent(term, periodIndex, atSeconds, params));
      }
    });

    return candidates;
  }

  function buildFreeCandidates(terms, params, seed, duration) {
    const candidates = [];
    const meanGap = duration / (params.periodCount + 1);

    terms.forEach(function buildIndependentStream(term) {
      // The stream seed contains the stable term id, not its array position. Adding
      // or reordering another term therefore cannot move this term's events.
      const random = createPRNG(mixSeed(seed, term.id, "free-stream"));
      const phase = random() * meanGap * 0.78;
      const pace = 0.78 + random() * 0.44;
      const positions = [];
      const decisions = [];
      let cursor = phase;

      for (let periodIndex = 0; periodIndex < params.periodCount; periodIndex += 1) {
        const metrics = eventMetrics(term, periodIndex);
        const activation = random();
        const dropout = random();
        const intervalRandom = random();
        positions.push(cursor);
        decisions.push({ metrics: metrics, activation: activation, dropout: dropout });

        const dataPace = 1.28 - metrics.intensity * 0.56;
        const randomPace = 1
          + (intervalRandom - 0.5) * params.variation * params.detail * 0.9;
        cursor += meanGap * pace * dataPace * randomPace;
      }

      const lastPosition = positions[positions.length - 1] || 0;
      const scale = lastPosition >= duration ? (duration - 1e-6) / Math.max(lastPosition, 1e-6) : 1;
      positions.forEach(function emitPosition(atSeconds, periodIndex) {
        const decision = decisions[periodIndex];
        if (!isCandidateActive(
          decision.metrics,
          0,
          decision.activation,
          decision.dropout,
          params
        )) return;
        const freeTime = atSeconds * scale;
        const quantizedTime = quantizeToPeriod(freeTime, periodIndex, duration, params);
        candidates.push(createDataEvent(term, periodIndex, quantizedTime, params));
      });
    });

    return candidates;
  }

  function comparePriority(left, right) {
    return right._priority - left._priority
      || left.atSeconds - right.atSeconds
      || left.termIndex - right.termIndex
      || left.periodIndex - right.periodIndex;
  }

  function enforcePeriodPolyphony(candidates, limit) {
    if (limit <= 0) return [];
    const byPeriod = new Map();
    candidates.forEach(function collect(event) {
      if (!byPeriod.has(event.periodIndex)) byPeriod.set(event.periodIndex, []);
      byPeriod.get(event.periodIndex).push(event);
    });
    const kept = [];
    byPeriod.forEach(function keepPeriod(events) {
      events.sort(comparePriority).slice(0, limit).forEach(function keep(event) { kept.push(event); });
    });
    return kept;
  }

  function enforceFreePolyphony(candidates, limit, collisionWindow) {
    if (limit <= 0) return [];
    const kept = [];
    candidates.slice().sort(comparePriority).forEach(function consider(candidate) {
      const collisions = kept.reduce(function count(total, event) {
        return total + (Math.abs(event.atSeconds - candidate.atSeconds) <= collisionWindow ? 1 : 0);
      }, 0);
      if (collisions < limit) kept.push(candidate);
    });
    return kept;
  }

  function publicEvent(event) {
    return {
      termId: event.termId,
      termIndex: event.termIndex,
      periodIndex: event.periodIndex,
      atSeconds: roundNumber(event.atSeconds, 6),
      velocity: roundNumber(event.velocity, 6),
      noteOffset: event.noteOffset,
      brightness: roundNumber(event.brightness, 6),
      pan: roundNumber(event.pan, 6),
      kind: event.kind,
      source: event.source
    };
  }

  function compareEvents(left, right) {
    const kindOrder = String(left.kind) < String(right.kind) ? -1 : (String(left.kind) > String(right.kind) ? 1 : 0);
    return left.atSeconds - right.atSeconds
      || left.periodIndex - right.periodIndex
      || left.termIndex - right.termIndex
      || kindOrder;
  }

  /**
   * Pure data-to-time planner. It neither reads browser state nor mutates terms,
   * weeks or params. Identical input and seed produce byte-for-byte equal plans.
   */
  function buildEventPlan(options) {
    const input = options && typeof options === "object" ? options : {};
    const inputTerms = Array.isArray(input.terms) ? input.terms : [];
    const inputWeeks = Array.isArray(input.weeks) ? input.weeks : [];
    const inputParams = input.params && typeof input.params === "object" ? input.params : {};
    const periodCount = inferPeriodCount(inputTerms, inputWeeks, inputParams.steps);
    const params = normalizeParams(inputParams, inputTerms.length, periodCount);
    const seed = input.seed == null ? 0 : input.seed;
    const normalizedTerms = inputTerms.map(function normalize(term, termIndex) {
      return normalizeTerm(term, termIndex, periodCount);
    });
    const resolvedTerms = applyPeriodResolution(normalizedTerms, params);
    const selectedTerms = selectVoices(resolvedTerms, params);
    const terms = prepareDataMapping(selectedTerms, params);
    const stepDuration = 60 / params.bpm / 4;
    const duration = params.timeMode === "grid"
      ? periodCount * stepDuration
      : params.cycleDuration;
    let candidates;

    if (params.timeMode === "elastic") {
      candidates = buildElasticCandidates(terms, params, seed, duration);
    } else if (params.timeMode === "free") {
      candidates = buildFreeCandidates(terms, params, seed, duration);
    } else {
      candidates = buildGridCandidates(terms, params, seed, duration);
    }

    const limited = params.timeMode === "free"
      ? enforceFreePolyphony(candidates, params.polyphony, params.collisionWindow)
      : enforcePeriodPolyphony(candidates, params.polyphony);
    const events = limited.map(publicEvent).sort(compareEvents);

    return {
      duration: roundNumber(duration, 6),
      events: events
    };
  }

  function validatePlan(plan) {
    const errors = [];
    if (!plan || typeof plan !== "object") {
      return { valid: false, errors: ["plan must be an object"] };
    }
    if (!Number.isFinite(plan.duration) || plan.duration <= 0) {
      errors.push("duration must be a positive finite number");
    }
    if (!Array.isArray(plan.events)) {
      errors.push("events must be an array");
      return { valid: false, errors: errors };
    }

    let previousTime = -Infinity;
    plan.events.forEach(function validateEvent(event, index) {
      const label = "events[" + index + "]";
      if (!event || typeof event !== "object") {
        errors.push(label + " must be an object");
        return;
      }
      if (typeof event.termId !== "string" || !event.termId) errors.push(label + ".termId must be a non-empty string");
      if (!Number.isInteger(event.termIndex) || event.termIndex < 0) errors.push(label + ".termIndex must be a non-negative integer");
      if (!Number.isInteger(event.periodIndex) || event.periodIndex < 0) errors.push(label + ".periodIndex must be a non-negative integer");
      if (!Number.isFinite(event.atSeconds) || event.atSeconds < 0) errors.push(label + ".atSeconds must be non-negative and finite");
      if (Number.isFinite(plan.duration) && event.atSeconds >= plan.duration + 1e-6) errors.push(label + ".atSeconds is outside duration");
      if (event.atSeconds < previousTime) errors.push(label + " is not sorted by atSeconds");
      previousTime = Number.isFinite(event.atSeconds) ? event.atSeconds : previousTime;
      if (!Number.isFinite(event.velocity) || event.velocity < 0 || event.velocity > 1) errors.push(label + ".velocity must be in [0, 1]");
      if (!Number.isFinite(event.noteOffset)) errors.push(label + ".noteOffset must be finite");
      if (!Number.isFinite(event.brightness) || event.brightness < 0 || event.brightness > 1) errors.push(label + ".brightness must be in [0, 1]");
      if (!Number.isFinite(event.pan) || event.pan < -1 || event.pan > 1) errors.push(label + ".pan must be in [-1, 1]");
      if (typeof event.kind !== "string" || !event.kind) errors.push(label + ".kind must be a non-empty string");
      if (event.source !== "data" && event.source !== "response") errors.push(label + ".source must be data or response");
    });

    return { valid: errors.length === 0, errors: errors };
  }

  return Object.freeze({
    VERSION: "2.0.0",
    DEFAULTS: DEFAULTS,
    SCALES: SCALES,
    TIME_MODES: TIME_MODES,
    buildEventPlan: buildEventPlan,
    validatePlan: validatePlan,
    normalizeParams: normalizeParams,
    createPRNG: createPRNG,
    hashString: hashString,
    buildElasticTimeline: buildElasticTimeline
  });
});
