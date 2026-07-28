"use strict";

(function exposeDemoData() {
  const weeks = [
    "31 мар", "7 апр", "14 апр", "21 апр", "28 апр", "5 мая", "12 мая", "19 мая",
    "26 мая", "2 июн", "9 июн", "16 июн", "23 июн", "30 июн", "7 июл", "14 июл"
  ];

  const phrases = [
    { id: "join", phrase: "присоединение", group: "connection", base: 18420, affinity: 118, trend: 0.18, phase: 1, color: "#ffcc00" },
    { id: "research", phrase: "исследование", group: "connection", base: 42800, affinity: 104, trend: 0.07, phase: 7, color: "#ff8a65" },
    { id: "contribution", phrase: "свой вклад", group: "connection", base: 12600, affinity: 131, trend: 0.22, phase: 4, color: "#e66a9a" },
    { id: "cocreation", phrase: "сотворчество", group: "connection", base: 4700, affinity: 154, trend: 0.31, phase: 10, color: "#9b75e8" },
    { id: "expression", phrase: "выражение", group: "connection", base: 23700, affinity: 112, trend: 0.11, phase: 13, color: "#55a5f4" },
    { id: "accessibility", phrase: "доступность", group: "connection", base: 31500, affinity: 97, trend: 0.04, phase: 5, color: "#42b9a7" },
    { id: "transparency", phrase: "прозрачность", group: "feedback", base: 21800, affinity: 124, trend: 0.14, phase: 9, color: "#6d9f45" },
    { id: "tech_creation", phrase: "технологии → творчество", group: "chance", base: 8900, affinity: 146, trend: 0.27, phase: 2, color: "#b38a2a" },
    { id: "chance_experiment", phrase: "эксперимент со случайностью", group: "chance", base: 2200, affinity: 168, trend: 0.38, phase: 8, color: "#f57c42" },
    { id: "loop", phrase: "зацикливание / паттерн", group: "chance", base: 6800, affinity: 141, trend: 0.12, phase: 12, color: "#d95f8d" },
    { id: "sonority", phrase: "звучность", group: "chance", base: 9200, affinity: 135, trend: 0.19, phase: 6, color: "#8c6ed7" },
    { id: "emotion", phrase: "выбор эмоций", group: "feedback", base: 7600, affinity: 129, trend: 0.25, phase: 14, color: "#4f91da" },
    { id: "living_feedback", phrase: "обратная реакция живых", group: "feedback", base: 3100, affinity: 172, trend: 0.34, phase: 3, color: "#25a88e" },
    { id: "open_play", phrase: "открытость игре", group: "chance", base: 5400, affinity: 159, trend: 0.29, phase: 11, color: "#79a63a" }
  ];

  function seriesFor(term, index) {
    return weeks.map(function buildPoint(_, week) {
      const progress = week / (weeks.length - 1);
      const wave = Math.sin((week + term.phase) * 0.82) * 0.11;
      const secondary = Math.cos((week * 0.43) + index) * 0.055;
      const punctuation = ((week + term.phase) % 7 === 0 ? 0.12 : 0) - ((week + index) % 11 === 0 ? 0.08 : 0);
      return Math.max(20, Math.round(term.base * (1 + term.trend * progress + wave + secondary + punctuation)));
    });
  }

  window.WORDSTAT_SEQUENCE = {
    meta: {
      label: "Демонстрационная музыкальная модель",
      isDemo: true,
      source: "https://wordstat.yandex.ru/",
      format: "phrase,date,count,share,affinity",
      note: "Значения сгенерированы детерминированно для демонстрации сонфикации и не являются данными Яндекса."
    },
    weeks: weeks,
    scenes: [
      { id: "connection", name: "СОЕДИНЕНИЕ", note: "Устойчивый общий пульс", terms: ["join", "research", "contribution", "cocreation", "expression", "accessibility", "transparency", "tech_creation"] },
      { id: "chance", name: "СЛУЧАЙНОСТЬ", note: "Открытая вероятностная форма", terms: ["research", "cocreation", "tech_creation", "chance_experiment", "loop", "sonority", "open_play", "living_feedback"] },
      { id: "feedback", name: "ОБРАТНАЯ СВЯЗЬ", note: "Музыкальный вопрос и ответ", terms: ["join", "contribution", "expression", "transparency", "loop", "emotion", "living_feedback", "open_play"] }
    ],
    terms: phrases.map(function enrich(term, index) {
      return Object.assign({}, term, { values: seriesFor(term, index) });
    })
  };
})();
