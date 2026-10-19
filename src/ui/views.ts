import type { Surface } from '../model/coefficients';
import { computePressure, type PressureResult, type WheelResult } from '../model/pressure';
import {
  blankProfile,
  toPressureInput,
  trailerTongueKg,
  type Profile,
  type RideSettings,
} from '../model/profile';
import { formatBar, formatKg, formatPsi, roundingFor } from '../model/units';
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
  return summary(widths, p.tubeless ? 'tubeless' : 'tubes', `${p.innerRimMm} mm ${p.hookless ? 'hookless' : 'rim'}`);
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
      ),
      result
        ? h(
            'span',
            { class: 'bike-preview', 'aria-label': `Front ${formatPsi(result.front.psi, roundingFor(result.front.clamped))} psi, rear ${formatPsi(result.rear.psi, roundingFor(result.rear.clamped))} psi` },
            h('strong', null, `${formatPsi(result.front.psi, roundingFor(result.front.clamped))}/${formatPsi(result.rear.psi, roundingFor(result.rear.clamped))}`),
            h('small', null, 'psi F/R'),
          )
        : null,
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
      h('span', { class: 'psi-num' }, formatPsi(wheel.psi, roundingFor(wheel.clamped))),
      h('span', { class: 'psi-unit' }, 'psi'),
    ),
    h('div', { class: 'bar' }, `${formatBar(wheel.bar, roundingFor(wheel.clamped))} bar`),
    h('div', { class: 'wheel-meta' }, `${formatKg(wheel.loadKg)} kg · ${Math.round(wheel.drop * 100)}% drop`),
  );
}

function resultCard(result: PressureResult | null, profile: Profile, ride: RideSettings): HTMLElement {
  if (!result) {
    return h('section', { class: 'result' }, h('p', { class: 'result-error' }, 'Check the bike settings: some values are invalid.'));
  }
  const surface = SURFACE_ITEMS.find((s) => s.value === ride.surface)?.summary ?? '';
  const extras = [ride.trailer ? 'trailer' : null, ride.bags ? 'bags' : null].filter(Boolean).join(' + ');
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

export function rideView(app: App, profile: Profile): Node {
  let ride = app.ride(profile);
  const resultSlot = h('div', { class: 'result-slot' });
  const alerts = h('div', { class: 'alerts' });

  function update() {
    app.setRide(profile.id, ride);
    const result = safeCompute(profile, ride);
    resultSlot.replaceChildren(resultCard(result, profile, ride));
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

  const loads: Node[] = [];
  if (profile.trailer) {
    const t = profile.trailer;
    loads.push(
      switchRow({
        label: 'Kid trailer',
        sub: `+${formatKg(trailerTongueKg(profile))} kg on the rear (${formatKg(t.totalKg)} kg × ${t.tonguePct}%)`,
        checked: ride.trailer,
        onChange: (checked) => {
          ride = { ...ride, trailer: checked };
          update();
        },
      }).el,
    );
  }
  if (profile.bags) {
    loads.push(
      switchRow({
        label: 'Rear bags',
        sub: `+${formatKg(profile.bags.kg)} kg on the rear`,
        checked: ride.bags,
        onChange: (checked) => {
          ride = { ...ride, bags: checked };
          update();
        },
      }).el,
    );
  }

  const gear = stepper({
    label: 'Extra gear today',
    value: ride.gearOffsetKg,
    min: -profile.gearKg,
    max: 30,
    step: 0.5,
    unit: 'kg',
    format: (v) => (v > 0 ? `+${formatKg(v)}` : formatKg(v)),
    onChange: (value) => {
      ride = { ...ride, gearOffsetKg: value };
      update();
    },
  });

  update();

  return h(
    'div',
    { class: 'screen' },
    appBar({
      title: profile.name || 'Unnamed bike',
      subtitle: riderSummary(profile),
      leading: iconButton('back', 'All bikes', () => app.up('#/')),
      actions: [iconButton('edit', 'Edit bike', () => app.navigate(`#/edit/${encodeURIComponent(profile.id)}`))],
    }),
    h(
      'main',
      { class: 'content' },
      resultSlot,
      alerts,
      section('Surface', surface, h('div', { class: 'spacer' }), conditions),
      loads.length ? section('Load', h('div', { class: 'switch-list' }, ...loads)) : null,
      section(null, row('Extra gear', gear, `Usual: ${formatKg(profile.gearKg)} kg`)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Edit / new bike

export function editView(app: App, existing: Profile | undefined): Node {
  const isNew = !existing;
  const draft: Profile = structuredClone(existing ?? blankProfile(app.newId()));
  const trailer = draft.trailer ?? { totalKg: 25, tonguePct: 10 };
  const bags = draft.bags ?? { kg: 6 };
  let hasTrailer = draft.trailer !== null;
  let hasBags = draft.bags !== null;

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
    key: 'riderKg' | 'bikeKg' | 'gearKg' | 'frontWidthMm' | 'rearWidthMm' | 'innerRimMm' | 'frontSharePct',
    min: number,
    max: number,
    step: number,
    unit: string,
    hint?: string,
  ) =>
    row(
      label,
      stepper({ label, value: draft[key], min, max, step, unit, onChange: (v) => (draft[key] = v) }),
      hint,
    );

  const trailerDetails = h(
    'div',
    { class: 'reveal', hidden: !hasTrailer },
    row(
      'Trailer + child',
      stepper({ label: 'Trailer + child', value: trailer.totalKg, min: 1, max: 100, step: 1, unit: 'kg', onChange: (v) => (trailer.totalKg = v) }),
    ),
    row(
      'Hitch load',
      stepper({ label: 'Hitch load', value: trailer.tonguePct, min: 0, max: 50, step: 1, unit: '%', onChange: (v) => (trailer.tonguePct = v) }),
      'On the rear wheel',
    ),
  );
  const bagDetails = h(
    'div',
    { class: 'reveal', hidden: !hasBags },
    row('Bag weight', stepper({ label: 'Bag weight', value: bags.kg, min: 0.5, max: 60, step: 0.5, unit: 'kg', onChange: (v) => (bags.kg = v) })),
  );

  function save() {
    draft.name = draft.name.trim();
    draft.riderName = draft.riderName.trim();
    if (!draft.name) {
      nameField.el.classList.add('field-error');
      nameField.input.focus();
      return;
    }
    draft.trailer = hasTrailer ? { ...trailer } : null;
    draft.bags = hasBags ? { ...bags } : null;
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
        num('Rider weight', 'riderKg', 10, 200, 0.5, 'kg'),
      ),
      section(
        'Bike',
        nameField.el,
        num('Bike weight', 'bikeKg', 2, 40, 0.1, 'kg'),
        num('Usual gear', 'gearKg', 0, 20, 0.5, 'kg', 'Bottles, tools, bags'),
        num('Weight on front', 'frontSharePct', 25, 60, 1, '%', 'Typically 40–45%'),
      ),
      section(
        'Tires & rims',
        num('Front tire', 'frontWidthMm', 18, 80, 1, 'mm'),
        num('Rear tire', 'rearWidthMm', 18, 80, 1, 'mm'),
        num('Inner rim width', 'innerRimMm', 12, 45, 0.5, 'mm'),
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
          onChange: (v) => (draft.hookless = v === 'hookless'),
        }),
        h('p', { class: 'card-text' }, 'Hookless rims are capped at 5 bar (72.5 psi).'),
      ),
      section(
        'Limits (optional)',
        h('p', { class: 'card-text' }, 'Printed on the tire sidewall or in the rim manual. Leave empty if unknown.'),
        row('Tire max', optionalNumber({ label: 'Tire max', value: draft.tireMaxPsi, unit: 'psi', min: 5, max: 200, onChange: (v) => (draft.tireMaxPsi = v) })),
        row('Tire min', optionalNumber({ label: 'Tire min', value: draft.tireMinPsi, unit: 'psi', min: 5, max: 200, onChange: (v) => (draft.tireMinPsi = v) })),
        row('Rim max', optionalNumber({ label: 'Rim max', value: draft.rimMaxPsi, unit: 'psi', min: 5, max: 200, onChange: (v) => (draft.rimMaxPsi = v) })),
      ),
      section(
        'Extra loads',
        switchRow({
          label: 'Kid trailer',
          sub: 'Hitched to the rear axle',
          checked: hasTrailer,
          onChange: (checked) => {
            hasTrailer = checked;
            trailerDetails.hidden = !checked;
          },
        }).el,
        trailerDetails,
        switchRow({
          label: 'Rear bags',
          sub: 'Panniers or rack bag',
          checked: hasBags,
          onChange: (checked) => {
            hasBags = checked;
            bagDetails.hidden = !checked;
          },
        }).el,
        bagDetails,
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

