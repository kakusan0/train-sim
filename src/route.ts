// 架空の路線「ひかり野線」：海辺の町から山あいの終点まで。
// 線路の中心線を 1 m ごとに求め、位置・向き・高さを返す。

export interface Station { name: string; kana: string; stop: number; arr: number; dep: number; }
export interface Limit { from: number; to: number; kmh: number; }
export type SignalKind = 'home' | 'start' | 'block';
export interface Signal { s: number; kind: SignalKind; station?: number; }
export interface Crossing { s: number; }
export interface Whistle { s: number; }

export const LENGTH = 5800;
export const TRAIN_LEN = 40; // 2 両
export const TRACK_GAP = -4; // となりの線路（右側）

// 時刻は「0 時からの秒」。07:00:00 始まり
const T = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

export const STATIONS: Station[] = [
  { name: '潮見台', kana: 'しおみだい', stop: 260, arr: T(7, 0, 0), dep: T(7, 0, 45) },
  { name: '浜田', kana: 'はまだ', stop: 2150, arr: T(7, 3, 40), dep: T(7, 4, 10) },
  { name: '稲穂', kana: 'いなほ', stop: 3950, arr: T(7, 6, 50), dep: T(7, 7, 20) },
  { name: '山ノ口', kana: 'やまのくち', stop: 5650, arr: T(7, 10, 0), dep: T(7, 10, 0) },
];
export const PLATFORM_LEN = 100; // 停止位置から後ろへ

// 曲率の制御点 [s, 1/R]（正＝左カーブ）
const CURV: [number, number][] = [
  [0, 0], [420, 0], [520, 1 / 800], [800, 1 / 800], [900, 0], [1200, 0], [1300, -1 / 700], [1650, -1 / 700],
  [1750, 0], [2400, 0], [2500, 1 / 900], [2800, 1 / 900], [2900, 0], [3450, 0], [3550, -1 / 1000],
  [3750, -1 / 1000], [3820, 0], [4100, 0], [4200, 1 / 650], [4500, 1 / 650], [4600, 0], [4800, 0],
  [4900, -1 / 600], [5200, -1 / 600], [5300, 0], [LENGTH + 400, 0],
];
// 勾配の制御点 [s, ‰]
const GRADE: [number, number][] = [
  [0, 0], [600, 0], [700, 3], [1600, 3], [1700, 0], [2300, 0], [2400, 6], [3000, 6], [3100, 0],
  [4100, 0], [4200, 18], [5450, 18], [5530, 0], [LENGTH + 400, 0],
];
const Y0 = 6;

export const LIMITS: Limit[] = [
  { from: 0, to: 520, kmh: 45 },
  { from: 1250, to: 1700, kmh: 75 },
  { from: 4150, to: 4650, kmh: 70 },
  { from: 4850, to: 5300, kmh: 65 },
  { from: 5450, to: LENGTH + 400, kmh: 45 },
];
export const MAX_KMH = 85;

export const SIGNALS: Signal[] = [];
STATIONS.forEach((st, i) => {
  if (i > 0) SIGNALS.push({ s: st.stop - 520, kind: 'home', station: i });
  if (i < STATIONS.length - 1) SIGNALS.push({ s: st.stop + 25, kind: 'start', station: i });
});
for (const s of [1100, 3000, 4900]) SIGNALS.push({ s, kind: 'block' });
SIGNALS.sort((a, b) => a.s - b.s);

export const CROSSINGS: Crossing[] = [{ s: 1000 }, { s: 2920 }];
export const TUNNEL = { from: 4330, to: 4720 };
export const BRIDGE = { from: 3150, to: 3260, river: 3205 };
export const WHISTLES: Whistle[] = [
  ...CROSSINGS.map((c) => ({ s: c.s - 250 })),
  { s: TUNNEL.from - 200 },
];

export type Zone = 'coast' | 'town' | 'paddy' | 'forest';
export function zoneAt(s: number): Zone {
  if (s < 1700) return s < 480 ? 'town' : 'coast';
  if (s < 2520) return 'town';
  if (s < 3820) return 'paddy';
  if (s < 4080) return 'town';
  if (s > 5480) return 'town';
  return 'forest';
}

// ---- 中心線の前計算 ----
const N = LENGTH + 401;
const PX = new Float64Array(N), PZ = new Float64Array(N), PY = new Float64Array(N), TH = new Float64Array(N);

function interp(tab: [number, number][], s: number): number {
  for (let i = 1; i < tab.length; i++) {
    if (s <= tab[i][0]) {
      const [s0, v0] = tab[i - 1], [s1, v1] = tab[i];
      return v0 + (v1 - v0) * ((s - s0) / (s1 - s0));
    }
  }
  return tab[tab.length - 1][1];
}

(function build() {
  let x = 0, z = 0, y = Y0, th = 0;
  for (let i = 0; i < N; i++) {
    PX[i] = x; PZ[i] = z; PY[i] = y; TH[i] = th;
    const k = interp(CURV, i + 0.5);
    th -= k;
    const mid = th + k / 2;
    x += Math.sin(mid); z -= Math.cos(mid);
    y += interp(GRADE, i + 0.5) / 1000;
  }
})();

export interface Frame { x: number; y: number; z: number; th: number; dx: number; dz: number; lx: number; lz: number; }

/** s の位置（m）での中心線。d は左向きの横ずれ */
export function at(s: number, d = 0): Frame {
  if (s < 0) { // 起点より手前はまっすぐ延ばす
    const f = at(0, d);
    return { ...f, x: f.x + f.dx * s, z: f.z + f.dz * s };
  }
  const c = Math.min(N - 2, s);
  const i = Math.floor(c), f = c - i;
  const th = TH[i] + (TH[i + 1] - TH[i]) * f;
  const dx = Math.sin(th), dz = -Math.cos(th);
  const lx = -Math.cos(th), lz = -Math.sin(th);
  const x = PX[i] + (PX[i + 1] - PX[i]) * f + lx * d;
  const z = PZ[i] + (PZ[i + 1] - PZ[i]) * f + lz * d;
  const y = PY[i] + (PY[i + 1] - PY[i]) * f;
  return { x, y, z, th, dx, dz, lx, lz };
}
export const railY = (s: number) => at(s).y;
export const gradeAt = (s: number) => interp(GRADE, s) / 1000;
export const curvatureAt = (s: number) => interp(CURV, s);

/** 世界の点から、いちばん近い中心線の s と横ずれ d（左が正）を求める（粗い探索＋詰め） */
export function nearest(x: number, z: number): { s: number; d: number } {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i += 10) {
    const e = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
    if (e < bd) { bd = e; best = i; }
  }
  for (let i = Math.max(0, best - 10); i <= Math.min(N - 1, best + 10); i++) {
    const e = (PX[i] - x) ** 2 + (PZ[i] - z) ** 2;
    if (e < bd) { bd = e; best = i; }
  }
  const f = at(best);
  return { s: best, d: (x - f.x) * f.lx + (z - f.z) * f.lz };
}

export function limitAt(s: number): number {
  let v = MAX_KMH;
  for (const l of LIMITS) if (s >= l.from && s < l.to) v = Math.min(v, l.kmh);
  return v;
}

export function fmtTime(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
