import { WHEEL, type Surface } from '../model/coefficients';
import { computePressure, limitConflict, rideReadingPsi, type PressureResult, type WheelResult } from '../model/pressure';
import {
  LOAD_LIMITS,
  PROFILE_LIMITS,
  WHEEL_SIZES,
  blankProfile,
  wheelSizeName,
  activeLoads,
  hitchKg,
  toPressureInput,
  type Profile,
  type RideSettings,
} from '../model/profile';
import type { ShellyConfig } from '../model/shelly';
import { formatCelsius, type Temperatures } from '../model/temperature';
import { formatBar, formatKg, formatPsi } from '../model/units';
import {
  alertBox,
  appBar,
  iconButton,
  optionalNumber,
  row,
  section,
  segmented,
  stepper,
  switchRow,
  textField,
} from './components';
import { h, icon } from './dom';
import { endVisit, rideVisit, shellyAction, weatherAction, type LookupTarget, type TempKey } from './lookups';

export interface App {
  profiles(): Profile[];
  profile(id: string): Profile | undefined;
  ride(profile: Profile): RideSettings;
  setRide(id: string, ride: RideSettings): void;
  saveProfile(profile: Profile): void;
  deleteProfile(id: string): void;
  exportData(): void;
  importData(file: File): Promise<void>;
  navigate(hash: string): void;
  up(hash: string): void;
  replace(hash: string): void;
  newId(): string;
  /** The Shelly Cloud sensor for the pump temperature, kept apart from the bikes. */
  shelly(): ShellyConfig | null;
  /** Returns false (after telling the user) when it could not be saved. */
  setShelly(config: ShellyConfig | null): boolean;
  /** The user said no to location access, so the weather is only looked up on a tap. */
  locationDeclined(): boolean;
  setLocationDeclined(declined: boolean): void;
}

const SURFACE_ITEMS: { value: Surface; label: string; sub: string; summary: string }[] = [
  { value: 'smooth', label: 'Smooth', sub: 'tarmac', summary: 'Smooth tarmac' },
  { value: 'worn', label: 'Worn', sub: 'tarmac', summary: 'Worn tarmac' },
  { value: 'rough', label: 'Rough', sub: 'chipseal', summary: 'Rough tarmac' },
  { value: 'hardpack', label: 'Hardpack', sub: 'gravel', summary: 'Hardpack gravel' },
  { value: 'loose', label: 'Loose', sub: 'gravel', summary: 'Loose gravel' },
  { value: 'rocky', label: 'Rocky', sub: 'loose stones', summary: 'Rocky path' },
];

const README_URL = 'https://github.com/redsun82/tire-pressure#how-the-pressure-is-calculated';

/** Joins summary parts so lines only break between parts, never inside "24 mm hookless". */
function summary(...parts: string[]): string {
  return parts.map((part) => part.replaceAll(' ', '\u00a0')).join(' · ');
}

/** "44 mm · tubes", with the wheel size first unless it's the usual 700c: "20″ · 44 mm · tubes". */
function tireSummary(p: Profile): string {
  const widths = p.frontWidthMm === p.rearWidthMm ? `${p.frontWidthMm} mm` : `${p.frontWidthMm}/${p.rearWidthMm} mm`;
  const wheel = p.wheelBsdMm === WHEEL.referenceBsdMm ? [] : [wheelSizeName(p.wheelBsdMm)];
  return summary(...wheel, widths, p.tubeless ? 'tubeless' : 'tubes');
}

function rimSummary(p: Profile): string {
  return summary(`${p.innerRimMm} mm ${p.hookless ? 'hookless' : 'hooked'} rim`);
}

function riderSummary(p: Profile): string {
  return `${p.riderName || 'Rider'} · ${formatKg(p.riderKg)} kg`;
}

function safeCompute(profile: Profile, ride: RideSettings): PressureResult | null {
  try {
    return computePressure(toPressureInput(profile, ride));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bike list

export function listView(app: App): Node {
  endVisit();
  const profiles = app.profiles();
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) await app.importData(file);
    },
  });

  const cards = profiles.map((p) => {
    const result = safeCompute(p, app.ride(p));
    return h(
      'a',
      {
        class: 'bike-card',
        href: `#/ride/${encodeURIComponent(p.id)}`,
        onclick: (event: Event) => {
          event.preventDefault();
          app.navigate(`#/ride/${encodeURIComponent(p.id)}`);
        },
      },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, icon('bike')),
      h(
        'span',
        { class: 'bike-text' },
        h('span', { class: 'bike-name' }, p.name || 'Unnamed bike'),
        h('span', { class: 'bike-details' }, riderSummary(p)),
        h('span', { class: 'bike-details' }, tireSummary(p)),
        h('span', { class: 'bike-details' }, rimSummary(p)),
      ),
      result ? pressurePreview(result) : null,
      h('span', { class: 'chevron', 'aria-hidden': 'true' }, icon('chevron')),
    );
  });

  return h(
    'div',
    { class: 'screen' },
    appBar({ title: 'Tire pressure' }),
    h(
      'main',
      { class: 'content' },
      cards.length
        ? h('div', { class: 'bike-list' }, ...cards)
        : h('div', { class: 'empty card' }, h('p', null, 'No bikes yet. Add one for each family member and bike.')),
      h(
        'button',
        { class: 'btn btn-tonal btn-block', type: 'button', onclick: () => app.navigate('#/new') },
        icon('add'),
        'Add a bike',
      ),
      section(
        'Backup',
        h('p', { class: 'card-text' }, 'Bikes are stored on this device only. Export them to move to another phone.'),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn btn-outline', type: 'button', onclick: () => app.exportData() }, icon('download'), 'Export'),
          h('button', { class: 'btn btn-outline', type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Import'),
        ),
        fileInput,
      ),
      h(
        'p',
        { class: 'footnote' },
        'Estimates based on the 15% tire drop rule. ',
        h('a', { href: README_URL, target: '_blank', rel: 'noopener' }, 'How it works'),
      ),
    ),
  );
}

/** "pump at 20 °C": what the pump values are for, when they differ from the ride values. */
function pumpAt(t: Temperatures): string {
  return `pump at ${formatCelsius(t.pumpC)}`;
}

/** "pump at 20 °C for a 5 °C ride". */
function forRide(t: Temperatures): string {
  return `${pumpAt(t)} for a ${formatCelsius(t.rideC)} ride`;
}

const NO_VALUE = '\u2014';

/** The pressure to pump to, or a dash when there is none (see the warnings). */
function pumpValue(wheel: WheelResult, barDecimals?: number): { psi: string; bar: string } {
  if (wheel.clamped === 'unreachable') return { psi: NO_VALUE, bar: NO_VALUE };
  return { psi: formatPsi(wheel.pump.psi, wheel.pump.limits), bar: formatBar(wheel.pump.bar, wheel.pump.limits, barDecimals) };
}

/** "50/52 psi" over "3.4/3.6 bar": front/rear pressure to pump to, for the bike list. */
function pressurePreview({ front, rear, temperature }: PressureResult): HTMLElement {
  const { psi: fp, bar: fb } = pumpValue(front, 1);
  const { psi: rp, bar: rb } = pumpValue(rear, 1);
  const side = (psi: string, bar: string) => (psi === NO_VALUE ? 'no pressure' : `${psi} psi (${bar} bar)`);
  const label = `Front ${side(fp, fb)}, rear ${side(rp, rb)}`;
  return h(
    'span',
    {
      class: 'bike-preview',
      'aria-label': temperature ? `${label}, to ${forRide(temperature)}` : label,
    },
    h('strong', null, `${fp}/${rp}`, h('small', null, ' psi')),
    h('small', null, `${fb}/${rb} bar`),
    // Short, so the bike name keeps its room: the aria-label and the ride screen spell it out.
    temperature ? h('small', { class: 'bike-preview-temp' }, `pump ${formatCelsius(temperature.pumpC)}`) : null,
  );
}

// ---------------------------------------------------------------------------
// Ride: result + per-ride inputs

/** The big numbers are what to pump to; with a temperature difference, a line says what the shown value reads on the ride. */
function wheelBlock(label: string, wheel: WheelResult, temperature: Temperatures | null): HTMLElement {
  const value = pumpValue(wheel);
  return h(
    'div',
    { class: `wheel${wheel.clamped ? ' wheel-clamped' : ''}` },
    h('div', { class: 'wheel-label' }, label),
    h(
      'div',
      { class: 'psi' },
      h('span', { class: 'psi-num' }, value.psi),
      h('span', { class: 'psi-unit' }, 'psi'),
    ),
    h('div', { class: 'bar' }, `${value.bar} bar`),
    temperature && wheel.clamped !== 'unreachable'
      ? h('div', { class: 'wheel-ride' }, `reads ${formatPsi(rideReadingPsi(wheel, temperature))} psi at ${formatCelsius(temperature.rideC)}`)
      : null,
    h('div', { class: 'wheel-meta' }, `${formatKg(wheel.loadKg)} kg · ${Math.round(wheel.drop * 100)}% drop`),
  );
}

function resultCard(result: PressureResult | null, profile: Profile, ride: RideSettings): HTMLElement {
  if (!result) {
    return h('section', { class: 'result' }, h('p', { class: 'result-error' }, 'Check the bike settings: some values are invalid.'));
  }
  const surface = SURFACE_ITEMS.find((s) => s.value === ride.surface)?.summary ?? '';
  const loads = activeLoads(profile, ride);
  const extras = [loads.trailer ? 'trailer' : null, loads.bags ? 'bags' : null].filter(Boolean).join(' + ');
  const t = result.temperature;
  return h(
    'section',
    { class: 'result', 'aria-label': t ? `Pressure to ${forRide(t)}` : 'Recommended pressure' },
    wheelBlock('Front', result.front, t),
    h('div', { class: 'result-divider', 'aria-hidden': 'true' }),
    wheelBlock('Rear', result.rear, t),
    h(
      'div',
      { class: 'result-foot' },
      t ? h('strong', { class: 'result-pump-at' }, `Pump at ${formatCelsius(t.pumpC)} for a ${formatCelsius(t.rideC)} ride`) : null,
      [surface, ride.wet ? 'wet' : 'dry', profile.tubeless ? 'tubeless' : 'tubes', extras || null, `${formatKg(result.totalKg)} kg`]
        .filter(Boolean)
        .join(' · '),
    ),
  );
}

/** "F 25 · R 32 psi": the big numbers in one line, for when the card is scrolled away. */
function compactResult(result: PressureResult | null): Node[] {
  if (!result) return [h('span', null, 'Check the bike settings')];
  const { front, rear, temperature } = result;
  const [f, r] = [pumpValue(front), pumpValue(rear)];
  return [
    h('span', { class: 'mini-psi' }, `F ${f.psi} · R ${r.psi}`, h('small', null, ' psi')),
    h(
      'span',
      { class: 'mini-bar' },
      `${f.bar} · ${r.bar} bar`,
      temperature ? h('small', { class: 'mini-temp' }, pumpAt(temperature)) : null,
    ),
  ];
}

export function rideView(app: App, profile: Profile): Node {
  let ride = app.ride(profile);
  // The live region persists; only its contents are replaced, so screen readers announce updates.
  const resultSlot = h('div', { class: 'result-slot', 'aria-live': 'polite' });
  const alerts = h('div', { class: 'alerts' });
  const mini = h('button', {
    type: 'button',
    class: 'mini-result',
    'aria-label': 'Scroll up to the result',
    onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
  });
  const miniWrap = h('div', { class: 'mini-wrap' }, mini);

  function update() {
    app.setRide(profile.id, ride);
    for (const refresh of subs) refresh();
    const result = safeCompute(profile, ride);
    resultSlot.replaceChildren(resultCard(result, profile, ride));
    mini.replaceChildren(...compactResult(result));
    alerts.replaceChildren(...(result?.warnings ?? []).map((w) => alertBox(w.level, w.message)));
  }

  const surface = segmented<Surface>({
    label: 'Surface',
    items: SURFACE_ITEMS,
    value: ride.surface,
    className: 'segmented-surface',
    onChange: (value) => {
      ride = { ...ride, surface: value };
      update();
    },
  });

  const conditions = segmented<'dry' | 'wet'>({
    label: 'Conditions',
    items: [
      { value: 'dry', label: 'Dry' },
      { value: 'wet', label: 'Wet' },
    ],
    value: ride.wet ? 'wet' : 'dry',
    onChange: (value) => {
      ride = { ...ride, wet: value === 'wet' };
      update();
    },
  });

  /** Switch subtitles that depend on the current ride, refreshed on every change. */
  const subs: (() => void)[] = [];

  const loadStepper = (label: string, key: 'gearKg' | 'trailerKg' | 'bagsKg', step: number) =>
    stepper({
      label,
      value: ride[key],
      ...LOAD_LIMITS[key],
      step,
      unit: 'kg',
      onChange: (value) => {
        ride = { ...ride, [key]: value };
        update();
      },
    });

  /** A load switch with its weight stepper underneath. The weight is kept while the switch is off. */
  const loadToggle = (
    label: string,
    key: 'trailer' | 'bags',
    weight: { label: string; key: 'trailerKg' | 'bagsKg'; step: number; hint?: string },
    sub: () => string,
  ) => {
    const details = h('div', { class: 'reveal', hidden: !ride[key] }, row(weight.label, loadStepper(weight.label, weight.key, weight.step), weight.hint));
    const toggle = switchRow({
      label,
      sub: sub(),
      checked: ride[key],
      onChange: (checked) => {
        ride = { ...ride, [key]: checked };
        details.hidden = !checked;
        update();
      },
    });
    subs.push(() => toggle.setSub(sub()));
    return [toggle.el, details];
  };

  const trailer = loadToggle(
    'Kid trailer',
    'trailer',
    { label: 'Trailer + child', key: 'trailerKg', step: 1 },
    () => `+${formatKg(hitchKg(profile, ride))} kg on the rear (${profile.trailerTonguePct}% hitch load)`,
  );
  const bags = loadToggle(
    'Rear bags',
    'bags',
    { label: 'Bag weight', key: 'bagsKg', step: 0.5 },
    () => `+${formatKg(ride.bagsKg)} kg on the rear`,
  );
  const gear = loadStepper('Gear', 'gearKg', 0.5);

  /** Remembered while the user stays on this bike, so coming back from a sub-screen doesn't look up again. */
  const temps = rideVisit(profile.id);
  const tempStepper = (label: string, key: TempKey) => {
    const el = stepper({
      label,
      value: ride[key],
      ...LOAD_LIMITS[key],
      step: 1,
      unit: '°C',
      onChange: (value) => {
        temps[key].edits++;
        ride = { ...ride, [key]: value };
        update();
      },
    });
    // Typing counts even before it makes a valid value, such as a lone "-".
    el.addEventListener('input', () => temps[key].edits++);
    return el;
  };
  const tempSub = () => {
    if (!ride.temperature) return 'Pumping indoors for a cold ride, or the other way round';
    if (ride.pumpC === ride.rideC) return 'Same temperature: no correction';
    return `Pump at ${formatCelsius(ride.pumpC)} for a ${formatCelsius(ride.rideC)} ride`;
  };
  const pumpStepper = tempStepper('Pump temperature', 'pumpC');
  const rideStepper = tempStepper('Ride temperature', 'rideC');
  /** Applies a looked-up temperature as if typed, as the whole degree within range. */
  const fill = (key: TempKey, el: ReturnType<typeof stepper>): LookupTarget => ({
    apply: (tempC) => {
      const value = Math.min(LOAD_LIMITS[key].max, Math.max(LOAD_LIMITS[key].min, Math.round(tempC))) || 0;
      el.setValue?.(value);
      ride = { ...ride, [key]: value };
      update();
      return value;
    },
    memo: temps[key],
    enabled: () => ride.temperature,
  });
  const pumpLookup = shellyAction(app, fill('pumpC', pumpStepper));
  const rideLookup = weatherAction(app, fill('rideC', rideStepper));
  const lookUpTemperatures = () => {
    pumpLookup.auto();
    rideLookup.auto();
  };
  const tempDetails = h(
    'div',
    { class: 'reveal reveal-temp', hidden: !ride.temperature },
    row('Pumping at', pumpStepper, 'Where you inflate'),
    pumpLookup.el,
    row('Riding at', rideStepper, 'Outside, on the ride'),
    rideLookup.el,
  );
  const tempToggle = switchRow({
    label: 'Correct for temperature',
    sub: tempSub(),
    checked: ride.temperature,
    onChange: (checked) => {
      ride = { ...ride, temperature: checked };
      tempDetails.hidden = !checked;
      update();
      if (checked) lookUpTemperatures();
    },
  });
  subs.push(() => tempToggle.setSub(tempSub()));

  update();
  if (ride.temperature) lookUpTemperatures();

  const bar = appBar({
    title: profile.name || 'Unnamed bike',
    subtitle: riderSummary(profile),
    leading: iconButton('back', 'All bikes', () => app.up('#/')),
    actions: [iconButton('edit', 'Edit bike', () => app.navigate(`#/edit/${encodeURIComponent(profile.id)}`))],
    below: miniWrap,
  });

  // Slide the compact result in once the big psi numbers are hidden under the app bar.
  let frame = 0;
  const onScroll = () => {
    if (!bar.isConnected) {
      window.removeEventListener('scroll', onScroll);
      return;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const card = resultSlot.firstElementChild;
      const numbersBottom = card?.querySelector('.psi')?.getBoundingClientRect().bottom ?? Infinity;
      miniWrap.classList.toggle('shown', numbersBottom < bar.getBoundingClientRect().bottom);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  return h(
    'div',
    { class: 'screen' },
    bar,
    h(
      'main',
      { class: 'content' },
      resultSlot,
      alerts,
      section('Surface', surface, h('div', { class: 'spacer' }), conditions),
      section(
        'Load',
        row('Gear', gear, 'Bottles, tools'),
        profile.canTowTrailer || profile.canCarryBags
          ? h('div', { class: 'switch-list' }, ...(profile.canTowTrailer ? trailer : []), ...(profile.canCarryBags ? bags : []))
          : null,
      ),
      section('Temperature', h('div', { class: 'switch-list' }, tempToggle.el, tempDetails)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Edit / new bike

export function editView(app: App, existing: Profile | undefined): Node {
  const isNew = !existing;
  const draft: Profile = structuredClone(existing ?? blankProfile(app.newId()));
  const nameField = textField({
    label: 'Bike name',
    value: draft.name,
    placeholder: 'e.g. Grizl, kids MTB',
    onInput: (v) => {
      draft.name = v;
      nameField.el.classList.remove('field-error');
    },
  });
  const riderField = textField({
    label: 'Name',
    value: draft.riderName,
    placeholder: 'e.g. Me, Anna',
    onInput: (v) => (draft.riderName = v),
  });

  const num = (
    label: string,
    key: 'riderKg' | 'bikeKg' | 'frontWidthMm' | 'rearWidthMm' | 'innerRimMm' | 'frontSharePct' | 'trailerTonguePct',
    step: number,
    unit: string,
    hint?: string,
  ) =>
    row(
      label,
      stepper({ label, value: draft[key], ...PROFILE_LIMITS[key], step, unit, onChange: (v) => (draft[key] = v) }),
      hint,
    );

  const limitsError = h('div', { class: 'reveal', hidden: true });
  const limitInputs: Partial<Record<'tireMinPsi' | 'tireMaxPsi' | 'rimMaxPsi', HTMLElement>> = {};
  const limitRow = (label: string, key: 'tireMinPsi' | 'tireMaxPsi' | 'rimMaxPsi') => {
    const field = optionalNumber({
      label,
      value: draft[key],
      unit: 'psi',
      ...PROFILE_LIMITS.psi,
      onChange: (v) => {
        draft[key] = v;
        checkLimits();
      },
    });
    limitInputs[key] = field;
    return row(label, field);
  };
  /** Shows why the limits can't be saved; returns false if they conflict. */
  function checkLimits(): boolean {
    const conflict = limitConflict(draft);
    limitsError.replaceChildren(...(conflict ? [alertBox('danger', conflict)] : []));
    limitsError.hidden = !conflict;
    limitInputs.tireMinPsi?.classList.toggle('field-error', conflict !== null);
    return conflict === null;
  }

  const hitchDetails = h(
    'div',
    { class: 'reveal', hidden: !draft.canTowTrailer },
    num('Hitch load', 'trailerTonguePct', 1, '%', 'Of trailer + child, on the rear wheel'),
  );
  const trailerSwitch = switchRow({
    label: 'Can tow a kid trailer',
    sub: 'Hitch on the rear axle',
    checked: draft.canTowTrailer,
    onChange: (checked) => {
      draft.canTowTrailer = checked;
      hitchDetails.hidden = !checked;
    },
  });
  const bagsSwitch = switchRow({
    label: 'Can carry rear bags',
    sub: 'Rack or seat pack, on the rear wheel',
    checked: draft.canCarryBags,
    onChange: (checked) => (draft.canCarryBags = checked),
  });

  function save() {
    draft.name = draft.name.trim();
    draft.riderName = draft.riderName.trim();
    if (!draft.name) {
      nameField.el.classList.add('field-error');
      nameField.input.focus();
      return;
    }
    if (!checkLimits()) {
      limitsError.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    app.saveProfile(draft);
    if (isNew) app.replace(`#/ride/${encodeURIComponent(draft.id)}`);
    else app.up(`#/ride/${encodeURIComponent(draft.id)}`);
  }

  const cancelTarget = isNew ? '#/' : `#/ride/${encodeURIComponent(draft.id)}`;

  return h(
    'div',
    { class: 'screen screen-form' },
    appBar({
      title: isNew ? 'New bike' : 'Edit bike',
      leading: iconButton('back', 'Cancel', () => app.up(cancelTarget)),
      actions: isNew
        ? []
        : [
            iconButton('delete', 'Delete bike', () => {
              if (confirm(`Delete “${existing.name || 'this bike'}”?`)) {
                app.deleteProfile(existing.id);
                app.replace('#/');
              }
            }),
          ],
    }),
    h(
      'main',
      { class: 'content' },
      section(
        'Rider',
        riderField.el,
        num('Rider weight', 'riderKg', 0.5, 'kg'),
      ),
      section(
        'Bike',
        nameField.el,
        num('Bike weight', 'bikeKg', 0.1, 'kg'),
        num('Weight on front', 'frontSharePct', 1, '%', 'Typically 40–45%'),
      ),
      section(
        'Tires & rims',
        h('div', { class: 'field-label' }, 'Wheel size'),
        segmented<string>({
          label: 'Wheel size',
          items: WHEEL_SIZES.map((w) => ({
            value: String(w.bsdMm),
            label: w.name,
            sub: w.alias ? `${w.alias} · ${w.bsdMm}` : String(w.bsdMm),
          })),
          value: String(draft.wheelBsdMm),
          className: 'segmented-wheel',
          onChange: (v) => (draft.wheelBsdMm = Number(v)),
        }),
        h('p', { class: 'card-text' }, 'The second number on the tire, e.g. 47-622 is 700c.'),
        num('Front tire', 'frontWidthMm', 1, 'mm'),
        num('Rear tire', 'rearWidthMm', 1, 'mm'),
        num('Inner rim width', 'innerRimMm', 0.5, 'mm'),
        h('div', { class: 'field-label' }, 'Setup'),
        segmented<'tubeless' | 'tubes'>({
          label: 'Setup',
          items: [
            { value: 'tubeless', label: 'Tubeless' },
            { value: 'tubes', label: 'Tubes' },
          ],
          value: draft.tubeless ? 'tubeless' : 'tubes',
          onChange: (v) => (draft.tubeless = v === 'tubeless'),
        }),
        h('div', { class: 'field-label' }, 'Rim'),
        segmented<'hooked' | 'hookless'>({
          label: 'Rim type',
          items: [
            { value: 'hooked', label: 'Hooked' },
            { value: 'hookless', label: 'Hookless' },
          ],
          value: draft.hookless ? 'hookless' : 'hooked',
          onChange: (v) => {
            draft.hookless = v === 'hookless';
            checkLimits();
          },
        }),
        h('p', { class: 'card-text' }, 'Hookless rims are capped at 5 bar (72.5 psi).'),
      ),
      section(
        'Limits (optional)',
        h('p', { class: 'card-text' }, 'Printed on the tire sidewall or in the rim manual. Leave empty if unknown.'),
        limitRow('Tire max', 'tireMaxPsi'),
        limitRow('Tire min', 'tireMinPsi'),
        limitRow('Rim max', 'rimMaxPsi'),
        limitsError,
      ),
      section(
        'Loads',
        h('p', { class: 'card-text' }, 'Show these on the ride screen. Their weights are set per ride.'),
        h('div', { class: 'switch-list' }, trailerSwitch.el, hitchDetails, bagsSwitch.el),
      ),
    ),
    h(
      'div',
      { class: 'bottom-bar' },
      h('div', { class: 'bottom-bar-inner' },
        h('button', { class: 'btn btn-text', type: 'button', onclick: () => app.up(cancelTarget) }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, isNew ? 'Add bike' : 'Save'),
      ),
    ),
  );
}

