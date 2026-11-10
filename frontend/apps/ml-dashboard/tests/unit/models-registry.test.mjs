/**
 * The Models tab says what each model is (#321).
 *
 * Settled with Isaac on 2026-10-31: a version is a free label, status is active or
 * archived, the base model is the parent by name, and Register Model uploads weights --
 * registering with a warning for class names that match no species.
 *
 * @author Isaac Travers
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawScreen } from './screen.mjs';

const model = (id, name, extra = {}) => ({
  id,
  name,
  model_type: 'detection',
  architecture_version: 'yolov8x',
  engine: 'ultralytics',
  file_format: 'pt',
  status: 'active',
  version_label: null,
  parent_model_id: null,
  storage_path: `models/${name}/weights/${name}.pt`,
  artifact_sha256: 'a'.repeat(64),
  weights: { present: true, bytes: 136_000_000 },
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
  ...extra,
});

const REGISTRY = [
  model(197, 'rockfish2'),
  model(412, 'rockfish5-2026-10-20', { parent_model_id: 197, training_run_id: 199, version_label: 'v2 more quillback' }),
  model(433, 'CookieStarTest-2026-10-23', { parent_model_id: 412, training_run_id: 202 }),
  model(91, 'retired', { status: 'archived', weights: { present: false, bytes: null } }),
];

const draw = (extra = {}) => drawScreen('models.html', {
  listModels: async () => REGISTRY,
  listTrainingRuns: async () => [{ id: 199, dataset_id: 384 }],
  listDatasets: async () => [{ id: 384, name: 'rockfish5' }],
  listModelSpecies: async () => [{ comname: 'Quillback rockfish' }],
  ...extra,
});

const row = (document, id) => document.querySelector(`#models tbody tr[data-model="${id}"]`);
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

test('each row shows the task with its architecture, the label, and the parent by name', async (t) => {
  const screen = await draw();
  t.after(screen.close);

  const head = row(screen.document, 412);
  assert.equal(text(head.querySelector('.htask')), 'detection yolov8x');
  assert.equal(text(head.querySelector('.hver')), 'v2 more quillback');
  assert.equal(text(head.querySelector('.hbase')), 'rockfish2', 'the parent, not architecture_version');
  assert.equal(text(head.querySelector('.hstatus')), 'Active');
  assert.equal(text(row(screen.document, 197).querySelector('.hver')), '—', 'no label is a dash, never an invented v1');
});

test('the status filter offers active and archived, and the ring adds up', async (t) => {
  const screen = await draw();
  t.after(screen.close);

  const status = screen.document.querySelector('select[aria-label="Status"]');
  assert.deepEqual([...status.options].map((one) => one.textContent), ['All statuses', 'Active', 'Archived']);

  const key = text(screen.document.querySelector('.job-mix-key'));
  assert.match(key, /3 Active/);
  assert.match(key, /1 Archived/);
  assert.equal(text(screen.document.querySelector('.job-donut > span > b')), '4');
});

test('the detail says what the weights are, where the model came from and what came of it', async (t) => {
  const screen = await draw();
  t.after(screen.close);

  const detail = row(screen.document, 412).nextElementSibling;
  const registry = text(detail.querySelector('[data-model-registry]'));
  const lineage = text(detail.querySelector('[data-model-lineage]'));

  assert.match(registry, /Engine\s*ultralytics · \.pt/);
  assert.match(registry, /Weights\s*0\.1 GB on the API/);
  assert.match(registry, /sha256\s*aaaaaaaaaaaaaaaa…/);
  assert.match(lineage, /From\s*rockfish2 → rockfish5-2026-10-20/);
  assert.match(lineage, /Trained from it\s*CookieStarTest-2026-10-23/);
  assert.match(lineage, /Trained on\s*rockfish5/);

  const missing = text(row(screen.document, 91).nextElementSibling.querySelector('[data-model-registry]'));
  assert.match(missing, /Not on the API: a job cannot fetch it/);
});

test('a label is saved, a model archived, and its species read when opened', async (t) => {
  const updates = [];
  const screen = await draw({
    updateModel: async (id, fields) => { updates.push([id, fields]); return { id, ...fields }; },
  });
  t.after(screen.close);
  screen.window.confirm = () => true;

  const detail = row(screen.document, 197).nextElementSibling;
  detail.querySelector('[data-model-label="197"]').value = 'v1 field test';
  detail.querySelector('[data-model-label-save="197"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  row(screen.document, 433).nextElementSibling.querySelector('[data-model-status="archived"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  // As JSON: the objects were made in the page's realm.
  assert.equal(JSON.stringify(updates), JSON.stringify([[197, { version_label: 'v1 field test' }], [433, { status: 'archived' }]]));

  row(screen.document, 412).querySelector('.exbtn').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(text(screen.document.querySelector('[data-model-species="412"]')), 'Quillback rockfish');
});

test('Register uploads the weights and says which classes matched no species', async (t) => {
  const sent = [];
  const screen = await draw({
    uploadModel: async (form) => {
      sent.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : 'file'])));
      return {
        model: { id: 500, name: 'uploaded', model_type: 'detection', architecture_version: 'yolo11n' },
        class_names: ['Quillback rockfish', 'trash'],
        matched: [{ class_name: 'Quillback rockfish', species_id: 1 }],
        unmatched: [{ class_name: 'trash', matches: 0 }],
      };
    },
  });
  t.after(screen.close);

  const form = screen.document.querySelector('#modelRegisterForm');
  form.querySelector('[name="name"]').value = 'uploaded';
  form.dispatchEvent(new screen.window.Event('submit', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].name, 'uploaded');
  assert.equal('parent_model_id' in sent[0], false, 'no base chosen sends none');

  const status = text(screen.document.querySelector('[data-model-register-status]'));
  assert.match(status, /Registered uploaded: detection, yolo11n, 1 of 2 classes matched to species/);
  assert.match(status, /No species for trash: detections of these cannot become observations/);
});

/* #287: a habitat model's rules are stored with it and sent with every run, so the Models
   screen shows what a run applies -- Mud's cut-off with its raise added -- and a species
   model shows no such section. */
test('a habitat model shows its decision rules, and a species model none', async (t) => {
  const rules = {
    version: 1,
    substrates: ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'],
    tuned_cut_offs: { Rock: 0.45, Mud: 0.5, Sand: 0.4, Cobble: 0.35, Boulder: 0.3 },
    raise: { Mud: 0.2 },
    crop: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1 },
    input_size: 518,
    samples_per_second: 3,
    average_s: 1,
    exclusive: [['Mud', 'Sand', 'Gravel']],
    min_stretch_s: 2,
    bridge_s: 2,
  };
  const screen = await draw({
    listModels: async () => [...REGISTRY, model(500, 'campa-habitat-2026-11-10', {
      model_type: 'habitat', architecture_version: 'vit_base_patch14_dinov2', decision_rules: rules,
    })],
  });
  t.after(screen.close);

  const section = row(screen.document, 500).nextElementSibling.querySelector('[data-habitat-rules]');
  assert.ok(section, 'the habitat model has a Decision rules section');
  const said = text(section);
  assert.match(said, /Mud\s*0\.50 tuned, raised by 0\.20 to 0\.70/);
  assert.match(said, /Rock\s*0\.45/);
  assert.match(said, /3 frames a second, scores averaged over 1 s/);
  assert.match(said, /Mud, Sand and Gravel: the surer one stays/);
  assert.match(said, /At least 2 s; breaks of 2 s or less bridged/);
  assert.match(said, /x 0\.25–0\.75, y 0\.50–1\.00 of the frame, at 518 px/);

  assert.equal(row(screen.document, 412).nextElementSibling.querySelector('[data-habitat-rules]'), null);
});

/* #287 R9 (Isaac, 2026-11-10): the never-together group is a setting a person changes per model. */
test('a habitat model\'s never-together group is edited on its detail and saved', async (t) => {
  const saved = [];
  const rules = {
    version: 1,
    substrates: ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder'],
    tuned_cut_offs: { Rock: 0.45, Mud: 0.5, Sand: 0.4, Cobble: 0.35, Boulder: 0.3 },
    raise: { Mud: 0.2 },
    crop: { x0: 0.25, y0: 0.5, x1: 0.75, y1: 1 },
    input_size: 518,
    samples_per_second: 3,
    average_s: 1,
    exclusive: [['Mud', 'Sand', 'Gravel']],
    min_stretch_s: 2,
    bridge_s: 2,
  };
  const screen = await draw({
    listModels: async () => [model(500, 'campa-habitat-2026-11-10', { model_type: 'habitat', decision_rules: rules })],
    setNeverTogether: async (id, groups) => { saved.push(JSON.parse(JSON.stringify([id, groups]))); return {}; },
  });
  t.after(screen.close);

  const detail = row(screen.document, 500).nextElementSibling;
  const boxes = [...detail.querySelectorAll('[data-never-together="500"]')];
  assert.deepEqual(boxes.map((b) => b.value), ['Rock', 'Mud', 'Sand', 'Cobble', 'Boulder', 'Gravel'], 'the five, and Gravel');
  assert.deepEqual(boxes.filter((b) => b.checked).map((b) => b.value), ['Mud', 'Sand', 'Gravel']);

  // Gravel off, Cobble on, saved.
  boxes.find((b) => b.value === 'Gravel').checked = false;
  boxes.find((b) => b.value === 'Cobble').checked = true;
  detail.querySelector('[data-never-together-save="500"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saved, [[500, [['Mud', 'Sand', 'Cobble']]]]);
});
