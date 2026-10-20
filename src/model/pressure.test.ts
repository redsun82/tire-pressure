import { describe, expect, it } from 'vitest';
import { BASE, LIMITS, SURFACE, bertoCommunityFitPsi } from './coefficients';
import {
  basePressurePsi,
  computePressure,
  effectiveWidth,
  estimateDrop,
  limitConflict,
  PUMP_FLOOR_PSI,
  rideReadingPsi,
  wheelLoads,
  wheelSizeFactor,
  type PressureInput,
} from './pressure';
import { SEED_PROFILES, SURFACES, WHEEL_SIZES, defaultRide, formatCorrection, toPressureInput, type RideSettings } from './profile';
import { SRAM_AXS_CASES, SRAM_AXS_KID, SRAM_AXS_WHEEL_SIZES } from './sram-axs.fixtures';
import { ATMOSPHERE_PSI, formatCelsius, gaugeAtTemperature, pumpPsi, ridePsi } from './temperature';
import { barToPsi, formatBar, formatPsi, parseDecimal, psiToBar } from './units';

const road: PressureInput = {
  riderKg: 75,
  bikeKg: 8,
  gearKg: 1,
  frontShare: 0.43,
  frontWidthMm: 30,
  rearWidthMm: 30,
  innerRimMm: 21,
  wheelBsdMm: 622,
  tubeless: true,
  hookless: false,
  surface: 'smooth',
  wet: false,
  trailerTongueKg: 0,
  rearBagsKg: 0,
};

function seed(id: string) {
  const profile = SEED_PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(id);
  return profile;
}

function ride(id: string, overrides: Partial<RideSettings> = {}) {
  const profile = seed(id);
  return computePressure(toPressureInput(profile, { ...defaultRide(profile), ...overrides }));
}

describe('units', () => {
  it('converts psi and bar both ways', () => {
    expect(psiToBar(14.503773773)).toBeCloseTo(1, 9);
    expect(barToPsi(5)).toBeCloseTo(72.52, 2);
    for (const psi of [20, 45.5, 72.5, 110]) expect(barToPsi(psiToBar(psi))).toBeCloseTo(psi, 9);
  });

  it('formats for a pump gauge', () => {
    expect(formatPsi(49.6)).toBe('50');
    expect(formatBar(3.4467)).toBe('3.45');
  });

  it('never rounds past a limit', () => {
    const max = (maxPsi: number) => ({ minPsi: null, maxPsi });
    const min = (minPsi: number) => ({ minPsi, maxPsi: null });
    expect(formatPsi(LIMITS.hooklessMaxPsi, max(LIMITS.hooklessMaxPsi))).toBe('72');
    expect(formatPsi(72.5, max(LIMITS.hooklessMaxPsi))).toBe('72'); // below the cap, but 73 would be above
    expect(formatPsi(72, max(72))).toBe('72');
    expect(formatPsi(49.88, max(49.9))).toBe('49');
    expect(formatPsi(49.4, max(49.9))).toBe('49');
    expect(formatPsi(30.2, min(30.2))).toBe('31');
    expect(formatPsi(30.6, min(30.2))).toBe('31');
    expect(formatPsi(30, min(30))).toBe('30');
    expect(formatBar(psiToBar(65), max(65))).toBe('4.48');
    expect(formatBar(psiToBar(LIMITS.hooklessMaxPsi), max(LIMITS.hooklessMaxPsi))).toBe('5.00');
    expect(formatBar(psiToBar(30.2), min(30.2))).toBe('2.09');
    expect(formatPsi(72.5)).toBe('73');
    // Conflicting limits: the maximum wins.
    expect(formatPsi(60, { minPsi: 60.5, maxPsi: 60.4 })).toBe('60');
  });

  it('adds decimals when no whole step fits between valid limits', () => {
    const range = (minPsi: number, maxPsi: number) => ({ minPsi, maxPsi });
    expect(formatPsi(30.3, range(30.2, 30.4))).toBe('30.3');
    expect(formatPsi(72.5, range(72.5, LIMITS.hooklessMaxPsi))).toBe('72.5');
    expect(formatPsi(30.25, range(30.25, 30.25))).toBe('30.25');
    expect(formatPsi(31, range(30.2, 31.4))).toBe('31'); // a whole step fits: no extra decimals
    // 2.0891–2.0898 bar: neither 2.08 nor 2.09 fits.
    const bar = formatBar(psiToBar(30.305), range(30.3, 30.31));
    expect(Number(bar)).toBeGreaterThanOrEqual(psiToBar(30.3) - 1e-9);
    expect(Number(bar)).toBeLessThanOrEqual(psiToBar(30.31) + 1e-9);
    expect(bar).toBe('2.0895');
  });

  it('stays within equal limits at both bar precisions', () => {
    const exact = { minPsi: 30, maxPsi: 30 };
    expect(formatPsi(30, exact)).toBe('30');
    // 30 psi is 2.068427… bar: no short decimal is exact, so show the limit itself to two
    // extra decimals rather than 2.06 / 2.0, which are below it.
    for (const [decimals, expected] of [[1, '2.068'], [2, '2.0684']] as const) {
      const bar = formatBar(psiToBar(30), exact, decimals);
      expect(bar).toBe(expected);
      expect(Math.abs(Number(bar) - psiToBar(30))).toBeLessThanOrEqual(0.5 * 10 ** -(decimals + 2));
    }
    expect(formatPsi(30.123, { minPsi: 30.123, maxPsi: 30.123 })).toBe('30.12');
    // Equal limits that are exact in bar keep the short form.
    const fiveBar = { minPsi: barToPsi(5), maxPsi: barToPsi(5) };
    expect(formatBar(5, fiveBar, 1)).toBe('5.0');
    expect(formatBar(5, fiveBar, 2)).toBe('5.00');
  });

  it('parses decimal comma and point', () => {
    expect(parseDecimal('7,5')).toBe(7.5);
    expect(parseDecimal(' 7.5 ')).toBe(7.5);
    expect(parseDecimal('75')).toBe(75);
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('')).toBeNaN();
  });
});

describe('base fit', () => {
  it('stays near the Berto community fit at a typical rear wheel load', () => {
    // Calibrated to SRAM, which runs a bit higher than Berto's 15% drop on narrow tires.
    for (const width of [28, 35, 45]) {
      const ratio = basePressurePsi(45, width) / bertoCommunityFitPsi(45, width);
      expect(ratio).toBeGreaterThan(0.9);
      expect(ratio).toBeLessThan(1.25);
    }
  });

  it('is sub-linear in load and steep in width', () => {
    const p1 = basePressurePsi(40, 35);
    expect(basePressurePsi(80, 35) / p1).toBeLessThan(2);
    expect(basePressurePsi(80, 35) / p1).toBeCloseTo(2 ** BASE.a, 9);
    expect(p1 / basePressurePsi(40, 70)).toBeGreaterThan(2);
  });

  it('estimates 15% drop at the base pressure and more drop when softer', () => {
    expect(estimateDrop(50, 50)).toBeCloseTo(0.15, 9);
    expect(estimateDrop(50, 40)).toBeGreaterThan(0.15);
  });
});

describe('loads and widths', () => {
  it('splits rider + bike + gear and puts trailer/bags on the rear', () => {
    const loads = wheelLoads({ ...road, trailerTongueKg: 2.5, rearBagsKg: 6 });
    expect(loads.front).toBeCloseTo(84 * 0.43, 9);
    expect(loads.rear).toBeCloseTo(84 * 0.57 + 8.5, 9);
    expect(loads.total).toBeCloseTo(92.5, 9);
  });

  it('widens tires on wider rims by 0.4 mm per mm', () => {
    expect(effectiveWidth(30, 19)).toBe(30);
    expect(effectiveWidth(30, 22)).toBeCloseTo(31.2, 9);
    expect(effectiveWidth(45, 24)).toBeCloseTo(45.4, 9);
  });

  it('leaves 700c alone and raises pressure on smaller wheels', () => {
    expect(wheelSizeFactor(622, 30)).toBe(1);
    expect(wheelSizeFactor(622, 56)).toBe(1);
    // 650b × 47 vs 700c × 30: about the same overall diameter, so about 1 psi more.
    expect(wheelSizeFactor(584, 47)).toBeGreaterThan(1.02);
    expect(wheelSizeFactor(584, 47)).toBeLessThan(1.03);
    // 20 × 1.75″ and 16 × 1.75″ on a 19 mm rim (effective width 42.4 mm).
    expect(wheelSizeFactor(406, effectiveWidth(44, 19))).toBeCloseTo(1.2, 2);
    expect(wheelSizeFactor(305, effectiveWidth(44, 19))).toBeCloseTo(1.35, 2);
    // Narrower tires on the same rim make a smaller wheel, so the effect is larger.
    expect(wheelSizeFactor(406, 30)).toBeGreaterThan(wheelSizeFactor(406, 45));
  });
});

describe('monotonicity', () => {
  const base = computePressure(road);

  it.each([
    ['rider weight', { riderKg: 90 }],
    ['bike weight', { bikeKg: 12 }],
    ['gear', { gearKg: 5 }],
    ['inner tubes', { tubeless: false }],
  ] as const)('more %s → higher front and rear', (_name, change) => {
    const r = computePressure({ ...road, ...change });
    expect(r.front.psi).toBeGreaterThan(base.front.psi);
    expect(r.rear.psi).toBeGreaterThan(base.rear.psi);
  });

  it.each([
    ['wider tires', { frontWidthMm: 35, rearWidthMm: 35 }],
    ['wider rims', { innerRimMm: 25 }],
    ['wet', { wet: true }],
  ] as const)('%s → lower front and rear', (_name, change) => {
    const r = computePressure({ ...road, ...change });
    expect(r.front.psi).toBeLessThan(base.front.psi);
    expect(r.rear.psi).toBeLessThan(base.rear.psi);
  });

  it('smaller wheels → higher front and rear', () => {
    const psi = WHEEL_SIZES.map(({ bsdMm }) => computePressure({ ...road, wheelBsdMm: bsdMm }));
    expect(psi[0]).toEqual(base);
    for (let i = 1; i < psi.length; i++) {
      expect(psi[i]!.front.psi).toBeGreaterThan(psi[i - 1]!.front.psi);
      expect(psi[i]!.rear.psi).toBeGreaterThan(psi[i - 1]!.rear.psi);
    }
  });

  it('rear-only loads change only the rear', () => {
    for (const change of [{ trailerTongueKg: 3 }, { rearBagsKg: 6 }]) {
      const r = computePressure({ ...road, ...change });
      expect(r.front.psi).toBe(base.front.psi);
      expect(r.rear.psi).toBeGreaterThan(base.rear.psi);
    }
  });

  it('moving weight forward raises front and lowers rear', () => {
    const r = computePressure({ ...road, frontShare: 0.48 });
    expect(r.front.psi).toBeGreaterThan(base.front.psi);
    expect(r.rear.psi).toBeLessThan(base.rear.psi);
  });

  it('rougher surfaces get lower pressure', () => {
    const order = ['smooth', 'worn', 'rough', 'loose', 'rocky'] as const;
    const psi = order.map((surface) => computePressure({ ...road, surface }).front.psi);
    for (let i = 1; i < psi.length; i++) expect(psi[i]).toBeLessThan(psi[i - 1]!);
    expect(computePressure({ ...road, surface: 'hardpack' }).front.psi).toBeGreaterThan(psi[3]!);
    // The gravel steps follow Silca's Pro calculator's three gravel categories.
    expect(SURFACE.loose / SURFACE.hardpack).toBeCloseTo(0.909, 2);
    expect(SURFACE.rocky / SURFACE.hardpack).toBeCloseTo(0.808, 2);
    for (const surface of SURFACES) expect(SURFACE[surface]).toBeLessThanOrEqual(1);
  });
});

describe('limits and warnings', () => {
  const heavyNarrowHookless: PressureInput = {
    ...road,
    riderKg: 110,
    frontWidthMm: 25,
    rearWidthMm: 25,
    innerRimMm: 19,
    hookless: true,
  };

  it('caps hookless rims at 5 bar and warns once for both wheels', () => {
    const r = computePressure(heavyNarrowHookless);
    expect(r.front.clamped).toBe('max');
    const danger = r.warnings.filter((w) => w.level === 'danger');
    expect(danger).toHaveLength(1);
    expect(danger[0]!.wheels).toEqual(['front', 'rear']);
    expect(danger[0]!.message).toMatch(/^Both tires capped at 72 psi/);
    expect(r.rear.psi).toBe(LIMITS.hooklessMaxPsi);
    expect(r.rear.bar).toBeCloseTo(5, 2);
    expect(r.rear.clamped).toBe('max');
    expect(r.warnings.some((w) => w.level === 'danger' && w.wheels.includes('rear'))).toBe(true);
  });

  it('does not cap hooked rims without a tire limit', () => {
    const r = computePressure({ ...heavyNarrowHookless, hookless: false });
    expect(r.rear.psi).toBeGreaterThan(LIMITS.hooklessMaxPsi);
    expect(r.rear.clamped).toBeNull();
  });

  it('uses the lowest of rim, tire and hookless limits', () => {
    const r = computePressure({ ...heavyNarrowHookless, tireMaxPsi: 65, rimMaxPsi: 70 });
    expect(r.rear.psi).toBe(65);
    expect(r.warnings.find((w) => w.wheels.includes('rear'))?.message).toContain('tire maximum');
  });

  it('rounds an unclamped result within the limits', () => {
    // The seeded Endurace rear computes ~55.8 psi, which would round to 56.
    const endurace = seed('seed-endurace');
    const r = computePressure({ ...toPressureInput(endurace, defaultRide(endurace)), tireMaxPsi: 55.9 });
    expect(r.rear.clamped).toBeNull();
    expect(r.rear.psi).toBeGreaterThan(55.5);
    expect(r.rear.psi).toBeLessThan(55.9);
    expect(formatPsi(r.rear.psi)).toBe('56');
    expect(formatPsi(r.rear.psi, r.rear.limits)).toBe('55');
  });

  it('never exceeds a maximum when the tire minimum is above it', () => {
    const r = computePressure({ ...heavyNarrowHookless, tireMinPsi: 80 });
    for (const wheel of [r.front, r.rear]) {
      expect(wheel.psi).toBe(LIMITS.hooklessMaxPsi);
      expect(wheel.clamped).toBe('max');
    }
    expect(r.warnings[0]).toMatchObject({ level: 'danger', wheels: [] });
    expect(r.warnings[0]!.message).toMatch(/tire minimum \(80 psi\) is above the 5 bar hookless limit \(72 psi\)/);
    expect(r.warnings.some((w) => /capped at 72 psi/.test(w.message))).toBe(true);

    const soft = computePressure({ ...road, tireMinPsi: 80, tireMaxPsi: 70 });
    expect(soft.front.psi).toBe(70);
    expect(soft.warnings[0]!.message).toContain('above the tire maximum (70 psi)');
  });

  it('does not flag limits that agree', () => {
    expect(limitConflict({ hookless: true, tireMinPsi: 40, tireMaxPsi: null, rimMaxPsi: null })).toBeNull();
    expect(limitConflict({ hookless: false, tireMinPsi: 80, tireMaxPsi: null, rimMaxPsi: null })).toBeNull();
    expect(limitConflict({ hookless: false, tireMinPsi: 70, tireMaxPsi: 70, rimMaxPsi: null })).toBeNull();
  });

  it('raises to the tire minimum', () => {
    const r = computePressure({ ...road, frontWidthMm: 50, rearWidthMm: 50, tireMinPsi: 30 });
    expect(r.front.psi).toBe(30);
    expect(r.front.clamped).toBe('min');
    expect(r.front.drop).toBeLessThan(0.15);
  });

  it('warns about large drop, earlier with tubes', () => {
    // loose + wet: ~19% drop tubeless (below 20%), ~18.3% with tubes (above 18%)
    const soft: PressureInput = { ...road, surface: 'loose', wet: true };
    const tubeless = computePressure(soft);
    expect(tubeless.front.drop).toBeLessThan(LIMITS.maxDropWarning);
    expect(tubeless.warnings.filter((w) => w.level === 'warn')).toHaveLength(0);
    const tube = computePressure({ ...soft, tubeless: false });
    expect(tube.front.drop).toBeGreaterThan(LIMITS.maxDropWarningTube);
    expect(tube.warnings.some((w) => w.level === 'warn' && w.message.includes('pinch flats'))).toBe(true);
    const capped = computePressure({ ...heavyNarrowHookless, riderKg: 120 });
    expect(capped.rear.drop).toBeGreaterThan(LIMITS.maxDropWarning);
    expect(capped.warnings.some((w) => w.level === 'danger' && w.message.includes('rim strikes'))).toBe(true);
  });

  it('flags hookless with tubes and odd weight splits', () => {
    const r = computePressure({ ...road, hookless: true, tubeless: false, frontShare: 0.6 });
    expect(r.warnings.filter((w) => w.level === 'info')).toHaveLength(2);
  });

  it('suggests tire inserts on rocky ground only', () => {
    const inserts = (surface: RideSettings['surface']) =>
      ride('seed-grizl', { surface }).warnings.filter((w) => /inserts/.test(w.message));
    expect(inserts('rocky')).toEqual([expect.objectContaining({ level: 'info', wheels: [] })]);
    expect(inserts('rocky')[0]!.message).toBe(
      'Rocky ground: tires compress ~21% at these pressures, so sharp rocks can hit the rim. Consider tire inserts.',
    );
    for (const surface of SURFACES.filter((s) => s !== 'rocky')) expect(inserts(surface)).toEqual([]);
  });

  it('does not warn about the drop rocky itself asks for', () => {
    for (const profile of SEED_PROFILES) {
      for (const tubeless of [true, false]) {
        for (const wet of [false, true]) {
          const bike = { ...profile, tubeless };
          const r = computePressure(toPressureInput(bike, { ...defaultRide(bike), surface: 'rocky', wet }));
          expect(r.front.drop, `${profile.id} tubeless=${tubeless} wet=${wet}`).toBeGreaterThan(
            tubeless ? LIMITS.maxDropWarning : LIMITS.maxDropWarningTube,
          );
          expect(r.warnings.filter((w) => w.level !== 'info')).toEqual([]);
          expect(r.warnings.filter((w) => /hit the rim|rim strikes|pinch flats/.test(w.message))).toHaveLength(1);
        }
      }
    }
  });

  it('still warns on rocky ground when a load pushes the drop further', () => {
    const grizl = { ...seed('seed-grizl'), tireMaxPsi: 27 };
    const rocky = { ...defaultRide(grizl), surface: 'rocky' as const };
    const solo = computePressure(toPressureInput(grizl, rocky));
    expect(solo.rear.clamped).toBeNull();
    expect(solo.warnings.filter((w) => w.level !== 'info')).toEqual([]);

    const towing = computePressure(toPressureInput(grizl, { ...rocky, trailer: true }));
    expect(towing.rear.clamped).toBe('max');
    expect(towing.rear.drop).toBeGreaterThan(solo.rear.drop);
    const rear = towing.warnings.filter((w) => w.wheels.includes('rear'));
    expect(rear).toEqual([expect.objectContaining({ level: 'danger' })]);
    expect(rear[0]!.message).toMatch(/capped at 27 psi: the tire maximum\. That leaves ~\d+% tire drop, so expect rim strikes/);
  });

  it('rejects nonsense input', () => {
    expect(() => computePressure({ ...road, riderKg: 0 })).toThrow(RangeError);
    expect(() => computePressure({ ...road, frontShare: 1 })).toThrow(RangeError);
    expect(() => computePressure({ ...road, frontWidthMm: Number.NaN })).toThrow(RangeError);
  });
});

describe('temperature', () => {
  const coldRide = { pumpC: 20, rideC: 5 };
  const hotRide = { pumpC: 20, rideC: 35 };

  it('scales absolute pressure with absolute temperature', () => {
    expect(ATMOSPHERE_PSI).toBeCloseTo(14.696, 3);
    // 56 psi at 5 °C is (56 + 14.696) × 293.15 / 278.15 − 14.696 ≈ 59.8 psi at 20 °C.
    expect(pumpPsi(56, coldRide)).toBeCloseTo(59.81, 2);
    expect(ridePsi(59.81, coldRide)).toBeCloseTo(56, 2);
    // Pumping in the cold for a hot ride: pump lower.
    expect(pumpPsi(56, { pumpC: 5, rideC: 20 })).toBeCloseTo(52.38, 2);
    expect(gaugeAtTemperature(40, 10, 10)).toBe(40);
    for (const psi of [20, 56, 72.5]) {
      expect(ridePsi(pumpPsi(psi, hotRide), hotRide)).toBeCloseTo(psi, 9);
    }
  });

  it('formats Celsius with a real minus sign', () => {
    expect(formatCelsius(20)).toBe('20\u00a0°C');
    expect(formatCelsius(-5)).toBe('\u22125\u00a0°C');
    expect(formatCelsius(0)).toBe('0\u00a0°C');
  });

  it('shows the pressure to pump to, and what it reads on the ride', () => {
    const plain = computePressure(road);
    expect(plain.temperature).toBeNull();
    expect(plain.front.pump).toEqual({ psi: plain.front.psi, bar: plain.front.bar, limits: plain.front.limits });
    const same = computePressure({ ...road, temperature: { pumpC: 12, rideC: 12 } });
    expect(same.temperature).toBeNull();
    expect(same.front.pump.psi).toBe(plain.front.psi);

    const cold = computePressure({ ...road, temperature: coldRide });
    expect(cold.temperature).toEqual(coldRide);
    for (const w of ['front', 'rear'] as const) {
      // The ride pressure is what the model asks for; only the pump value moves.
      expect(cold[w].psi).toBe(plain[w].psi);
      expect(cold[w].drop).toBe(plain[w].drop);
      expect(cold[w].pump.psi).toBeCloseTo(pumpPsi(plain[w].psi, coldRide), 9);
      expect(cold[w].pump.psi - cold[w].psi).toBeGreaterThan(3);
      expect(cold[w].pump.bar).toBeCloseTo(psiToBar(cold[w].pump.psi), 9);
    }
    const hot = computePressure({ ...road, temperature: hotRide });
    expect(hot.front.pump.psi).toBeLessThan(hot.front.psi);
  });

  const hookless: PressureInput = { ...road, riderKg: 110, frontWidthMm: 25, rearWidthMm: 25, innerRimMm: 19, hookless: true };

  it('keeps the maximum when pumping somewhere warmer', () => {
    const r = computePressure({ ...hookless, temperature: coldRide });
    for (const wheel of [r.front, r.rear]) {
      expect(wheel.clamped).toBe('max');
      expect(wheel.pump.psi).toBeCloseTo(LIMITS.hooklessMaxPsi, 9);
      expect(wheel.psi).toBeCloseTo(ridePsi(LIMITS.hooklessMaxPsi, coldRide), 9);
      expect(formatPsi(wheel.pump.psi, wheel.pump.limits)).toBe('72');
      expect(formatBar(wheel.pump.bar, wheel.pump.limits)).toBe('5.00');
      expect(formatPsi(wheel.psi, wheel.limits)).toBe('68');
    }
    const danger = r.warnings.filter((w) => w.level === 'danger');
    expect(danger).toHaveLength(1);
    expect(danger[0]!.message).toMatch(/^Both tires capped at 72 psi: hookless rims are limited to 5 bar, reached when pumping at 20\u00a0°C\. /);
  });

  it('keeps the maximum when the tire warms up on the ride', () => {
    const r = computePressure({ ...hookless, temperature: hotRide });
    expect(r.rear.clamped).toBe('max');
    expect(r.rear.psi).toBeCloseTo(LIMITS.hooklessMaxPsi, 9);
    expect(r.rear.pump.psi).toBeCloseTo(pumpPsi(LIMITS.hooklessMaxPsi, hotRide), 9);
    expect(formatPsi(r.rear.pump.psi, r.rear.pump.limits)).toBe('68');
    expect(r.warnings[0]!.message).toMatch(/capped at 68 psi: hookless rims are limited to 5 bar, reached as the tire warms up to 35\u00a0°C\./);
  });

  it('applies tire and rim maximums at both temperatures', () => {
    for (const temperature of [coldRide, hotRide]) {
      const r = computePressure({ ...road, riderKg: 110, tireMaxPsi: 60, rimMaxPsi: 65, temperature });
      for (const wheel of [r.front, r.rear]) {
        expect(wheel.pump.psi).toBeLessThanOrEqual(60 + 1e-9);
        expect(wheel.psi).toBeLessThanOrEqual(60 + 1e-9);
        expect(Number(formatPsi(wheel.pump.psi, wheel.pump.limits))).toBeLessThanOrEqual(60);
        expect(Number(formatPsi(wheel.psi, wheel.limits))).toBeLessThanOrEqual(60);
      }
    }
  });

  it('raises to the tire minimum at the ride temperature', () => {
    const r = computePressure({ ...road, frontWidthMm: 50, rearWidthMm: 50, tireMinPsi: 30, temperature: coldRide });
    expect(r.front.clamped).toBe('min');
    expect(r.front.psi).toBe(30);
    expect(r.front.pump.psi).toBeCloseTo(pumpPsi(30, coldRide), 9);
    // 32.4 psi at the pump: rounding down would read below the minimum on the ride.
    expect(formatPsi(r.front.pump.psi, r.front.pump.limits)).toBe('33');
    // The caption shows what the 33 psi on the gauge reads on the ride, not the 30 psi target.
    expect(rideReadingPsi(r.front, coldRide)).toBeCloseTo(30.56, 2);
    expect(formatPsi(rideReadingPsi(r.front, coldRide))).toBe('31');
    // The reading is an observation: the recommendation limits don't round it.
    const tight = computePressure({ ...road, riderKg: 110, tireMinPsi: 60, tireMaxPsi: 60.9, temperature: coldRide });
    expect(formatPsi(tight.front.pump.psi, tight.front.pump.limits)).toBe('60');
    expect(rideReadingPsi(tight.front, coldRide)).toBeCloseTo(56.18, 2);
    expect(formatPsi(rideReadingPsi(tight.front, coldRide))).toBe('56');
    expect(r.warnings.find((w) => w.level === 'warn')?.message).toBe(
      'Front raised to 33 psi: the tire minimum of 30 psi at 5\u00a0°C.',
    );
  });

  it('rounds the pump value so the ride value stays within the limits', () => {
    // A pump value just under a whole psi above the minimum must not round down below it.
    const min = 40;
    const temperature = { pumpC: 20, rideC: 0 };
    const r = computePressure({ ...road, frontWidthMm: 50, rearWidthMm: 50, tireMinPsi: min, temperature });
    const shown = Number(formatPsi(r.front.pump.psi, r.front.pump.limits));
    expect(ridePsi(shown, temperature)).toBeGreaterThanOrEqual(min - 1e-9);
  });

  it('flags a tire minimum that the temperatures put above the maximum', () => {
    // 70 psi minimum under the 72.5 psi hookless cap is fine at one temperature...
    const tight: PressureInput = { ...hookless, tireMinPsi: 70 };
    expect(computePressure(tight).warnings.some((w) => /below the tire minimum/.test(w.message))).toBe(false);
    // ...but pumped at 30 °C for a −10 °C ride, 70 psi on the ride needs ~83 psi at the pump.
    const r = computePressure({ ...tight, temperature: { pumpC: 30, rideC: -10 } });
    expect(r.front.pump.psi).toBeCloseTo(LIMITS.hooklessMaxPsi, 9);
    expect(r.front.psi).toBeLessThan(70);
    expect(r.warnings[0]!.level).toBe('danger');
    expect(r.warnings[0]!.message).toMatch(/capped at 72 psi: .*\. That is below the tire minimum at \u221210\u00a0°C\. (.* )?Pump closer to the ride temperature, or check the tire and rim limits\.$/);
    expect(r.warnings[0]!.message).not.toMatch(/wider tire/);
  });

  it('never recommends pumping below the floor', () => {
    // A tiny load on wide, soft tires, pumped at the coldest for the hottest ride: the target
    // reads less on the ride than an almost empty tire does once warmed up.
    const light: PressureInput = {
      ...road,
      riderKg: 10,
      frontWidthMm: 80,
      rearWidthMm: 80,
      innerRimMm: 45,
      surface: 'loose',
      wet: true,
    };
    const temperature = { pumpC: -20, rideC: 45 };
    expect(pumpPsi(computePressure(light).front.psi, temperature)).toBeLessThan(0);
    const r = computePressure({ ...light, temperature });
    for (const wheel of [r.front, r.rear]) {
      expect(wheel.clamped).toBe('pump-floor');
      expect(wheel.pump.psi).toBeCloseTo(PUMP_FLOOR_PSI, 9);
      expect(formatPsi(wheel.pump.psi, wheel.pump.limits)).toBe('1');
      expect(wheel.psi).toBeCloseTo(ridePsi(PUMP_FLOOR_PSI, temperature), 9);
      // The ride pressure went up, so the drop is recomputed from it.
      expect(wheel.drop).toBeLessThan(computePressure(light)[wheel === r.front ? 'front' : 'rear'].drop);
    }
    const danger = r.warnings.filter((w) => w.level === 'danger');
    expect(danger).toHaveLength(1);
    expect(danger[0]!.message).toMatch(
      /^Both tires too soft to pump at \u221220\u00a0°C: even 1 psi there reads 5 psi at 45\u00a0°C, above the target\. /,
    );
    // With a mild difference, the floor stays out of the way.
    const mild = computePressure({ ...light, temperature: { pumpC: 20, rideC: 25 } });
    expect(mild.front.clamped).toBeNull();
    expect(mild.front.pump.psi).toBeGreaterThan(PUMP_FLOOR_PSI);
  });

  it('gives no pump pressure when even the floor goes over a maximum on the ride', () => {
    // A 5 psi tire maximum pumped at −20 °C for a 45 °C ride: 5 psi on the ride is ~0.98 psi at the pump.
    const temperature = { pumpC: -20, rideC: 45 };
    const tiny: PressureInput = { ...road, riderKg: 10, frontWidthMm: 80, rearWidthMm: 80, innerRimMm: 45, tireMaxPsi: 5 };
    expect(pumpPsi(5, temperature)).toBeLessThan(PUMP_FLOOR_PSI);
    for (const tireMinPsi of [undefined, 5]) {
      const r = computePressure({ ...tiny, tireMinPsi, temperature });
      for (const wheel of [r.front, r.rear]) {
        expect(wheel.clamped).toBe('unreachable');
        // The ride side never goes over the maximum.
        expect(wheel.psi).toBeLessThanOrEqual(5);
      }
      const danger = r.warnings.filter((w) => w.level === 'danger');
      expect(danger.map((w) => w.message)).toEqual([
        "Both tires can't be pumped at \u221220\u00a0°C: even 1 psi there goes over the tire maximum at 45\u00a0°C. Pump closer to the ride temperature.",
      ]);
      expect(r.warnings.some((w) => /capped at|too soft to pump|compress/.test(w.message))).toBe(false);
    }
    // A milder difference is fine with the same maximum.
    const ok = computePressure({ ...tiny, temperature: { pumpC: 10, rideC: 20 } });
    expect(ok.front.clamped).not.toBe('unreachable');
    expect(Number(formatPsi(ok.front.pump.psi, ok.front.pump.limits))).toBeGreaterThanOrEqual(PUMP_FLOOR_PSI);
  });

  it('rejects nonsense temperatures', () => {
    expect(() => computePressure({ ...road, temperature: { pumpC: Number.NaN, rideC: 5 } })).toThrow(RangeError);
    expect(() => computePressure({ ...road, temperature: { pumpC: 20, rideC: -300 } })).toThrow(RangeError);
  });

  it('comes from the ride settings only when switched on', () => {
    expect(ride('seed-endurace', { pumpC: 20, rideC: 5 }).temperature).toBeNull();
    const on = ride('seed-endurace', { temperature: true, pumpC: 20, rideC: 5 });
    expect(on.temperature).toEqual(coldRide);
    expect(on.rear.pump.psi).toBeGreaterThan(on.rear.psi);
  });
});

describe('per-bike correction', () => {
  const withoutCorrection = (input: PressureInput): PressureInput => {
    const { correctionPct: _c, ...rest } = input;
    return rest;
  };

  it('scales the target pressure of both wheels', () => {
    const base = computePressure(road);
    for (const pct of [-15, -5, 1, 10, 15]) {
      const r = computePressure({ ...road, correctionPct: pct });
      for (const w of ['front', 'rear'] as const) {
        expect(r[w].psi).toBeCloseTo(base[w].psi * (1 + pct / 100), 9);
        expect(r[w].pump.psi).toBeCloseTo(r[w].psi, 9);
        // The 15% drop base is unchanged, and the drop estimate follows the pressure actually shown.
        expect(r[w].basePsi).toBe(base[w].basePsi);
        expect(r[w].drop).toBeCloseTo(base[w].drop / (1 + pct / 100), 9);
      }
      expect(r.multiplier).toBe(base.multiplier);
    }
  });

  it('is applied before the limits, which still cap it', () => {
    const base = computePressure(road);
    const capped = computePressure({ ...road, correctionPct: 15, tireMaxPsi: base.rear.psi + 1 });
    expect(capped.rear.clamped).toBe('max');
    expect(capped.rear.psi).toBe(base.rear.psi + 1);
    expect(capped.warnings.some((w) => w.level === 'danger' && w.message.startsWith('Rear capped'))).toBe(true);

    const raised = computePressure({ ...road, correctionPct: -15, tireMinPsi: base.front.psi - 1 });
    expect(raised.front.clamped).toBe('min');
    expect(raised.front.psi).toBe(base.front.psi - 1);

    // 15% over the 5 bar hookless limit is still 5 bar.
    const hookless = { ...road, hookless: true, frontWidthMm: 25, rearWidthMm: 25, riderKg: 90 };
    expect(computePressure(hookless).rear.psi).toBeLessThanOrEqual(LIMITS.hooklessMaxPsi);
    const up = computePressure({ ...hookless, correctionPct: 15 });
    expect(up.rear.clamped).toBe('max');
    expect(up.rear.psi).toBe(LIMITS.hooklessMaxPsi);
  });

  it('is applied before the temperature correction', () => {
    const t = { pumpC: 20, rideC: 5 };
    const base = computePressure({ ...road, temperature: t });
    const r = computePressure({ ...road, temperature: t, correctionPct: 10 });
    expect(r.front.psi).toBeCloseTo(base.front.psi * 1.1, 9);
    expect(r.front.pump.psi).toBeCloseTo(pumpPsi(base.front.psi * 1.1, t), 9);
    expect(r.front.pump.psi).not.toBeCloseTo(base.front.pump.psi * 1.1, 3);
  });

  it('warns when a lower pressure makes the tires compress too much', () => {
    const tubes: PressureInput = { ...road, tubeless: false, surface: 'rough' };
    expect(computePressure(tubes).warnings.some((w) => /compress/.test(w.message))).toBe(false);
    const soft = computePressure({ ...tubes, correctionPct: -15 });
    expect(soft.warnings.some((w) => /compress/.test(w.message))).toBe(true);
  });

  it('changes nothing at 0: the same results as without one, to the bit', () => {
    for (const profile of SEED_PROFILES) {
      for (const surface of SURFACES) {
        for (const temperature of [false, true]) {
          const rideSettings = { ...defaultRide(profile), surface, temperature, pumpC: 22, rideC: 3 };
          const input = toPressureInput({ ...profile, correctionPct: 0 }, rideSettings);
          expect(input.correctionPct).toBe(0);
          const zero = computePressure(input);
          const none = computePressure(withoutCorrection(input));
          expect(zero).toStrictEqual(none);
          for (const w of ['front', 'rear'] as const) {
            expect(Object.is(zero[w].psi, none[w].psi)).toBe(true);
            expect(Object.is(zero[w].pump.psi, none[w].pump.psi)).toBe(true);
          }
        }
      }
    }
  });

  it('rejects nonsense corrections', () => {
    expect(() => computePressure({ ...road, correctionPct: Number.NaN })).toThrow(RangeError);
    expect(() => computePressure({ ...road, correctionPct: -100 })).toThrow(RangeError);
  });

  it('formats for display, with nothing at 0', () => {
    expect(formatCorrection(5)).toBe('+5%');
    expect(formatCorrection(-12)).toBe('\u221212%');
    expect(formatCorrection(0)).toBe('');
  });
});

/**
 * We could not obtain outputs of the SRAM/Zipp or Silca calculators (they are
 * proprietary web apps), so these are deliberately broad sanity ranges from
 * common published guidance for these tire sizes and a ~75 kg rider, not
 * reference values:
 * - 28–35 mm road tubeless: roughly 45–70 psi
 * - 45 mm gravel tubeless: roughly 20–40 psi
 */
describe('seed bikes: sanity ranges', () => {
  it('Endurace on smooth tarmac is in the road range, rear higher than front', () => {
    const r = ride('seed-endurace', { surface: 'smooth' });
    for (const wheel of [r.front, r.rear]) {
      expect(wheel.psi).toBeGreaterThanOrEqual(45);
      expect(wheel.psi).toBeLessThanOrEqual(70);
    }
    expect(r.rear.psi).toBeGreaterThan(r.front.psi);
    expect(r.warnings).toHaveLength(0);
  });

  it('Grizl on gravel is in the gravel range and below the hookless limit', () => {
    for (const surface of ['hardpack', 'loose'] as const) {
      for (const trailer of [false, true]) {
        const r = ride('seed-grizl', { surface, trailer, bags: trailer });
        for (const wheel of [r.front, r.rear]) {
          expect(wheel.psi).toBeGreaterThanOrEqual(20);
          expect(wheel.psi).toBeLessThanOrEqual(40);
          expect(wheel.clamped).toBeNull();
        }
      }
    }
  });

  it('Grizl trailer adds 10% of 25 kg to the rear only', () => {
    const without = ride('seed-grizl', { trailer: false });
    const withTrailer = ride('seed-grizl', { trailer: true });
    expect(withTrailer.rear.loadKg - without.rear.loadKg).toBeCloseTo(2.5, 9);
    expect(withTrailer.front.psi).toBe(without.front.psi);
  });
});

/**
 * Regression snapshot of the current model (±5%), so coefficient changes are
 * deliberate. These are our own outputs, not external reference values.
 */
describe('calibration against the SRAM AXS calculator (retrieved 2026-10-19)', () => {
  const mean = (front: number, rear: number) => (front + rear) / 2;
  it.each(SRAM_AXS_CASES.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const r = computePressure(c.input);
    const deviation = mean(r.front.psi, r.rear.psi) / mean(c.sram.front, c.sram.rear) - 1;
    expect(Math.abs(deviation)).toBeLessThanOrEqual(c.tolerance);
  });

  it('gives a 35 kg kid clearly lower pressure than an adult on the same tires', () => {
    // SRAM's gravel results stay around 30 psi here (see SRAM_AXS_KID), so this case is not a calibration target.
    const kid = computePressure(SRAM_AXS_KID.input);
    const adult = computePressure({ ...SRAM_AXS_KID.input, riderKg: 75, bikeKg: 9.8 });
    for (const wheel of ['front', 'rear'] as const) {
      expect(kid[wheel].psi).toBeLessThan(adult[wheel].psi * 0.7);
      expect(kid[wheel].psi).toBeLessThan(SRAM_AXS_KID.sram[wheel]);
    }
  });

  /**
   * Smaller wheels: SRAM raises pressure about 2.8× more than we do in log terms (650b: +8% vs
   * our +3%; 26″: +13% vs our +5%). We keep the contact patch geometry (see WHEEL) and only check
   * that we go the same way, by at least a quarter and at most all of SRAM's step.
   */
  it.each(SRAM_AXS_WHEEL_SIZES.map((c) => [c.name, c] as const))('wheel size: %s', (_, c) => {
    const small = computePressure(c.input);
    const big = computePressure({ ...c.input, wheelBsdMm: 622 });
    const ours = Math.log(mean(small.front.psi, small.rear.psi) / mean(big.front.psi, big.rear.psi));
    const sram = Math.log(mean(c.sram.front, c.sram.rear) / mean(c.sram700c.front, c.sram700c.rear));
    expect(ours).toBeGreaterThan(0.25 * sram);
    expect(ours).toBeLessThan(sram);
  });

  it('gives a kid on small wheels more than on 700c, and still clearly less than an adult', () => {
    const tires = { frontWidthMm: 44, rearWidthMm: 44, innerRimMm: 19 };
    for (const wheelBsdMm of [406, 305]) {
      const kid = computePressure({ ...SRAM_AXS_KID.input, ...tires, riderKg: 25, bikeKg: 8, wheelBsdMm });
      const kid700c = computePressure({ ...SRAM_AXS_KID.input, ...tires, riderKg: 25, bikeKg: 8 });
      const adult = computePressure({ ...SRAM_AXS_KID.input, ...tires, riderKg: 75, bikeKg: 9.8, wheelBsdMm });
      for (const wheel of ['front', 'rear'] as const) {
        expect(kid[wheel].psi).toBeGreaterThan(kid700c[wheel].psi * 1.15);
        expect(kid[wheel].psi).toBeLessThan(adult[wheel].psi * 0.7);
      }
    }
  });
});

describe('seed bikes: regression snapshot', () => {
  const cases: [string, Partial<RideSettings>, number, number][] = [
    ['seed-endurace', { surface: 'smooth' }, 52.3, 55.8],
    ['seed-endurace', { surface: 'rough', wet: true }, 43.2, 46.1],
    ['seed-grizl', { surface: 'hardpack' }, 25.2, 32.6],
    ['seed-grizl', { surface: 'loose', trailer: true }, 22.9, 30.9],
    ['seed-grizl', { surface: 'rocky' }, 20.4, 26.4],
  ];
  it.each(cases)('%s %o → %f / %f psi', (id, overrides, front, rear) => {
    const r = ride(id, overrides);
    expect(r.front.psi / front).toBeGreaterThan(0.95);
    expect(r.front.psi / front).toBeLessThan(1.05);
    expect(r.rear.psi / rear).toBeGreaterThan(0.95);
    expect(r.rear.psi / rear).toBeLessThan(1.05);
  });
});
