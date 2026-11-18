import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { at, STATIONS, TUNNEL, CROSSINGS, TRACK_GAP, TRAIN_LEN, fmtTime, curvatureAt, SIGNALS } from './route';
import {
  createSim, step, stepNotch, setNotch, toggleDoor, pointCall, announce, horn, kmh, currentLimit, notchLabel, EB,
  aspectOf, Sim, Mode, legTotal, totalScore, rank, SimEvent,
} from './sim';
import { buildTerrain } from './world/terrain';
import { buildTrack, updateSignal, TrackWorld } from './world/track';
import { buildScenery, Scenery } from './world/scenery';
import { buildWater } from './world/water';
import { setAniso, texturesReady, tex } from './world/assets';
import { buildCab, Cab } from './cab';
import { makeTrain, TrainView } from './train';
import { buildPost, Post } from './post';
import { Governor, LEVELS, startLevel } from './perf';
import { Sound } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

// ---- 描画の土台 ----
const canvas = $<HTMLCanvasElement>('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 9000);
const skyTex = tex('tex/sky.jpg', true);
skyTex.mapping = THREE.EquirectangularReflectionMapping;
skyTex.wrapS = THREE.ClampToEdgeWrapping; skyTex.repeat.set(1, 1);
scene.background = skyTex;
scene.backgroundIntensity = 1.25;
scene.fog = new THREE.FogExp2(0xaebdcc, 0.00022);
const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x4a5236, 0.35);
scene.add(hemi);

const SUN_DIR = new THREE.Vector3(-0.55, -0.75, 0.35).normalize();
const csm = new CSM({
  maxFar: 700, cascades: 3, mode: 'practical', parent: scene, shadowMapSize: 2048,
  lightDirection: SUN_DIR, camera, lightIntensity: 3.2, lightNear: 1, lightFar: 3000, lightMargin: 120,
});
csm.fade = true;
for (const l of csm.lights) { l.color.set(0xfff1df); l.shadow.bias = -0.0002; l.shadow.normalBias = 0.04; }

const world = new THREE.Group();
scene.add(world);
const uTime = { value: 0 };

let track!: TrackWorld, scenery!: Scenery, cab!: Cab, post!: Post;
let myTrain!: TrainView;
const others: { view: TrainView; s: number; v: number; passed: boolean }[] = [];
const sound = new Sound();

/** すべての材質に、遠くまでの細かい影（CSM）と独自の手直しをつなぐ */
function finalize(root: THREE.Object3D) {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) {
      if (seen.has(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || mat.userData.done) continue;
      seen.add(mat);
      mat.userData.done = true;
      csm.setupMaterial(mat);
      const csmHook = mat.onBeforeCompile;
      const patch = mat.userData.patch as ((sh: THREE.WebGLProgramParametersWithUniforms) => void) | undefined;
      mat.onBeforeCompile = (sh, r) => { csmHook.call(mat, sh, r); patch?.(sh); };
      const key = (mat.userData.key as string) ?? (patch ? 'terrain' : 'std');
      mat.customProgramCacheKey = () => key;
    }
  });
}

async function build(progress: (p: string) => void) {
  progress('地形');
  await tick();
  const terrainMat = buildTerrain(world);
  terrainMat.userData.key = 'terrain';
  progress('線路と駅');
  await tick();
  track = buildTrack(world, {});
  progress('海と川');
  buildWater(world, uTime);
  progress('木と草');
  await tick();
  scenery = await buildScenery(world, renderer);
  myTrain = makeTrain();
  scene.add(myTrain.group);
  cab = buildCab();
  rig.add(cab.group);
  cab.group.position.set(-0.5, 2.75, 0);
  finalize(scene);
  progress('素材');
  await Promise.race([texturesReady(), new Promise((r) => setTimeout(r, 15000))]);
  await document.fonts.ready;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- カメラの台（車体の動き） ----
const rig = new THREE.Object3D();
scene.add(rig);
rig.add(camera);
camera.position.set(-0.5, 2.75, 0);
let view: 'cab' | 'ext' = params.get('view') === 'ext' ? 'ext' : 'cab';
let lookYaw = 0, lookPitch = -0.15, extYaw = 2.5, extPitch = 0.18, extDist = 34;
let bump = 0, lastJoint = 0;

function placeRig(sim: Sim, dt: number) {
  const s = sim.s - 1.4;
  const f = at(s);
  const fa = at(s - 6), fb = at(s + 6);
  const yaw = Math.atan2(-(fb.x - fa.x), -(fb.z - fa.z));
  const pitch = Math.atan2(fb.y - fa.y, 12) - sim.a * 0.0035;
  const k = curvatureAt(s);
  const v = sim.v;
  const t = sim.t;
  // 継ぎ目の揺れ（25 m ごと）
  if (Math.floor(sim.s / 25) !== lastJoint) { lastJoint = Math.floor(sim.s / 25); bump = Math.min(1, v / 20); sound.joint(v); }
  bump *= Math.exp(-dt * 7);
  const vib = (Math.sin(t * 13.1 + s * 0.7) * 0.5 + Math.sin(t * 23.7) * 0.3) * 0.0025 * Math.min(1, v / 15);
  const sway = Math.sin(t * 1.05 + s * 0.013) * 0.012 * Math.min(1, v / 20);
  const roll = k * 26 + Math.sin(t * 0.8 + s * 0.02) * 0.004 * Math.min(1, v / 20) + sim.a * 0.0;
  rig.position.set(f.x, f.y + vib + bump * 0.006 * Math.sin(t * 40), f.z);
  rig.rotation.order = 'YXZ';
  rig.rotation.set(pitch, yaw, roll + sway * 0.3);
  rig.position.x += Math.cos(yaw) * sway; rig.position.z -= Math.sin(yaw) * sway;
}

function placeCamera() {
  if (view === 'cab') {
    camera.position.set(-0.5, 2.75, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(lookPitch, lookYaw, 0);
    camera.fov = 62;
  } else {
    // 外から：先頭車のまわりを回る
    camera.position.set(Math.sin(extYaw) * extDist, 3 + Math.sin(extPitch) * extDist, Math.cos(extYaw) * extDist - 10);
    rig.updateMatrixWorld(true);
    camera.lookAt(rig.localToWorld(new THREE.Vector3(0, 2.4, -10)));
    camera.fov = 50;
  }
  camera.updateProjectionMatrix();
}

// ---- 入力 ----
let sim: Sim = createSim('easy');
let running = false, paused = false, wipers = false;
const keys = new Set<string>();

function act(a: string) {
  if (!running || sim.finished) return;
  sound.start();
  switch (a) {
    case 'door': toggleDoor(sim); break;
    case 'call': pointCall(sim); break;
    case 'announce': announce(sim); break;
    case 'horn': horn(sim); break;
    case 'wiper': wipers = !wipers; break;
    case 'view': view = view === 'cab' ? 'ext' : 'cab'; break;
    case 'eb': setNotch(sim, EB); break;
    case 'help': openHelp(); break;
  }
}
addEventListener('keydown', (e) => {
  if (e.repeat && !['KeyZ', 'KeyX'].includes(e.code)) return;
  keys.add(e.code);
  if (!running) return;
  const map: Record<string, () => void> = {
    KeyZ: () => stepNotch(sim, 1), KeyX: () => stepNotch(sim, -1), KeyN: () => setNotch(sim, 0),
    Space: () => act('eb'), KeyO: () => act('door'), KeyK: () => act('call'), KeyA: () => act('announce'),
    KeyF: () => toggleFps(), KeyH: () => act('horn'), KeyC: () => act('view'), KeyW: () => act('wiper'), KeyM: () => sound.setMute(!sound.muted),
    Slash: () => act('help'), Escape: () => (paused ? closeHelp() : openHelp()),
  };
  const f = map[e.code];
  if (f) { e.preventDefault(); sound.start(); f(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
document.querySelectorAll<HTMLButtonElement>('#btns button').forEach((b) => b.addEventListener('click', () => act(b.dataset.act!)));

// 見回し（ドラッグ）
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); sound.start(); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (view === 'cab') {
    lookYaw = Math.max(-1.3, Math.min(1.3, lookYaw - dx * 0.004));
    lookPitch = Math.max(-0.9, Math.min(0.4, lookPitch - dy * 0.004));
  } else {
    extYaw -= dx * 0.006; extPitch = Math.max(0.02, Math.min(1.2, extPitch + dy * 0.004));
  }
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { if (view === 'ext') extDist = Math.max(12, Math.min(90, extDist + e.deltaY * 0.03)); }, { passive: true });
canvas.addEventListener('dblclick', () => { lookYaw = 0; lookPitch = -0.15; });

// マスコンのレバー（指で上下）
const lever = $('lever'), knob = $('knob');
function notchFromY(y: number) {
  const r = lever.getBoundingClientRect();
  const u = Math.max(0, Math.min(1, (y - r.top) / r.height));
  return 5 - Math.round(u * 14);
}
let leverDrag = false;
lever.addEventListener('pointerdown', (e) => { leverDrag = true; lever.setPointerCapture(e.pointerId); sound.start(); if (running) setNotch(sim, notchFromY(e.clientY)); });
lever.addEventListener('pointermove', (e) => { if (leverDrag && running) setNotch(sim, notchFromY(e.clientY)); });
lever.addEventListener('pointerup', () => { leverDrag = false; });
lever.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') { stepNotch(sim, 1); e.preventDefault(); }
  if (e.key === 'ArrowDown') { stepNotch(sim, -1); e.preventDefault(); }
});

// ---- 画面の表示 ----
let toastT = 0, subT = 0, cardT = 0;
function toast(text: string, pts = 0) {
  const el = $('toast');
  el.innerHTML = '';
  el.append(text);
  if (pts > 0) { const p = document.createElement('span'); p.className = 'pts'; p.textContent = `+${pts}`; el.append(p); }
  el.classList.add('show'); toastT = 1.8;
}
function subtitle(text: string) { const el = $('sub'); el.textContent = text; el.classList.add('show'); subT = 4.5; }
function stopCard(i: number) {
  const st = STATIONS[i];
  const leg = sim.leg.station === i ? sim.leg : sim.legs.find((l) => l.station === i);
  if (!leg) return;
  const el = $('stopcard');
  const pe = leg.posErr ?? 0, ae = leg.arrErr ?? 0;
  const word = Math.abs(pe) <= 0.5 ? 'ぴったり！' : Math.abs(pe) <= 2 ? 'おしい！' : pe > 0 ? '行き過ぎ' : '手前で停止';
  el.innerHTML = `<h3>${st.name}・${word}</h3><div class="grid">
    <span>停止位置</span><b class="mono">${pe >= 0 ? '+' : ''}${pe.toFixed(2)} m　${leg.pos} 点</b>
    <span>到着時刻</span><b class="mono">${ae >= 0 ? '+' : ''}${ae.toFixed(0)} 秒　${leg.time} 点</b>
    <span>乗り心地</span><b class="mono">${Math.round(leg.comfort)} 点</b></div>`;
  el.hidden = false; cardT = 6;
}

function handleEvents(evs: SimEvent[]) {
  for (const e of evs) {
    switch (e.type) {
      case 'call': toast(e.text!, e.value); sound.tone(660, 0.12, 'sine', 0.08); break;
      case 'announce': subtitle(`車内放送：${e.text}`); if (e.value) toast('車内放送', e.value); sound.chime(); break;
      case 'horn': sound.horn(); if (e.value) toast(e.text!, e.value); break;
      case 'msg': subtitle(e.text!); break;
      case 'door-open': sound.doorChime(); sound.hiss(); break;
      case 'door-close': sound.doorChime(); break;
      case 'arrive': sound.hiss(); subtitle(`${e.text} に到着。O でドアを開けます`); break;
      case 'stop-result': stopCard(e.value!); break;
      case 'depart': if (e.value! > 5) subtitle(`${Math.round(e.value!)} 秒遅れで発車`); break;
      case 'ats-warn': sound.atsBell(true); break;
      case 'ats-off': case 'ats-release': sound.atsBell(false); break;
      case 'ats-brake': sound.atsBell(true); toast(`ATS：${e.text}`); break;
      case 'overrun': subtitle(`${e.text} を通過してしまいました`); break;
      case 'jolt': subtitle('停止時の衝撃が大きかった'); break;
      case 'finish': setTimeout(showResult, 2500); break;
    }
  }
  evs.length = 0;
}

let melodyPlayed = -1;
function updateHud() {
  $('clock').textContent = fmtTime(sim.t);
  const at0 = sim.at >= 0;
  const st = STATIONS[Math.min(STATIONS.length - 1, at0 ? sim.at : sim.next)];
  $('nextK').textContent = at0 ? '停車中' : '次は';
  $('nextSt').textContent = st.name;
  $('nextT').textContent = at0 ? `発 ${fmtTime(st.dep)}` : `着 ${fmtTime(st.arr)}`;
  const dist = at0 ? null : STATIONS[sim.next].stop - sim.s;
  $('dist').textContent = dist === null ? '---' : dist > 999 ? `${(dist / 1000).toFixed(2)} km` : `${dist.toFixed(dist < 50 ? 1 : 0)} m`;
  $('speed').textContent = String(Math.round(kmh(sim.v)));
  $('limit').textContent = String(currentLimit(sim));
  const n = $('notch');
  n.textContent = notchLabel(sim.notch);
  n.className = 'mono ' + (sim.notch === EB ? 'eb' : sim.notch > 0 ? 'p' : sim.notch < 0 ? 'b' : '');
  knob.textContent = notchLabel(sim.notch);
  knob.style.top = `calc(${((5 - (sim.notch === EB ? -9 : sim.notch)) / 14) * 100}% - ${((5 - (sim.notch === EB ? -9 : sim.notch)) / 14) * 34}px)`;
  lever.setAttribute('aria-valuenow', String(sim.notch));
  const d = $('door');
  d.textContent = sim.door === 'closed' ? '戸閉 ●' : sim.door === 'open' ? 'ドア 開' : 'ドア 動作中';
  d.className = sim.door === 'closed' ? 'closed' : '';
  $('ats').hidden = sim.ats === 'off';
  $('ats').textContent = sim.ats === 'brake' ? 'ATS ブレーキ' : 'ATS 警報';
  $('score').textContent = `${totalScore(sim) + (sim.finished ? 0 : Math.round(sim.leg.bonus - sim.leg.penalty))} 点`;
  // 発車メロディ：発車 25 秒前、ドアが開いているとき
  if (at0 && sim.door === 'open' && sim.t > st.dep - 25 && melodyPlayed !== sim.at && sim.at < STATIONS.length - 1) {
    melodyPlayed = sim.at; sound.melody(); subtitle('発車メロディ。発車時刻が近づいたら O でドアを閉めます');
  }
}

function showResult() {
  running = false;
  sound.atsBell(false);
  const el = $('result');
  const rows = sim.legs.map((l) => {
    const st = STATIONS[l.station];
    return `<tr><td>${st.name}</td><td class="mono">${l.posErr === null ? '—' : (l.posErr >= 0 ? '+' : '') + l.posErr.toFixed(2) + ' m'}</td>
      <td class="mono">${l.arrErr === null ? '—' : (l.arrErr >= 0 ? '+' : '') + l.arrErr.toFixed(0) + ' 秒'}</td>
      <td class="mono">${Math.round(l.comfort)}</td><td class="mono">+${Math.round(l.bonus)}</td><td class="mono">−${Math.round(l.penalty)}</td><td class="mono"><b>${legTotal(l)}</b></td></tr>`;
  }).join('');
  const notes = [...new Set(sim.legs.flatMap((l) => l.notes))];
  el.innerHTML = `<div class="card">
    <p class="eyebrow">運転の結果　潮見台 → 山ノ口</p>
    <div style="display:flex;gap:20px;align-items:center"><span class="rank">${rank(sim)}</span><div><h2>${totalScore(sim)} 点</h2><span class="dim">満点 ${(STATIONS.length - 1) * 100}（加点で超えることがあります）</span></div></div>
    <div style="overflow-x:auto"><table><thead><tr><th>駅</th><th>停止位置</th><th>到着</th><th>乗り心地</th><th>加点</th><th>減点</th><th>合計</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${notes.length ? `<p class="dim">気をつけたいこと：${notes.join('・')}</p>` : '<p class="dim">安全運転でした。</p>'}
    <button class="primary" id="again">もう一度運転する</button></div>`;
  el.hidden = false;
  $('again').addEventListener('click', () => { el.hidden = true; startRun(); });
}

function openHelp() { paused = true; $('help').hidden = false; }
function closeHelp() { paused = false; $('help').hidden = true; }
$('help').querySelector('[data-close]')!.addEventListener('click', closeHelp);
$('fpsBtn').addEventListener('click', () => toggleFps());

function startRun() {
  const mode = (document.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'easy') as Mode;
  sim = createSim(mode);
  const s0 = Number(params.get('s'));
  if (s0 > 0) { sim.s = s0; sim.at = -1; sim.served = false; sim.door = 'closed'; sim.notch = 0; sim.v = Number(params.get('v') ?? 60) / 3.6; sim.next = STATIONS.findIndex((st) => st.stop > s0 + 1); sim.passedSig = SIGNALS.filter((x) => x.s <= s0).length; sim.t = STATIONS[Math.max(0, sim.next - 1)].dep + 30; }
  others.length = 0;
  spawned.clear();
  melodyPlayed = -1;
  running = true; paused = false;
  $('hud').hidden = false;
  $('title').hidden = true;
  subtitle('潮見台・発車 07:00:45。発車メロディのあと、O でドアを閉めます');
}

// すれ違う列車
const spawned = new Set<number>();
const SPAWN_AT = [700, 2700, 4950];
function updateOthers(dt: number) {
  for (const s of SPAWN_AT) {
    if (!spawned.has(s) && sim.s > s && sim.s < s + 300) {
      spawned.add(s);
      const view = makeTrain();
      scene.add(view.group);
      finalize(view.group);
      others.push({ view, s: Math.min(sim.s + 1300, 5700), v: 21, passed: false });
    }
  }
  for (const o of others) {
    o.s -= o.v * dt;
    o.view.place(o.s, TRACK_GAP, true);
    const rel = o.s - sim.s;
    if (!o.passed && rel < 15) { o.passed = true; if (view === 'cab') sound.whoosh(); }
    o.view.group.visible = o.s > -250;
  }
}

function updateCrossings(time: number, camPos: THREE.Vector3): number {
  let vol = 0;
  track.crossings.forEach((c, i) => {
    const mine = sim.s > c.s - 420 && sim.s - TRAIN_LEN < c.s + 4;
    const other = others.some((o) => o.s < c.s + 420 && o.s + TRAIN_LEN > c.s - 4);
    const active = mine || other;
    for (const arm of c.arms) arm.rotation.x += ((active ? 0 : Math.PI / 2 * 0.96) - arm.rotation.x) * 0.04;
    const ph = Math.floor(time * 1.6) % 2;
    c.lights.forEach((pair) => pair.forEach((m, k) => { m.emissiveIntensity = active && k === ph ? 7 : 0; }));
    if (active) { const f = at(CROSSINGS[i].s); vol = Math.max(vol, 1 - Math.min(1, Math.hypot(f.x - camPos.x, f.z - camPos.z) / 500)); }
  });
  return vol;
}

// ---- メインループ ----
let exposure = 1;
const clock = new THREE.Clock();
const camPos = new THREE.Vector3();
let frame = 0;
function loop(now = performance.now()) {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  const dt = Math.min(0.1, clock.getDelta());
  uTime.value += dt;
  if (running && !paused) {
    const sub = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < sub; i++) step(sim, dt / sub);
    // キーを押し続けると段を進める
    handleEvents(sim.events);
    updateOthers(dt);
  }
  placeRig(sim, running && !paused ? dt : 0);
  placeCamera();
  rig.updateMatrixWorld(true);
  camera.getWorldPosition(camPos);
  // 信号
  for (const sv of track.signals) updateSignal(sv, aspectOf(sv.sig, sim));
  const crossVol = updateCrossings(uTime.value, camPos);
  sound.tick(dt, crossVol);
  const inTunnel = sim.s - 1.4 > TUNNEL.from + 5 && sim.s - 1.4 < TUNNEL.to - 5;
  sound.update(sim.v, sim.power, sim.brake, inTunnel);
  // トンネルでは目が慣れるように明るさを変える
  const targetExp = inTunnel && view === 'cab' ? 2.4 : 1.0;
  exposure += (targetExp - exposure) * Math.min(1, dt * (targetExp > exposure ? 0.9 : 1.6));
  renderer.toneMappingExposure = exposure;
  const envK = inTunnel && view === 'cab' ? 0.12 : 1;
  scene.environmentIntensity += (envK - scene.environmentIntensity) * Math.min(1, dt * 2);
  hemi.intensity = 0.35 * scene.environmentIntensity;
  // 自分の列車（外からの視点のときだけ見せる）
  myTrain.group.visible = view === 'ext';
  cab.group.visible = view === 'cab';
  if (view === 'ext') myTrain.place(sim.s, 0);
  cab.update(sim, dt, { wipers, guide: sim.mode === 'easy', dist: sim.at >= 0 ? null : STATIONS[sim.next].stop - sim.s });
  const L = LEVELS[gov.level];
  scenery.update(camPos, L);
  for (const im of track.sleepers) im.visible = im.boundingSphere!.center.distanceTo(camPos) < 450;
  post.grade.uniforms.uSpeed.value = view === 'cab' ? Math.min(1, Math.max(0, (sim.v - 8) / 20)) : 0;
  if (running) updateHud();
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('show');
  if (subT > 0 && (subT -= dt) <= 0) $('sub').classList.remove('show');
  if (cardT > 0 && (cardT -= dt) <= 0) $('stopcard').hidden = true;
  csm.update();
  // いちばん遠い段の影は 2 コマに 1 回だけ描き直す
  const farLight = csm.lights[csm.lights.length - 1];
  farLight.shadow.autoUpdate = false;
  farLight.shadow.needsUpdate = frame % 2 === 0;
  renderer.info.reset();
  post.composer.render(dt);
  frame++;
  const js = performance.now() - t0;
  jsAvg += (js - jsAvg) * 0.05;
  // 自動調整：実際のコマの間隔で判断する
  const changed = gov.frame(now - lastNow);
  lastNow = now;
  if (changed !== null) applyLevel(changed);
  if (showFps && frame % 15 === 0) fpsEl.textContent = `${Math.round(gov.fps)} FPS・画質 ${LEVELS.length - gov.level}/${LEVELS.length}${gov.auto ? '（自動）' : ''}`;
  (window as unknown as { __ts: unknown }).__ts = { sim, frame, ready: true, view, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, js: Math.round(jsAvg * 10) / 10, level: gov.level };
}

// ---- 画質の段 ----
let gov = new Governor(startLevel(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height)));
let lastNow = performance.now(), jsAvg = 0;
let showFps = params.has('fps');
const fpsEl = $('fps');
fpsEl.hidden = !showFps;
function toggleFps() { showFps = !showFps; fpsEl.hidden = !showFps; }
function applyLevel(n: number) {
  const L = LEVELS[n];
  renderer.setPixelRatio(Math.min(devicePixelRatio, L.dpr));
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  post.setLevel(L);
  for (const l of csm.lights) {
    if (l.shadow.mapSize.x !== L.shadowSize) {
      l.shadow.mapSize.set(L.shadowSize, L.shadowSize);
      l.shadow.map?.dispose();
      (l.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }
  if (csm.maxFar !== L.shadowFar) { csm.maxFar = L.shadowFar; csm.updateFrustums(); }
}
function chooseQuality(q: string) {
  const start = startLevel(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height));
  gov = q === 'high' ? new Governor(0, false) : q === 'low' ? new Governor(3, false) : new Governor(start, true);
  applyLevel(gov.level);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight);
  csm.updateFrustums();
});

(async function main() {
  const pct = $('loadPct');
  const pmrem = new THREE.PMREMGenerator(renderer);
  await new Promise<void>((res) => { const im = new Image(); im.onload = () => res(); im.onerror = () => res(); im.src = 'tex/sky.jpg'; });
  await build((p) => { pct.textContent = p; });
  scene.environment = pmrem.fromEquirectangular(skyTex).texture;
  scene.environmentIntensity = 1;
  post = buildPost(renderer, scene, camera);
  chooseQuality(params.get('q') ?? 'auto');
  const reb = () => chooseQuality(document.querySelector<HTMLInputElement>('input[name=q]:checked')?.value ?? 'auto');
  $('loading').remove();
  const btn = $<HTMLButtonElement>('startBtn');
  btn.disabled = false; btn.textContent = '運転をはじめる';
  btn.addEventListener('click', () => { sound.start(); reb(); startRun(); });
  if (params.has('auto')) startRun();
  placeRig(sim, 0);
  loop();
})();
