import { BASE, CONDITIONS, LIMITS, RIM, SURFACE, type Surface } from './coefficients';
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
}

export interface WheelResult {
  loadKg: number;
  effectiveWidthMm: number;
  /** 15% drop pressure before surface/conditions/limits. */
  basePsi: number;
  /** Recommended pressure after multipliers and limits. */
  psi: number;
  bar: number;
  /** Estimated tire drop at the recommended pressure (fraction). */
  drop: number;
  clamped: 'min' | 'max' | null;
  /** The limits that applied; displayed values are rounded within them. */
  limits: PsiLimits;
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

/** Pressure (psi) for a 15% tire drop at this wheel load and effective width. */
export function basePressurePsi(loadKg: number, effectiveWidthMm: number): number {
  return (BASE.k * loadKg ** BASE.a) / effectiveWidthMm ** BASE.b;
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
  ];
  for (const [name, value] of checks) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Invalid ${name}: ${value}`);
  }
  if (!Number.isFinite(input.gearKg) || input.gearKg < 0) throw new RangeError(`Invalid gear weight: ${input.gearKg}`);
  if (!(input.frontShare > 0 && input.frontShare < 1)) throw new RangeError(`Invalid front share: ${input.frontShare}`);
  if (!(input.trailerTongueKg >= 0) || !(input.rearBagsKg >= 0)) throw new RangeError('Invalid extra load');
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

function computeWheel(loadKg: number, nominalWidthMm: number, input: PressureInput, multiplier: number): WheelCalc {
  const widthMm = effectiveWidth(nominalWidthMm, input.innerRimMm);
  const basePsi = basePressurePsi(loadKg, widthMm);
  let psi = basePsi * multiplier;
  let clamped: WheelResult['clamped'] = null;
  let limitReason: string | null = null;

  const min = positive(input.tireMinPsi) ? input.tireMinPsi : null;
  const max = maxPsi(input);
  if (min !== null && psi < min) {
    psi = min;
    clamped = 'min';
    limitReason = 'the tire minimum';
  }
  // Applied last: if the limits conflict, never go above a maximum.
  if (max && psi > max.psi) {
    psi = max.psi;
    clamped = 'max';
    limitReason = max.reason;
  }

  const drop = estimateDrop(basePsi, psi);
  const limits = { minPsi: min, maxPsi: max?.psi ?? null };
  return {
    result: { loadKg, effectiveWidthMm: widthMm, basePsi, psi, bar: psiToBar(psi), drop, clamped, limits },
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
  const dropLimit = input.tubeless ? LIMITS.maxDropWarning : LIMITS.maxDropWarningTube;
  const risk = input.tubeless ? 'rim strikes' : 'pinch flats';
  const dropPct = (wheels: readonly Wheel[]) => Math.round(Math.max(...wheels.map((w) => calc[w].result.drop)) * 100);
  const tooSoft = (w: Wheel) => calc[w].result.drop > dropLimit;

  const capped = WHEELS.filter((w) => calc[w].result.clamped === 'max');
  for (const group of groupBy(capped, (w) => `${calc[w].result.psi}|${calc[w].limitReason}`)) {
    const { psi } = calc[group[0]!].result;
    const soft = group.filter(tooSoft);
    warnings.push({
      level: 'danger',
      wheels: group,
      message:
        `${subject(group)} capped at ${formatPsi(psi, calc[group[0]!].result.limits)} psi: ${calc[group[0]!].limitReason}. ` +
        (soft.length ? `That leaves ~${dropPct(soft)}% tire drop, so expect ${risk}. ` : '') +
        'Use a wider tire or carry less.',
    });
  }

  const raised = WHEELS.filter((w) => calc[w].result.clamped === 'min');
  for (const group of groupBy(raised, (w) => String(calc[w].result.psi))) {
    warnings.push({
      level: 'warn',
      wheels: group,
      message: `${subject(group)} raised to the tire minimum of ${formatPsi(calc[group[0]!].result.psi, calc[group[0]!].result.limits)} psi.`,
    });
  }

  const soft = WHEELS.filter((w) => calc[w].result.clamped !== 'max' && tooSoft(w));
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

  return { front, rear, totalKg: loads.total, multiplier, warnings };
}
