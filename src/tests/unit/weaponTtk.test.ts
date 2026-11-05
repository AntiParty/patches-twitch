import { strict as assert } from 'assert';
import { computeTtk, falloffMultiplierAt, rangeConfidence, shotsToKill, shotTime, timeToKill, type AttackMode } from '@/services/weaponTtk';

const mode = (over: Partial<AttackMode> = {}): AttackMode => ({
  label: 'Primary', damage: 25, projectiles: 1, headshotMult: null, rpm: 500, burstSize: 1, burstRpm: null, ...over,
});
const HEALTH = { Light: 175, Medium: 250, Heavy: 325 };
const noReload = { magSize: null, reloadS: null };

describe('weaponTtk', () => {
  describe('shotsToKill', () => {
    it('does not round an exact division up (175 / 25 is 7, not 8)', () => {
      assert.equal(shotsToKill(175, 25), 7);
    });
    it('rounds partial shots up', () => {
      assert.equal(shotsToKill(175, 24), 8);
    });
    it('needs at least one shot', () => {
      assert.equal(shotsToKill(100, 500), 1);
    });
    it('never kills with no damage', () => {
      assert.equal(shotsToKill(175, 0), Infinity);
    });
  });

  describe('timeToKill', () => {
    it('automatic: FCAR 25 dmg at 500 rpm needs 7 shots in 0.72s against Light', () => {
      const cell = timeToKill(175, 25, mode(), noReload);
      assert.deepEqual(cell, { shots: 7, seconds: 0.72 });
    });

    it('burst: FAMAS 24 dmg, 220 rpm between bursts of 3 at 1080 rpm, Light body is 8 shots in 0.823s', () => {
      const famas = mode({ damage: 24, rpm: 220, burstSize: 3, burstRpm: 1080 });
      assert.deepEqual(timeToKill(175, 24, famas, noReload), { shots: 8, seconds: 0.823 });
    });

    it('burst: 93R 210 rpm / 1000 rpm kills Light in 0.871s', () => {
      const r93 = mode({ damage: 22, rpm: 210, burstSize: 3, burstRpm: 1000 });
      assert.deepEqual(timeToKill(175, 22, r93, noReload), { shots: 8, seconds: 0.871 });
    });

    it('pellets: SH1900 12x15 at 80 rpm kills Light in 1 shot and Medium in 2 (0.75s)', () => {
      const rows = computeTtk({ name: 'SH1900', modes: [mode({ damage: 12, projectiles: 15, rpm: 80 })], magSize: 2, reloadS: 2.6 }, HEALTH);
      const body = rows.find((r) => r.hit === 'body')!;
      assert.deepEqual(body.byBuild.Light, { shots: 1, seconds: 0 });
      assert.deepEqual(body.byBuild.Medium, { shots: 2, seconds: 0.75 });
    });

    it('adds a reload when the kill needs more shots than the magazine holds', () => {
      // 7 shots, mag of 5: one reload in the middle. 6 gaps of 0.1s + 2s reload.
      const cell = timeToKill(175, 25, mode({ rpm: 600 }), { magSize: 5, reloadS: 2 });
      assert.deepEqual(cell, { shots: 7, seconds: 2.6 });
    });

    it('does not add a reload when the kill fits in the magazine', () => {
      const cell = timeToKill(175, 25, mode({ rpm: 600 }), { magSize: 7, reloadS: 2 });
      assert.equal(cell.seconds, 0.6);
    });

    it('returns null seconds when the cadence is unknown, but still counts shots', () => {
      const cell = timeToKill(175, 25, mode({ rpm: null }), noReload);
      assert.deepEqual(cell, { shots: 7, seconds: null });
    });

    it('melee: the first interval can differ from the follow-up cadence', () => {
      // 4 hits: first gap 0.5s, then two gaps at 100 rpm (0.6s each).
      const sword = mode({ damage: 50, rpm: 100, firstIntervalS: 0.5 });
      assert.deepEqual(timeToKill(175, 50, sword, noReload), { shots: 4, seconds: 1.7 });
      assert.equal(shotTime(1, sword), 0.5);
      assert.equal(shotTime(0, sword), 0);
    });
  });

  describe('computeTtk', () => {
    it('adds head rows only when the mode has a headshot multiplier above 1', () => {
      const w = { name: 'X', modes: [mode({ headshotMult: 1.5 }), mode({ label: 'Alt', headshotMult: null })], ...noReload };
      const rows = computeTtk(w, HEALTH);
      assert.deepEqual(rows.map((r) => `${r.mode}:${r.hit}`), ['Primary:head', 'Primary:body', 'Alt:body']);
    });

    it('uses headshot damage for the head row', () => {
      const w = { name: 'X', modes: [mode({ damage: 25, headshotMult: 2 })], ...noReload };
      const head = computeTtk(w, HEALTH).find((r) => r.hit === 'head')!;
      assert.equal(head.byBuild.Light.shots, 4); // 175 / 50 = 3.5 -> 4
    });
  });

  describe('falloff by range', () => {
    const fcarFalloff = { falloffMinM: 35, falloffMaxM: 40, falloffMult: 0.55 };

    it('falloffMultiplierAt: full damage before and at the start, linear inside, floor at and after the end', () => {
      assert.equal(falloffMultiplierAt(0, fcarFalloff), 1);
      assert.equal(falloffMultiplierAt(20, fcarFalloff), 1);
      assert.equal(falloffMultiplierAt(35, fcarFalloff), 1);
      assert.ok(Math.abs(falloffMultiplierAt(37.5, fcarFalloff) - 0.775) < 1e-9);
      assert.equal(falloffMultiplierAt(40, fcarFalloff), 0.55);
      assert.equal(falloffMultiplierAt(80, fcarFalloff), 0.55);
    });

    it('falloffMultiplierAt: no falloff data or no distance means no change', () => {
      assert.equal(falloffMultiplierAt(50, {}), 1);
      assert.equal(falloffMultiplierAt(50, { falloffMinM: null, falloffMaxM: null, falloffMult: null }), 1);
      assert.equal(falloffMultiplierAt(undefined, fcarFalloff), 1);
      assert.equal(falloffMultiplierAt(null, fcarFalloff), 1);
    });

    it('worked example: FCAR 25 dmg at 40 m does 13.75 per shot, so Medium takes 19 shots in 2.16s with no reload (mag 20)', () => {
      const cell = timeToKill(250, 25, mode(), { magSize: 20, reloadS: 2.5, ...fcarFalloff }, 40);
      assert.deepEqual(cell, { shots: 19, seconds: 2.16 });
    });

    it('leaves TTK unchanged inside the full-damage range or when distance is omitted', () => {
      const w = { name: 'FCAR', modes: [mode()], magSize: 20, reloadS: 2.5, ...fcarFalloff };
      const base = computeTtk(w, HEALTH);
      assert.deepEqual(computeTtk(w, HEALTH, 0), base);
      assert.deepEqual(computeTtk(w, HEALTH, 35), base);
      assert.equal(computeTtk(w, HEALTH, 40)[0].byBuild.Medium.shots, 19);
    });

    it('a weapon without falloff data is unaffected by distance', () => {
      const w = { name: 'Sword', modes: [mode()], ...noReload };
      assert.deepEqual(computeTtk(w, HEALTH, 80), computeTtk(w, HEALTH));
    });

    it('a zero multiplier beyond the range means it cannot kill: Infinity shots, null seconds', () => {
      const flame = { falloffMinM: 7.4, falloffMaxM: 7.4, falloffMult: 0 };
      assert.deepEqual(timeToKill(175, 20, mode(), { ...noReload, ...flame }, 7.5), { shots: Infinity, seconds: null });
      assert.equal(timeToKill(175, 20, mode(), { ...noReload, ...flame }, 7.4).shots, 9);
    });
  });

  describe('rangeConfidence', () => {
    const f = { falloffMinM: 30, falloffMaxM: 50, falloffMult: 0.5 };
    const one = { projectiles: 1 };
    const pellets = { projectiles: 12 };

    it('solid with no falloff data, no distance, or at/inside the falloff start', () => {
      assert.equal(rangeConfidence(80, { falloffMinM: null, falloffMaxM: null, falloffMult: null }, one), 'solid');
      assert.equal(rangeConfidence(0, f, one), 'solid');
      assert.equal(rangeConfidence(undefined, f, pellets), 'solid');
      assert.equal(rangeConfidence(30, f, one), 'solid');
      assert.equal(rangeConfidence(30, f, pellets), 'solid');
    });

    it('estimate inside and past the falloff band for single-projectile weapons', () => {
      assert.equal(rangeConfidence(30.5, f, one), 'estimate');
      assert.equal(rangeConfidence(40, f, one), 'estimate');
      assert.equal(rangeConfidence(80, f, one), 'estimate');
    });

    it('rough for pellet weapons past the falloff start', () => {
      assert.equal(rangeConfidence(31, f, pellets), 'rough');
      assert.equal(rangeConfidence(80, f, { projectiles: 2 }), 'rough');
    });
  });
});
