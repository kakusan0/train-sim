// 運転台：窓枠・机・計器（速度計・ブレーキ圧力計・運転情報の画面）・マスコン・ワイパー
import * as THREE from 'three';
import { pbr, tex } from './world/assets';
import { Sim, kmh, notchLabel, EB, currentLimit, brakingDistance } from './sim';
import { STATIONS, fmtTime } from './route';

export interface Cab {
  group: THREE.Group;
  update(sim: Sim, dt: number, opts: { wipers: boolean; guide: boolean; dist: number | null }): void;
}

const W = 1600, H = 520;

export function buildCab(): Cab {
  const g = new THREE.Group();
  const paint = pbr('painted_plaster_wall', { color: 0xc6cec6, roughness: 0.8 });
  const deskM = new THREE.MeshStandardMaterial({ color: 0x5f6c72, metalness: 0.15, roughness: 0.58 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x2a3034, roughness: 0.55, metalness: 0.2 });
  const frameM = new THREE.MeshStandardMaterial({ color: 0x8f9a92, metalness: 0.1, roughness: 0.6 });
  const ceilM = new THREE.MeshStandardMaterial({ color: 0xd9ddd6, roughness: 0.85 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1, roughness: 0.22 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 });
  const parts: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, cast = true) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = cast; mesh.receiveShadow = true; g.add(mesh); parts.push(mesh); return mesh; };

  // 車体中心はカメラから右へ 0.5 m。幅 2.84 m
  const L = -0.92, R = 1.92, FZ = -1.12;
  // 前面の壁（窓の穴 2 つ）
  const wall = new THREE.Shape();
  wall.moveTo(L, -1.7); wall.lineTo(R, -1.7); wall.lineTo(R, 1.0); wall.lineTo(L, 1.0); wall.closePath();
  const hole = (x0: number, x1: number, y0: number, y1: number, rr: number) => {
    const p = new THREE.Path();
    p.moveTo(x0 + rr, y0); p.lineTo(x1 - rr, y0); p.quadraticCurveTo(x1, y0, x1, y0 + rr); p.lineTo(x1, y1 - rr);
    p.quadraticCurveTo(x1, y1, x1 - rr, y1); p.lineTo(x0 + rr, y1); p.quadraticCurveTo(x0, y1, x0, y1 - rr); p.lineTo(x0, y0 + rr);
    p.quadraticCurveTo(x0, y0, x0 + rr, y0);
    return p;
  };
  wall.holes.push(hole(-0.8, 0.86, -0.4, 0.64, 0.07), hole(0.98, 1.84, -0.4, 0.64, 0.07));
  const wg = new THREE.ExtrudeGeometry(wall, { depth: 0.09, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
  wg.translate(0, 0, -0.045);
  const front = add(wg, frameM);
  front.position.z = FZ; front.rotation.x = -0.08;
  // 窓のゴム
  for (const [x0, x1] of [[-0.8, 0.86], [0.98, 1.84]]) {
    const sh = new THREE.Shape(); const outer = hole(x0 - 0.02, x1 + 0.02, -0.42, 0.66, 0.08);
    sh.curves = outer.curves; sh.currentPoint = outer.currentPoint;
    sh.holes.push(hole(x0 + 0.01, x1 - 0.01, -0.39, 0.63, 0.06));
    const rg = new THREE.ShapeGeometry(sh, 8); const m = add(rg, rubber, false); m.position.z = FZ + 0.05; m.rotation.x = -0.08;
  }
  // ガラス（うっすら汚れと映り込み）
  const dirt = makeDirt();
  const glassM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: dirt, transparent: true, opacity: 1, roughness: 0.12, metalness: 0.0, depthWrite: false, envMapIntensity: 0.35 });
  for (const [x0, x1] of [[-0.8, 0.86], [0.98, 1.84]]) {
    const pg = new THREE.PlaneGeometry(x1 - x0, 1.04); pg.translate((x0 + x1) / 2, 0.12, 0);
    const m = new THREE.Mesh(pg, glassM); m.position.z = FZ - 0.03; m.rotation.x = -0.08; m.renderOrder = 5; g.add(m);
  }
  // 天井・側壁
  add(new THREE.BoxGeometry(R - L, 0.06, 1.9).translate((L + R) / 2, 1.0, -0.2), ceilM);
  const side = new THREE.Shape();
  side.moveTo(-1.6, -1.7); side.lineTo(0.8, -1.7); side.lineTo(0.8, 1.0); side.lineTo(-1.6, 1.0); side.closePath();
  side.holes.push(hole(-1.0, -0.15, -0.22, 0.58, 0.06));
  const sg = new THREE.ExtrudeGeometry(side, { depth: 0.06, bevelEnabled: false });
  sg.rotateY(Math.PI / 2);
  const sl = add(sg, paint); sl.position.x = L - 0.06;
  const sr = add(sg.clone(), paint); sr.position.x = R + 0.06;
  // 側窓のガラス
  const sgl = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.8), glassM); sgl.rotation.y = Math.PI / 2; sgl.position.set(L - 0.03, 0.18, -0.575); g.add(sgl);
  // 日よけ
  const visor = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), new THREE.MeshStandardMaterial({ color: 0x223322, transparent: true, opacity: 0.55, roughness: 0.3, side: THREE.DoubleSide }));
  visor.position.set(-0.05, 0.6, -1.0); visor.rotation.x = 0.35; g.add(visor);
  add(new THREE.BoxGeometry(0.95, 0.03, 0.03).translate(-0.05, 0.74, -1.04), chrome, false);

  // 机（前が高く、手前に向かって下がる）
  const desk = new THREE.Shape();
  desk.moveTo(FZ - 0.05, -0.4); desk.lineTo(-0.62, -0.62); desk.quadraticCurveTo(-0.52, -0.64, -0.5, -0.7); desk.lineTo(-0.5, -1.7); desk.lineTo(FZ - 0.05, -1.7); desk.closePath();
  const dg = new THREE.ExtrudeGeometry(desk, { depth: R - L, bevelEnabled: false });
  dg.rotateY(-Math.PI / 2); // 形の x → -z、押し出し → x
  dg.translate(R, 0, 0);
  // 回転で x が -z へ。位置を合わせる
  add(dg, deskM);

  // 計器の台（運転士の正面、こちらを向く）
  const pg = new THREE.Group(); pg.position.set(0.02, -0.455, -0.95); pg.rotation.x = -0.62; g.add(pg);
  const PW = 1.17, PH = PW * H / W;
  const hm = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.06, PH + 0.06, 0.1), darkM); hm.position.z = -0.051; hm.castShadow = true; hm.receiveShadow = true; pg.add(hm);
  // 計器盤の絵（キャンバス）
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const ptex = new THREE.CanvasTexture(cv); ptex.colorSpace = THREE.SRGBColorSpace; ptex.anisotropy = 8;
  const pm = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.35, metalness: 0.0, emissive: 0xffffff, emissiveMap: ptex, emissiveIntensity: 0.22 });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), pm);
  panel.position.z = 0.001; pg.add(panel);
  // 計器のふち（金属の輪）
  const ringAt = (cx: number, cy: number, r: number) => {
    const u = (cx / W - 0.5) * PW, v = (0.5 - cy / H) * PH;
    const ring = new THREE.Mesh(new THREE.TorusGeometry((r / W) * PW, 0.007, 8, 48), chrome);
    ring.position.set(u, v, 0.006); panel.add(ring);
  };
  ringAt(250, 250, 215); ringAt(640, 250, 170);
  // 画面のふち
  const bez = new THREE.Mesh(new THREE.BoxGeometry((720 / W) * PW, (440 / H) * PH, 0.02), darkM);
  bez.position.set(((860 + 350) / W - 0.5) * PW, (0.5 - 250 / H) * PH, -0.013); pg.add(bez);

  // マスコン（ワンハンドル）
  const mc = new THREE.Group(); mc.position.set(-0.62, -0.6, -0.72); g.add(mc);
  const baseG = new THREE.BoxGeometry(0.2, 0.08, 0.42); const base = new THREE.Mesh(baseG, darkM); base.castShadow = true; mc.add(base);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.36), new THREE.MeshStandardMaterial({ color: 0x050505 })); slot.position.y = 0.041; mc.add(slot);
  // 段の目盛り
  const scale = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.36), new THREE.MeshStandardMaterial({ map: notchScale(), roughness: 0.5 }));
  scale.rotation.x = -Math.PI / 2; scale.position.set(0.065, 0.042, 0); mc.add(scale);
  const lever = new THREE.Group(); lever.position.y = -0.02; mc.add(lever);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.24, 12), chrome); shaft.position.y = 0.12; lever.add(shaft);
  const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.16, 6, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.45 }));
  grip.rotation.z = Math.PI / 2; grip.position.y = 0.245; lever.add(grip);
  lever.traverse((o) => { o.castShadow = true; });

  // 警笛のペダル・非常ボタンなど小物
  const ebBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.4 }));
  ebBtn.position.set(0.72, -0.58, -0.75); ebBtn.rotation.x = -0.4; g.add(ebBtn);
  const sw: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) sw.push(new THREE.BoxGeometry(0.03, 0.02, 0.05).translate(0.85 + i * 0.07, -0.6, -0.78));
  for (const s of sw) { const m = new THREE.Mesh(s, chrome); m.rotation.x = -0.4; g.add(m); }

  // ワイパー（窓の外、下の中ほどを軸に）
  const wipers: THREE.Group[] = [];
  for (const [px, len] of [[0.05, 0.85], [1.42, 0.62]]) {
    const piv = new THREE.Group(); piv.position.set(px, -0.36, FZ - 0.07); piv.rotation.x = -0.08; g.add(piv);
    const arm = new THREE.Group(); piv.add(arm);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.018, len, 0.012), darkM); a.position.y = len / 2; arm.add(a);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, len * 0.85, 0.02), rubber); blade.position.set(0.012, len * 0.55, -0.01); arm.add(blade);
    arm.rotation.z = 1.5;
    wipers.push(arm);
  }
  // 運転士の手もと灯
  const lamp = new THREE.PointLight(0xfff0dc, 1.2, 4, 1.5); lamp.position.set(0.4, 0.85, -0.2); g.add(lamp);
  // 窓から入る光のはね返り：運転台の材質は空の光を強めに受ける
  for (const m of [paint, deskM, darkM, frameM, ceilM, chrome]) m.envMapIntensity = 2.2;
  void tex;

  let wipeT = 0, blink = 0;
  let last = -1;
  const update: Cab['update'] = (sim, dt, opts) => {
    // レバーの角度
    const n = sim.notch;
    const target = n === EB ? -0.75 : n > 0 ? n * 0.11 : n * 0.075;
    lever.rotation.x += (target - lever.rotation.x) * Math.min(1, dt * 14);
    // ワイパー
    if (opts.wipers || wipeT % (Math.PI * 2) > 0.05) {
      wipeT += dt * 3.2;
      const ph = Math.sin(wipeT);
      wipers.forEach((w) => { w.rotation.z = 1.5 * (0.5 + 0.5 * Math.cos(wipeT)) - (1 - (0.5 + 0.5 * Math.cos(wipeT))) * 0.15; void ph; });
      if (!opts.wipers && Math.cos(wipeT) > 0.995) wipeT = 0;
    }
    blink += dt;
    // 計器盤は 1 秒に 30 回まで描き直す
    if (blink - last < 1 / 30) return;
    last = blink;
    drawPanel(ctx, sim, opts, blink);
    ptex.needsUpdate = true;
  };
  return { group: g, update };
}

function notchScale(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 384;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#222'; c.fillRect(0, 0, 64, 384);
  const labels = ['非', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', 'N', 'P1', 'P2', 'P3', 'P4', 'P5'];
  labels.forEach((l, i) => {
    const y = 14 + i * 25.5;
    c.fillStyle = l.startsWith('P') ? '#4CD98A' : l === 'N' ? '#eee' : l === '非' ? '#FF5A4E' : '#FFB347';
    c.font = '700 16px "Share Tech Mono", monospace'; c.textBaseline = 'middle'; c.fillText(l, 6, y);
  });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeDirt(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 512, 512);
  // 下の方にたまったほこり、ところどころの点
  const grd = c.createLinearGradient(0, 512, 0, 300);
  grd.addColorStop(0, 'rgba(120,110,95,0.22)'); grd.addColorStop(1, 'rgba(120,110,95,0.0)');
  c.fillStyle = grd; c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = Math.random() * 1.8 + 0.3;
    c.fillStyle = `rgba(200,195,180,${0.04 + Math.random() * 0.08})`;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  // ワイパーのふいた跡の弧
  c.strokeStyle = 'rgba(160,150,135,0.06)'; c.lineWidth = 3;
  for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(256, 560, 380 + k * 14, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function drawPanel(c: CanvasRenderingContext2D, sim: Sim, opts: { guide: boolean; dist: number | null }, time: number) {
  c.fillStyle = '#121518'; c.fillRect(0, 0, W, H);
  // ---- 速度計 ----
  const cx = 250, cy = 250, R = 205;
  c.fillStyle = '#0A0D14'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25, MAXV = 120;
  const ang = (v: number) => A0 + (A1 - A0) * (v / MAXV);
  const lim = currentLimit(sim);
  c.lineWidth = 14; c.strokeStyle = '#FF5A4E'; c.beginPath(); c.arc(cx, cy, R - 18, ang(lim), ang(MAXV)); c.stroke();
  c.strokeStyle = '#E8ECF5'; c.fillStyle = '#E8ECF5';
  c.font = '700 30px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let v = 0; v <= MAXV; v += 5) {
    const a = ang(v), big = v % 10 === 0;
    c.lineWidth = big ? 5 : 2.5;
    c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30)); c.lineTo(cx + Math.cos(a) * (R - (big ? 58 : 46)), cy + Math.sin(a) * (R - (big ? 58 : 46))); c.stroke();
    if (v % 20 === 0) c.fillText(String(v), cx + Math.cos(a) * (R - 88), cy + Math.sin(a) * (R - 88));
  }
  const sp = kmh(sim.v);
  const a = ang(Math.min(MAXV, sp));
  c.strokeStyle = '#FFB347'; c.lineWidth = 9; c.lineCap = 'round';
  c.beginPath(); c.moveTo(cx - Math.cos(a) * 22, cy - Math.sin(a) * 22); c.lineTo(cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40)); c.stroke();
  c.fillStyle = '#FFB347'; c.beginPath(); c.arc(cx, cy, 18, 0, Math.PI * 2); c.fill();
  c.font = '700 64px "Share Tech Mono", monospace'; c.fillText(String(Math.round(sp)), cx, cy + 110);
  c.font = '700 22px "Share Tech Mono", monospace'; c.fillStyle = '#A9B2C8'; c.fillText('km/h', cx, cy + 152);
  // ---- ブレーキ圧力計（BC 赤・MR 黒） ----
  const bx = 640, by = 250, BR = 160;
  c.fillStyle = '#F2F0E8'; c.beginPath(); c.arc(bx, by, BR, 0, Math.PI * 2); c.fill();
  const bang = (p: number) => Math.PI * 0.75 + Math.PI * 1.5 * (p / 1000);
  c.strokeStyle = '#222'; c.fillStyle = '#222'; c.font = '700 24px "Share Tech Mono", monospace';
  for (let p = 0; p <= 1000; p += 50) {
    const aa = bang(p), big = p % 100 === 0; c.lineWidth = big ? 4 : 2;
    c.beginPath(); c.moveTo(bx + Math.cos(aa) * (BR - 10), by + Math.sin(aa) * (BR - 10)); c.lineTo(bx + Math.cos(aa) * (BR - (big ? 32 : 22)), by + Math.sin(aa) * (BR - (big ? 32 : 22))); c.stroke();
    if (p % 200 === 0) c.fillText(String(p / 100), bx + Math.cos(aa) * (BR - 56), by + Math.sin(aa) * (BR - 56));
  }
  const bc = Math.min(1, sim.brake / 1.4) * 440;
  const mr = 820 + Math.sin(time * 0.3) * 30;
  const needle = (p: number, col: string, w: number) => { const aa = bang(p); c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(aa) * (BR - 26), by + Math.sin(aa) * (BR - 26)); c.stroke(); };
  needle(mr, '#1a1a1a', 6); needle(bc, '#D02A20', 7);
  c.fillStyle = '#333'; c.beginPath(); c.arc(bx, by, 12, 0, Math.PI * 2); c.fill();
  c.font = '700 20px "Zen Kaku Gothic New", sans-serif'; c.fillStyle = '#D02A20'; c.fillText('BC', bx - 30, by + 70); c.fillStyle = '#1a1a1a'; c.fillText('MR', bx + 30, by + 70);
  c.font = '700 16px "Share Tech Mono", monospace'; c.fillText('×100kPa', bx, by + 100);
  // ---- 運転情報の画面 ----
  const mx = 860, my = 40, mw = 700, mh = 420;
  c.fillStyle = '#05070B'; c.fillRect(mx - 10, my - 10, mw + 20, mh + 20);
  c.fillStyle = '#0B1424'; c.fillRect(mx, my, mw, mh);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillStyle = '#5FD4FF'; c.font = '700 26px "Zen Kaku Gothic New", sans-serif'; c.fillText('ひかり野線　普通', mx + 20, my + 40);
  c.fillStyle = '#E8ECF5'; c.font = '700 40px "Share Tech Mono", monospace'; c.textAlign = 'right'; c.fillText(fmtTime(sim.t), mx + mw - 20, my + 44);
  c.textAlign = 'left';
  const st = STATIONS[Math.min(STATIONS.length - 1, sim.at >= 0 ? sim.at : sim.next)];
  c.fillStyle = '#A9B2C8'; c.font = '700 22px "Zen Kaku Gothic New", sans-serif';
  c.fillText(sim.at >= 0 ? '停車中' : '次は', mx + 20, my + 92);
  c.fillStyle = '#FFFFFF'; c.font = '900 54px "Zen Kaku Gothic New", sans-serif'; c.fillText(st.name, mx + 20, my + 150);
  c.fillStyle = '#A9B2C8'; c.font = '700 22px "Zen Kaku Gothic New", sans-serif';
  c.fillText(sim.at >= 0 ? '発車' : '到着', mx + 330, my + 92);
  c.fillStyle = '#E8ECF5'; c.font = '700 44px "Share Tech Mono", monospace';
  c.fillText(fmtTime(sim.at >= 0 ? st.dep : st.arr).slice(0, 8), mx + 330, my + 146);
  // 残り距離
  if (opts.dist !== null && sim.at < 0) {
    c.fillStyle = '#A9B2C8'; c.font = '700 22px "Zen Kaku Gothic New", sans-serif'; c.fillText('停止位置まで', mx + 20, my + 205);
    c.fillStyle = '#5FD4FF'; c.font = '700 60px "Share Tech Mono", monospace';
    const d = opts.dist;
    c.fillText(d > 999 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(d < 50 ? 1 : 0)} m`, mx + 20, my + 268);
  }
  // 制限
  c.fillStyle = '#A9B2C8'; c.font = '700 22px "Zen Kaku Gothic New", sans-serif'; c.fillText('制限', mx + 430, my + 205);
  c.fillStyle = '#FFFFFF'; c.fillRect(mx + 430, my + 216, 110, 70); c.fillStyle = '#111'; c.font = '900 52px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.fillText(String(lim), mx + 485, my + 270); c.textAlign = 'left';
  // 予測停止位置（かんたん）
  if (opts.guide && opts.dist !== null && sim.at < 0 && opts.dist < 600 && sim.v > 0.5) {
    const bd = brakingDistance(sim);
    const diff = bd - opts.dist;
    c.fillStyle = '#A9B2C8'; c.font = '700 20px "Zen Kaku Gothic New", sans-serif'; c.fillText('このままだと', mx + 570, my + 205);
    c.fillStyle = Math.abs(diff) < 3 ? '#4CD98A' : diff > 0 ? '#FF5A4E' : '#FFB347';
    c.font = '700 34px "Share Tech Mono", monospace';
    c.fillText(isFinite(bd) ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` : '---', mx + 570, my + 250);
  }
  // ノッチの帯
  const labels = ['非常', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', 'N', 'P1', 'P2', 'P3', 'P4', 'P5'];
  const cur = notchLabel(sim.notch);
  const bw = (mw - 40) / labels.length;
  labels.forEach((l, i) => {
    const x = mx + 20 + i * bw, y = my + 320;
    const col = l.startsWith('P') ? '#4CD98A' : l === 'N' ? '#E8ECF5' : l === '非常' ? '#FF5A4E' : '#FFB347';
    const on = l === cur;
    c.fillStyle = on ? col : '#18223A'; c.fillRect(x + 2, y, bw - 4, 40);
    c.fillStyle = on ? '#0B0D12' : col; c.font = `700 ${l === '非常' ? 16 : 20}px "Share Tech Mono", "Zen Kaku Gothic New", monospace`; c.textAlign = 'center'; c.fillText(l, x + bw / 2, y + 28);
  });
  c.textAlign = 'left';
  // 表示灯
  const lampsY = my + 395;
  const lampD = (x: number, label: string, on: boolean, col: string) => {
    c.fillStyle = on ? col : '#2A2E35'; c.beginPath(); c.arc(x, lampsY, 13, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#A9B2C8'; c.font = '700 20px "Zen Kaku Gothic New", sans-serif'; c.fillText(label, x + 20, lampsY + 7);
  };
  lampD(mx + 30, '戸閉', sim.door === 'closed', '#FFB347');
  lampD(mx + 150, 'ATS', sim.ats !== 'off' && (sim.ats === 'brake' || Math.floor(time * 3) % 2 === 0), '#FF5A4E');
  lampD(mx + 270, '非常', sim.notch === EB || sim.ats === 'brake', '#FF5A4E');
  lampD(mx + 390, 'ブレーキ', sim.brake > 0.05, '#5FD4FF');
}
