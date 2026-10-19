import { BASE, CONDITIONS, LIMITS, RIM, SURFACE, WHEEL, type Surface } from './coefficients';
import { formatCelsius, pumpPsi, ridePsi, type Temperatures } from './temperature';
import { formatPsi, psiToBar, type PsiLimits } from './units';

export type Wheel = 'front' | 'rear';

export interface PressureInput {
  riderKg: number;
  bikeKg: number;
  gearKg: number;
  /** Share of rider + bike + gear on the front wheel, 0..1. */
  frontShare: number;
  frontWidthMm: number;
  rearWidthMm: number;
  innerRimMm: number;
  /** Wheel size as the ETRTO bead seat diameter, e.g. 622 for 700c / 29″. */
  wheelBsdMm: number;
  tubeless: boolean;
  hookless: boolean;
  surface: Surface;
  wet: boolean;
  /** Trailer hitch load on the rear axle. */
  trailerTongueKg: number;
  /** Panniers / rack bags, carried over the rear axle. */
  rearBagsKg: number;
  tireMinPsi?: number | null;
  tireMaxPsi?: number | null;
  rimMaxPsi?: number | null;
  /** Pumped at one temperature, ridden at another. Absent: pumped where it is ridden. */
  temperature?: Temperatures | null;
}

export interface WheelResult {
  loadKg: number;
  effectiveWidthMm: number;
  /** Multiplier for the wheel size, relative to a 700c wheel with the same tire. */
  wheelSizeFactor: number;
  /** 15% drop pressure on this wheel size, before surface/conditions/limits. */
  basePsi: number;
  /** Recommended pressure at the ride temperature, after multipliers and limits. */
  psi: number;
  bar: number;
  /** Estimated tire drop at the recommended pressure (fraction). */
  drop: number;
  /**
   * `pump-floor`: the target is too low to pump to at the pump temperature, see {@link PUMP_FLOOR_PSI}.
   * `unreachable`: even the floor goes over a maximum on the ride, so there is no pressure to pump to.
   */
  clamped: 'min' | 'max' | 'pump-floor' | 'unreachable' | null;
  /** The limits that applied; displayed values are rounded within them. */
  limits: PsiLimits;
  /** What to pump to at the pump temperature: the same as above without a temperature difference. */
  pump: { psi: number; bar: number; limits: PsiLimits };
}

export interface Warning {
  level: 'info' | 'warn' | 'danger';
  /** Wheels the warning is about; empty for general advice. */
  wheels: Wheel[];
  message: string;
}

export interface PressureResult {
  front: WheelResult;
  rear: WheelResult;
  totalKg: number;
  multiplier: number;
  /** The temperatures the pump values are corrected for; null when there is no difference. */
  temperature: Temperatures | null;
  warnings: Warning[];
}

export function wheelLoads(
  input: Pick<PressureInput, 'riderKg' | 'bikeKg' | 'gearKg' | 'frontShare' | 'trailerTongueKg' | 'rearBagsKg'>,
): { front: number; rear: number; total: number } {
  const system = input.riderKg + input.bikeKg + input.gearKg;
  const front = system * input.frontShare;
  const rear = system * (1 - input.frontShare) + input.trailerTongueKg + input.rearBagsKg;
  return { front, rear, total: front + rear };
}

export function effectiveWidth(nominalWidthMm: number, innerRimMm: number): number {
  return nominalWidthMm + RIM.widthGainPerMm * (innerRimMm - RIM.referenceInnerWidth(nominalWidthMm));
}

/**
 * How much more pressure a wheel with this bead seat diameter needs than a 700c one with the
 * same tire, for the same tire drop: 1 at 622 mm, more on smaller wheels. See WHEEL.
 */
export function wheelSizeFactor(bsdMm: number, effectiveWidthMm: number): number {
  const tireHeight = WHEEL.heightPerWidth * effectiveWidthMm;
  return ((WHEEL.referenceBsdMm + 2 * tireHeight) / (bsdMm + 2 * tireHeight)) ** WHEEL.exponent;
}

/** Pressure (psi) for a 15% tire drop at this wheel load and effective width, on a 700c wheel by default. */
export function basePressurePsi(loadKg: number, effectiveWidthMm: number, bsdMm: number = WHEEL.referenceBsdMm): number {
  return ((BASE.k * loadKg ** BASE.a) / effectiveWidthMm ** BASE.b) * wheelSizeFactor(bsdMm, effectiveWidthMm);
}

/**
 * Tire drop is roughly inversely proportional to pressure for a given load
 * (the contact patch area scales with load / pressure).
 */
export function estimateDrop(basePsi: number, psi: number): number {
  return (BASE.targetDrop * basePsi) / psi;
}

export function conditionMultiplier(input: Pick<PressureInput, 'surface' | 'wet' | 'tubeless'>): number {
  return SURFACE[input.surface] * (input.wet ? CONDITIONS.wet : 1) * (input.tubeless ? 1 : CONDITIONS.tube);
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function assertInput(input: PressureInput): void {
  const checks: [string, number][] = [
    ['rider weight', input.riderKg],
    ['bike weight', input.bikeKg],
    ['front tire width', input.frontWidthMm],
    ['rear tire width', input.rearWidthMm],
    ['inner rim width', input.innerRimMm],
    ['wheel size', input.wheelBsdMm],
  ];
  for (const [name, value] of checks) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid ${name}: ${value}`);
  }
  if (!Number.isFinite(input.gearKg) || input.gearKg < 0) throw new RangeError(`Invalid gear weight: ${input.gearKg}`);
  if (!(input.frontShare > 0 && input.frontShare < 1)) throw new RangeError(`Invalid front share: ${input.frontShare}`);
  if (!(input.trailerTongueKg >= 0) || !(input.rearBagsKg >= 0)) throw new RangeError('Invalid extra load');
  const t = input.temperature;
  if (t && ![t.pumpC, t.rideC].every((c) => Number.isFinite(c) && c > -100 && c < 100)) {
    throw new RangeError(`Invalid temperatures: ${t.pumpC}, ${t.rideC}`);
  }
}

/** The temperatures to correct for, or null if they are the same. */
function temperatureDifference(input: Pick<PressureInput, 'temperature'>): Temperatures | null {
  const t = input.temperature;
  return t && t.pumpC !== t.rideC ? { pumpC: t.pumpC, rideC: t.rideC } : null;
}

type LimitInput = Pick<PressureInput, 'hookless' | 'tireMinPsi' | 'tireMaxPsi' | 'rimMaxPsi'>;

/** The lowest applicable maximum: `name` names the limit, `reason` explains a cap. */
export function maxPsi(input: LimitInput): { psi: number; name: string; reason: string } | null {
  const candidates: { psi: number; name: string; reason: string }[] = [];
  if (input.hookless) {
    candidates.push({ psi: LIMITS.hooklessMaxPsi, name: 'the 5 bar hookless limit', reason: 'hookless rims are limited to 5 bar' });
  }
  if (positive(input.rimMaxPsi)) candidates.push({ psi: input.rimMaxPsi, name: 'the rim maximum', reason: 'the rim maximum' });
  if (positive(input.tireMaxPsi)) candidates.push({ psi: input.tireMaxPsi, name: 'the tire maximum', reason: 'the tire maximum' });
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.psi < a.psi ? b : a));
}

/** A message if the tire minimum is above the applicable maximum, null otherwise. */
export function limitConflict(input: LimitInput): string | null {
  const max = maxPsi(input);
  if (!max || !positive(input.tireMinPsi) || input.tireMinPsi <= max.psi) return null;
  return (
    `The tire minimum (${formatPsi(input.tireMinPsi)} psi) is above ${max.name} ` +
    `(${formatPsi(max.psi, { minPsi: null, maxPsi: max.psi })} psi). Either the tire doesn't suit this rim or a limit is wrong. Check the bike's limits.`
  );
}

const LABEL: Record<Wheel, string> = { front: 'Front', rear: 'Rear' };
const WHEELS: readonly Wheel[] = ['front', 'rear'];

interface WheelCalc {
  result: WheelResult;
  limitReason: string | null;
}

/**
 * The lowest pump pressure we recommend. Pumping cold for a hot ride can need less than nothing:
 * an empty tire already reads a few psi once it warms up.
 */
export const PUMP_FLOOR_PSI = 1;

/** What the displayed (rounded) pump value reads at the ride temperature, in psi. */
export function rideReadingPsi(wheel: WheelResult, t: Temperatures): number {
  return ridePsi(Number(formatPsi(wheel.pump.psi, wheel.pump.limits)), t);
}

function computeWheel(loadKg: number, nominalWidthMm: number, input: PressureInput, multiplier: number): WheelCalc {
  const widthMm = effectiveWidth(nominalWidthMm, input.innerRimMm);
  const basePsi = basePressurePsi(loadKg, widthMm, input.wheelBsdMm);
  let psi = basePsi * multiplier;
  let clamped: WheelResult['clamped'] = null;
  let limitReason: string | null = null;

  const t = temperatureDifference(input);
  const toPump = (p: number) => (t ? pumpPsi(p, t) : p);
  const min = positive(input.tireMinPsi) ? input.tireMinPsi : null;
  const max = maxPsi(input);
  // A maximum holds both when pumping and when riding: whichever is warmer reaches it first.
  const rideMax = max && t ? Math.min(max.psi, ridePsi(max.psi, t)) : (max?.psi ?? null);
  if (min !== null && psi < min) {
    psi = min;
    clamped = 'min';
    limitReason = 'the tire minimum';
  }
  if (t && toPump(psi) < PUMP_FLOOR_PSI) {
    psi = ridePsi(PUMP_FLOOR_PSI, t);
    clamped = 'pump-floor';
    limitReason = null;
  }
  // Applied last: if the limits conflict, never go above a maximum.
  if (max && rideMax !== null && psi > rideMax) {
    psi = rideMax;
    clamped = 'max';
    limitReason = !t
      ? max.reason
      : t.rideC > t.pumpC
        ? `${max.reason}, reached as the tire warms up to ${formatCelsius(t.rideC)}`
        : `${max.reason}, reached when pumping at ${formatCelsius(t.pumpC)}`;
  }
  if (t && max && rideMax !== null && toPump(rideMax) < PUMP_FLOOR_PSI) {
    clamped = 'unreachable';
    limitReason = max.name;
  }

  const drop = estimateDrop(basePsi, psi);
  const limits = { minPsi: min, maxPsi: rideMax };
  const pump = toPump(psi);
  const pumpMin = t ? Math.max(PUMP_FLOOR_PSI, min === null ? 0 : toPump(min)) : min;
  const pumpLimits = { minPsi: pumpMin, maxPsi: rideMax === null ? null : toPump(rideMax) };
  return {
    result: {
      loadKg,
      effectiveWidthMm: widthMm,
      wheelSizeFactor: wheelSizeFactor(input.wheelBsdMm, widthMm),
      basePsi,
      psi,
      bar: psiToBar(psi),
      drop,
      clamped,
      limits,
      pump: { psi: pump, bar: psiToBar(pump), limits: pumpLimits },
    },
    limitReason,
  };
}

/** "Front", "Rear" or "Both tires"; one sentence per group of wheels with the same issue. */
function subject(wheels: readonly Wheel[]): string {
  return wheels.length === 2 ? 'Both tires' : LABEL[wheels[0]!];
}

/** Groups wheels that share the same key so front and rear don't repeat the same message. */
function groupBy(wheels: readonly Wheel[], key: (w: Wheel) => string): Wheel[][] {
  const groups = new Map<string, Wheel[]>();
  for (const w of wheels) {
    const k = key(w);
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }
  return [...groups.values()];
}

function wheelWarnings(calc: Record<Wheel, WheelCalc>, input: PressureInput): Warning[] {
  const warnings: Warning[] = [];
  const t = temperatureDifference(input);
  /** The pressure to pump to, as shown in the result. */
  const shown = (w: Wheel) => formatPsi(calc[w].result.pump.psi, calc[w].result.pump.limits);
  const dropLimit = input.tubeless ? LIMITS.maxDropWarning : LIMITS.maxDropWarningTube;
  const risk = input.tubeless ? 'rim strikes' : 'pinch flats';
  const dropPct = (wheels: readonly Wheel[]) => Math.round(Math.max(...wheels.map((w) => calc[w].result.drop)) * 100);
  const tooSoft = (w: Wheel) => calc[w].result.drop > dropLimit;

  const capped = WHEELS.filter((w) => calc[w].result.clamped === 'max');
  // Only when the temperatures cause it: a conflict between the bike's own limits is flagged on its own.
  const belowMin = (w: Wheel) =>
    t !== null && limitConflict(input) === null && positive(input.tireMinPsi) && calc[w].result.psi < input.tireMinPsi;
  for (const group of groupBy(capped, (w) => `${shown(w)}|${calc[w].limitReason}|${belowMin(w)}`)) {
    const first = group[0]!;
    const soft = group.filter(tooSoft);
    warnings.push({
      level: 'danger',
      wheels: group,
      message:
        `${subject(group)} capped at ${shown(first)} psi: ${calc[first].limitReason}. ` +
        (belowMin(first) ? `That is below the tire minimum at ${formatCelsius(t!.rideC)}. ` : '') +
        (soft.length ? `That leaves ~${dropPct(soft)}% tire drop, so expect ${risk}. ` : '') +
        (belowMin(first) ? 'Pump closer to the ride temperature, or check the tire and rim limits.' : 'Use a wider tire or carry less.'),
    });
  }

  const raised = WHEELS.filter((w) => calc[w].result.clamped === 'min');
  for (const group of groupBy(raised, shown)) {
    const { psi, limits } = calc[group[0]!].result;
    warnings.push({
      level: 'warn',
      wheels: group,
      message: t
        ? `${subject(group)} raised to ${shown(group[0]!)} psi: the tire minimum of ${formatPsi(psi, limits)} psi at ${formatCelsius(t.rideC)}.`
        : `${subject(group)} raised to the tire minimum of ${formatPsi(psi, limits)} psi.`,
    });
  }

  const floored = WHEELS.filter((w) => calc[w].result.clamped === 'pump-floor');
  const reads = (w: Wheel) => formatPsi(calc[w].result.psi, calc[w].result.limits);
  for (const group of groupBy(floored, reads)) {
    warnings.push({
      level: 'danger',
      wheels: group,
      message:
        `${subject(group)} too soft to pump at ${formatCelsius(t!.pumpC)}: even ${PUMP_FLOOR_PSI} psi there reads ${reads(group[0]!)} psi ` +
        `at ${formatCelsius(t!.rideC)}, above the target. Pump closer to the ride temperature.`,
    });
  }

  const unreachable = WHEELS.filter((w) => calc[w].result.clamped === 'unreachable');
  for (const group of groupBy(unreachable, (w) => calc[w].limitReason ?? '')) {
    warnings.push({
      level: 'danger',
      wheels: group,
      message:
        `${subject(group)} can't be pumped at ${formatCelsius(t!.pumpC)}: even ${PUMP_FLOOR_PSI} psi there goes over ` +
        `${calc[group[0]!].limitReason} at ${formatCelsius(t!.rideC)}. Pump closer to the ride temperature.`,
    });
  }

  const soft = WHEELS.filter((w) => !['max', 'unreachable'].includes(calc[w].result.clamped ?? '') && tooSoft(w));
  if (soft.length) {
    warnings.push({
      level: 'warn',
      wheels: soft,
      message: `${soft.length === 2 ? 'Both tires compress' : `${LABEL[soft[0]!]} tire compresses`} ~${dropPct(soft)}%: risk of ${risk} on hard hits.`,
    });
  }

  const low = WHEELS.filter(
    (w) => calc[w].result.clamped === null && !tooSoft(w) && calc[w].result.psi < LIMITS.lowPsiWarning,
  );
  if (low.length) {
    warnings.push({
      level: 'info',
      wheels: low,
      message: `${subject(low)}: very low pressure, check the tire's printed minimum.`,
    });
  }
  return warnings;
}

export function computePressure(input: PressureInput): PressureResult {
  assertInput(input);
  const loads = wheelLoads(input);
  const multiplier = conditionMultiplier(input);

  const calc: Record<Wheel, WheelCalc> = {
    front: computeWheel(loads.front, input.frontWidthMm, input, multiplier),
    rear: computeWheel(loads.rear, input.rearWidthMm, input, multiplier),
  };
  const front = calc.front.result;
  const rear = calc.rear.result;
  const warnings: Warning[] = [];
  const conflict = limitConflict(input);
  if (conflict) warnings.push({ level: 'danger', wheels: [], message: conflict });
  warnings.push(...wheelWarnings(calc, input));

  if (input.hookless && !input.tubeless) {
    warnings.push({
      level: 'info',
      wheels: [],
      message: 'Hookless rims need hookless-approved tubeless-ready tires, even when running a tube.',
    });
  }
  if (input.frontShare < LIMITS.frontShareMin || input.frontShare > LIMITS.frontShareMax) {
    warnings.push({
      level: 'info',
      wheels: [],
      message: `Front share of ${Math.round(input.frontShare * 100)}% is unusual (most bikes: 40–45%).`,
    });
  }

  return { front, rear, totalKg: loads.total, multiplier, temperature: temperatureDifference(input), warnings };
}
