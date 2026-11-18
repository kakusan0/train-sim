import { describe, it, expect } from 'vitest';
import { at, nearest, STATIONS, LENGTH, fmtTime } from '../src/route';
import { createSim, step, setNotch, toggleDoor, currentLimit, kmh, totalScore, rank, Sim, nextSignal, aspectOf, legTotal } from '../src/sim';

/** かんたんな自動運転：制限と停止位置を守って走る */
export function autopilot(sim: Sim) {
  if (sim.at >= 0) {
    const st = STATIONS[sim.at];
    if (sim.door === 'closed' && !sim.served) toggleDoor(sim);
    else if (sim.door === 'open' && sim.t >= st.dep - 6 && sim.t - sim.doorOpenedAt > 8) toggleDoor(sim);
    else if (sim.door === 'closed' && sim.t >= st.dep) setNotch(sim, 3);
    else setNotch(sim, -4);
    return;
  }
  const st = STATIONS[sim.next];
  const dist = st.stop - sim.s;
  let lim = currentLimit(sim);
  const ns = nextSignal(sim);
  if (ns && ns.sig.kind === 'home' && ns.dist < 700) lim = Math.min(lim, 45);
  const v = kmh(sim.v);
  const req = (sim.v * sim.v) / (2 * Math.max(0.3, dist - 0.3)); // 必要な減速度
  if (dist < 0.8) { setNotch(sim, -5); return; }
  if (dist < 450 && req > 0.42) {
    setNotch(sim, -Math.max(1, Math.min(8, Math.round(req / 0.12 + 0.5))));
    return;
  }
  if (dist < 450 && v < 12) { setNotch(sim, v < 8 ? 1 : 0); return; }
  const target = lim - 3;
  if (v < target - 4) setNotch(sim, 4);
  else if (v < target) setNotch(sim, 0);
  else setNotch(sim, -Math.min(8, Math.ceil((v - target) / 1.5) + 1));
}

describe('路線', () => {
  it('中心線はなめらかにつながり、近い点の逆算ができる', () => {
    let prev = at(0);
    for (let s = 1; s < LENGTH; s += 1) {
      const f = at(s);
      expect(Math.hypot(f.x - prev.x, f.z - prev.z)).toBeCloseTo(1, 2);
      prev = f;
    }
    const f = at(2345.5, 12);
    const n = nearest(f.x, f.z);
    expect(n.s).toBeGreaterThan(2344); expect(n.s).toBeLessThan(2347);
    expect(n.d).toBeCloseTo(12, 0);
  });
  it('時刻の表示', () => { expect(fmtTime(7 * 3600 + 65)).toBe('07:01:05'); });
});

describe('運転', () => {
  it('はじめは潮見台に停車中で、ドアが開いている', () => {
    const sim = createSim();
    expect(sim.at).toBe(0); expect(sim.door).toBe('open');
    setNotch(sim, 5); step(sim, 1);
    expect(sim.v).toBe(0); // ドアが開いていると動かない
  });
  it('出発信号は発車 10 秒前まで赤', () => {
    const sim = createSim();
    const ns = nextSignal(sim)!;
    expect(aspectOf(ns.sig, sim)).toBe('R');
    sim.t = STATIONS[0].dep - 9;
    expect(aspectOf(ns.sig, sim)).toBe('G');
  });
  it('自動運転で終点まで、ATS を作動させずに定刻近くで走りきれる', () => {
    const sim = createSim();
    for (let i = 0; i < 20 * 60 * 20 && !sim.finished; i++) { autopilot(sim); step(sim, 0.05); }
    expect(sim.finished).toBe(true);
    expect(sim.legs.length).toBe(STATIONS.length - 1);
    for (const l of sim.legs) {
      expect(l.notes.filter((n) => n.includes('ATS') || n.includes('赤信号'))).toEqual([]);
      expect(Math.abs(l.posErr!)).toBeLessThan(3);
      expect(Math.abs(l.arrErr!)).toBeLessThan(40);
      expect(legTotal(l)).toBeGreaterThan(50);
    }
    expect(totalScore(sim)).toBeGreaterThan(180);
    expect(['S', 'A', 'B']).toContain(rank(sim));
  });
  it('制限を大きく超えると ATS が働く', () => {
    const sim = createSim();
    sim.t = STATIONS[0].dep; toggleDoor(sim);
    for (let i = 0; i < 80; i++) step(sim, 0.05);
    setNotch(sim, 5);
    let fired = false;
    for (let i = 0; i < 2000 && !fired; i++) { step(sim, 0.05); fired = sim.ats === 'brake'; }
    expect(fired).toBe(true);
  });
});
