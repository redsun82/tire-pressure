import type { Surface } from '../model/coefficients';
import { computePressure, limitConflict, type PressureResult, type WheelResult } from '../model/pressure';
import {
  LOAD_LIMITS,
  PROFILE_LIMITS,
  blankProfile,
  activeLoads,
  hitchKg,
  toPressureInput,
  type Profile,
  type RideSettings,
} from '../model/profile';
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
}

const SURFACE_ITEMS: { value: Surface; label: string; sub: string; summary: string }[] = [
  { value: 'smooth', label: 'Smooth', sub: 'tarmac', summary: 'Smooth tarmac' },
  { value: 'worn', label: 'Worn', sub: 'tarmac', summary: 'Worn tarmac' },
  { value: 'rough', label: 'Rough', sub: 'chipseal', summary: 'Rough tarmac' },
  { value: 'hardpack', label: 'Hardpack', sub: 'gravel', summary: 'Hardpack gravel' },
  { value: 'loose', label: 'Loose', sub: 'gravel', summary: 'Loose gravel' },
];

const README_URL = 'https://github.com/redsun82/tire-pressure#how-the-pressure-is-calculated';

/** Joins summary parts so lines only break between parts, never inside "24 mm hookless". */
function summary(...parts: string[]): string {
  return parts.map((part) => part.replaceAll(' ', '\u00a0')).join(' · ');
}

function tireSummary(p: Profile): string {
  const widths = p.frontWidthMm === p.rearWidthMm ? `${p.frontWidthMm} mm` : `${p.frontWidthMm}/${p.rearWidthMm} mm`;
  return summary(widths, p.tubeless ? 'tubeless' : 'tubes');
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

/** "50/52 psi" over "3.4/3.6 bar": front/rear, for the bike list. */
function pressurePreview({ front, rear }: PressureResult): HTMLElement {
  const [fp, rp] = [front, rear].map((w) => formatPsi(w.psi, w.limits));
  const [fb, rb] = [front, rear].map((w) => formatBar(w.bar, w.limits, 1));
  return h(
    'span',
    { class: 'bike-preview', 'aria-label': `Front ${fp} psi (${fb} bar), rear ${rp} psi (${rb} bar)` },
    h('strong', null, `${fp}/${rp}`, h('small', null, ' psi')),
    h('small', null, `${fb}/${rb} bar`),
  );
}

// ---------------------------------------------------------------------------
// Ride: result + per-ride inputs

function wheelBlock(label: string, wheel: WheelResult): HTMLElement {
  return h(
    'div',
    { class: `wheel${wheel.clamped ? ' wheel-clamped' : ''}` },
    h('div', { class: 'wheel-label' }, label),
    h(
      'div',
      { class: 'psi' },
      h('span', { class: 'psi-num' }, formatPsi(wheel.psi, wheel.limits)),
      h('span', { class: 'psi-unit' }, 'psi'),
    ),
    h('div', { class: 'bar' }, `${formatBar(wheel.bar, wheel.limits)} bar`),
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
  return h(
    'section',
    { class: 'result', 'aria-live': 'polite', 'aria-label': 'Recommended pressure' },
    wheelBlock('Front', result.front),
    h('div', { class: 'result-divider', 'aria-hidden': 'true' }),
    wheelBlock('Rear', result.rear),
    h(
      'div',
      { class: 'result-foot' },
      [surface, ride.wet ? 'wet' : 'dry', profile.tubeless ? 'tubeless' : 'tubes', extras || null, `${formatKg(result.totalKg)} kg`]
        .filter(Boolean)
        .join(' · '),
    ),
  );
}

/** "F 25 · R 32 psi": the result in one line, for when the big card is scrolled away. */
function compactResult(result: PressureResult | null): Node[] {
  if (!result) return [h('span', null, 'Check the bike settings')];
  const { front, rear } = result;
  return [
    h(
      'span',
      { class: 'mini-psi' },
      `F ${formatPsi(front.psi, front.limits)} · R ${formatPsi(rear.psi, rear.limits)}`,
      h('small', null, ' psi'),
    ),
    h('span', { class: 'mini-bar' }, `${formatBar(front.bar, front.limits)} · ${formatBar(rear.bar, rear.limits)} bar`),
  ];
}

export function rideView(app: App, profile: Profile): Node {
  let ride = app.ride(profile);
  const resultSlot = h('div', { class: 'result-slot' });
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

  update();

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

