import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("ships every browser asset", () => {
  for (const name of ["index.html", "styles.css", "app.js", "yambda-data.js"]) {
    assert.equal(existsSync(resolve(root, name)), true, `${name} is missing`);
  }
  for (const name of ["app.js", "yambda-data.js"]) {
    execFileSync(process.execPath, ["--check", resolve(root, name)]);
  }
});

test("HTML exposes the Signal and Lab contract without duplicate IDs", () => {
  const html = read("index.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const required = [
    "signalView",
    "labView",
    "viewSignalButton",
    "viewLabButton",
    "heroPlay",
    "labTransport",
    "wakeButton",
    "structureControl",
    "labStructureControl",
    "profileTabs",
    "eventInspector",
    "metronomeToggle",
    "signalTrackRows",
    "labTrackRows",
    "savePreset",
    "loadPreset",
    "resetAll",
  ];

  assert.deepEqual(
    ids.filter((id, index) => ids.indexOf(id) !== index),
    [],
    "HTML contains duplicate IDs",
  );
  for (const id of required) assert.ok(ids.includes(id), `#${id} is missing`);
  for (const mode of ["flow", "elastic", "pulse"]) {
    assert.match(html, new RegExp(`data-time-mode="${mode}"`));
  }
  assert.ok(
    html.indexOf("yambda-data.js") < html.indexOf("app.js"),
    "dataset must load before the engine",
  );
});

test("every local HTML asset reference resolves inside the repository", () => {
  const html = read("index.html");
  const references = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => !/^(?:https?:|data:|#)/.test(reference));

  for (const reference of references) {
    const path = reference.split(/[?#]/)[0];
    assert.ok(path && !path.startsWith("/") && !path.includes(".."), `unsafe asset path: ${reference}`);
    assert.equal(existsSync(resolve(root, path)), true, `${reference} does not resolve`);
  }
});

test("the interface does not depend on remote font assets", () => {
  assert.doesNotMatch(read("styles.css"), /@import\s+url\(["']?https?:/);
});

test("demo data keeps three complete 16-event profiles", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(read("yambda-data.js"), context);
  const sequence = context.window.YAMBDA_SEQUENCE;

  assert.deepEqual(
    [...sequence.fields],
    ["played_ratio_pct", "track_length_seconds", "is_organic", "feedback", "timestamp_delta_5s"],
  );
  assert.equal(sequence.profiles.length, 3);
  assert.equal(new Set(sequence.profiles.map((profile) => profile.id)).size, 3);
  for (const profile of sequence.profiles) {
    assert.equal(profile.events.length, 16, `${profile.id} has an incomplete slice`);
    for (const event of profile.events) {
      assert.equal(event.length, 5);
      assert.ok(event.every(Number.isFinite));
      assert.ok(event[0] >= 0);
      assert.ok(event[1] > 0);
      assert.ok([0, 1].includes(event[2]));
      assert.ok([-1, 0, 1].includes(event[3]));
      assert.ok(event[4] >= 0);
    }
  }
  assert.equal(sequence.dataset.source, "https://huggingface.co/datasets/yandex/yambda");
});

test("engine contains every time lens and WebKit audio fallback", () => {
  const app = read("app.js");

  for (const mode of ['"flow"', '"elastic"', '"pulse"']) {
    assert.ok(app.includes(mode), `${mode} time mode is missing`);
  }
  for (const stage of ["ESSENCE", "CONTOUR", "SIGNAL", "SWARM"]) {
    assert.ok(app.includes(stage), `${stage} structure stage is missing`);
  }
  assert.match(app, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(app, /metronome:\s*false/);
  assert.match(app, /window\.__YAMBDA_DEBUG__/);
  assert.match(app, /localStorage/);
  assert.doesNotMatch(app, /index\s*%\s*4/);
});
