import { describe, expect, it } from 'vitest';
import { BASE, LIMITS, SURFACE, bertoCommunityFitPsi } from './coefficients';
import {
  basePressurePsi,
  computePressure,
  effectiveWidth,
  estimateDrop,
  limitConflict,
  wheelLoads,
  type PressureInput,
} from './pressure';
import { SEED_PROFILES, SURFACES, defaultRide, toPressureInput, type RideSettings } from './profile';
import { SRAM_AXS_CASES, SRAM_AXS_KID } from './sram-axs.fixtures';
import { barToPsi, formatBar, formatPsi, parseDecimal, psiToBar } from './units';

const road: PressureInput = {
  riderKg: 75,
  bikeKg: 8,
  gearKg: 1,
  frontShare: 0.43,
  frontWidthMm: 30,
  rearWidthMm: 30,
  innerRimMm: 21,
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
    const order = ['smooth', 'worn', 'rough', 'loose'] as const;
    const psi = order.map((surface) => computePressure({ ...road, surface }).front.psi);
    for (let i = 1; i < psi.length; i++) expect(psi[i]).toBeLessThan(psi[i - 1]!);
    expect(computePressure({ ...road, surface: 'hardpack' }).front.psi).toBeGreaterThan(psi[3]!);
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

  it('rejects nonsense input', () => {
    expect(() => computePressure({ ...road, riderKg: 0 })).toThrow(RangeError);
    expect(() => computePressure({ ...road, frontShare: 1 })).toThrow(RangeError);
    expect(() => computePressure({ ...road, frontWidthMm: Number.NaN })).toThrow(RangeError);
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
    // SRAM floors around 30 psi (see SRAM_AXS_KID), so this case is not a calibration target.
    const kid = computePressure(SRAM_AXS_KID.input);
    const adult = computePressure({ ...SRAM_AXS_KID.input, riderKg: 75, bikeKg: 9.8 });
    for (const wheel of ['front', 'rear'] as const) {
      expect(kid[wheel].psi).toBeLessThan(adult[wheel].psi * 0.7);
      expect(kid[wheel].psi).toBeLessThan(SRAM_AXS_KID.sram[wheel]);
    }
  });
});

describe('seed bikes: regression snapshot', () => {
  const cases: [string, Partial<RideSettings>, number, number][] = [
    ['seed-endurace', { surface: 'smooth' }, 52.3, 55.8],
    ['seed-endurace', { surface: 'rough', wet: true }, 43.2, 46.1],
    ['seed-grizl', { surface: 'hardpack' }, 25.2, 32.6],
    ['seed-grizl', { surface: 'loose', trailer: true }, 22.9, 30.9],
  ];
  it.each(cases)('%s %o → %f / %f psi', (id, overrides, front, rear) => {
    const r = ride(id, overrides);
    expect(r.front.psi / front).toBeGreaterThan(0.95);
    expect(r.front.psi / front).toBeLessThan(1.05);
    expect(r.rear.psi / rear).toBeGreaterThan(0.95);
    expect(r.rear.psi / rear).toBeLessThan(1.05);
  });
});
