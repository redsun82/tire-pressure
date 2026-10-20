import { LookupError, STALE_AFTER_MS, formatAge, type Reading } from '../model/lookup';
import { normalizeDeviceId, normalizeServer, readShelly, type ShellyConfig } from '../model/shelly';
import { formatCelsius } from '../model/temperature';
import {
  LocationDeniedError,
  WEATHER_ATTRIBUTION,
  currentPosition,
  locationPermission,
  mayLocateUntapped,
  readWeather,
} from '../model/weather';
import { alertBox, appBar, iconButton, section, textField } from './components';
import { h, icon, type IconName } from './dom';
import type { App } from './views';

/** "21.4 °C": readings keep a decimal, unlike the whole-degree steppers. */
function formatReading(tempC: number): string {
  return formatCelsius(Math.round(tempC * 10) / 10 || 0);
}

/** "21.4 °C, 12 min ago", flagging old readings. */
function describe(reading: Reading, now = new Date()): { text: string; stale: boolean } {
  if (!reading.measuredAt) return { text: formatReading(reading.tempC), stale: false };
  const stale = now.getTime() - reading.measuredAt.getTime() > STALE_AFTER_MS;
  return { text: `${formatReading(reading.tempC)}, ${formatAge(reading.measuredAt, now)}`, stale };
}

function errorMessage(error: unknown): string {
  return error instanceof LookupError ? error.message : 'Something went wrong. Set the temperature by hand.';
}

/** The line next to a lookup button: what was read, or why not. */
interface Status {
  text: string;
  /** Failures of a tap are flagged; those of a lookup the user didn't ask for stay quiet. */
  tone?: 'warn' | 'error';
  /** Credits the weather service. */
  attribution?: boolean;
}

/** A lookup under way. It outlives the ride screen being rebuilt, and the rebuilt screen applies it. */
interface Pending {
  reading: Promise<Reading>;
  /** The user's edit count when it started. */
  edits: number;
  auto: boolean;
}

/** Forgets what was read from another source, such as a sensor the user replaced. */
function useSource(memo: TempMemo, source: string): void {
  if (memo.source === source) return;
  Object.assign(memo, { source, pending: null, status: null, autoStarted: false });
}

/** What the ride screen remembers about one temperature while the user stays on a bike, sub-screens included. */
export interface TempMemo {
  /** The user's own changes: a lookup never overwrites one, and none starts without a tap after one. */
  edits: number;
  /** Once per visit is enough for a lookup without a tap. */
  autoStarted: boolean;
  pending: Pending | null;
  /** Lookups started in this visit, so one without a tap gives way to a tap made while it waited. */
  started: number;
  status: Status | null;
  /** Where the pending lookup and the status come from. */
  source: string;
  /** The latest ride screen built for this temperature, which shows lookups and their outcome. */
  view: { settle: (pending: Pending) => void; show: (status: Status) => void; enabled: () => boolean } | null;
}

export type TempKey = 'pumpC' | 'rideC';

let visit: { profileId: string; temps: Record<TempKey, TempMemo> } | null = null;

/** Starts a visit to a bike's ride screen, or continues it when back from editing the bike or the sensor. */
export function rideVisit(profileId: string): Record<TempKey, TempMemo> {
  if (visit?.profileId !== profileId) {
    const memo = (): TempMemo => ({ edits: 0, autoStarted: false, pending: null, started: 0, status: null, source: '', view: null });
    visit = { profileId, temps: { pumpC: memo(), rideC: memo() } };
  }
  return visit.temps;
}

/** Back on the bike list: the next visit to a bike looks its temperatures up afresh. */
export function endVisit(): void {
  visit = null;
}

function inVisit(memo: TempMemo): boolean {
  return visit?.temps.pumpC === memo || visit?.temps.rideC === memo;
}

/** Where a looked-up temperature goes. */
export interface LookupTarget {
  /** Sets the temperature, returning the value actually set: it differs when the reading is out of range. */
  apply: (tempC: number) => number;
  memo: TempMemo;
  /** Whether the temperature correction is on: lookups without a tap only start then. */
  enabled: () => boolean;
}

export interface Lookup {
  el: HTMLElement;
  /** Looks the temperature up without a tap, unless done already in this visit or the user set it. */
  auto: () => void;
}

function statusContent(status: Status): (Node | string)[] {
  if (!status.attribution) return [status.text];
  return [
    `${status.text} Weather data by `,
    h('a', { href: WEATHER_ATTRIBUTION.url, target: '_blank', rel: 'noopener' }, WEATHER_ATTRIBUTION.name),
    '.',
  ];
}

/** An icon button that looks a temperature up and applies it, with a status line next to it. */
export function lookupAction(options: {
  label: string;
  icon: IconName;
  /** Status while reading. */
  reading: string;
  read: () => Promise<Reading>;
  /** Identifies what is read: a pending lookup or status from another source is dropped. */
  source: string;
  target: LookupTarget;
  /** Status after a successful read, e.g. "Shelly sensor: 21.4 °C, now." */
  done: (reading: string) => Status;
  /** Whether a lookup may start without a tap, or else the quiet status saying why not. */
  untapped?: () => Promise<true | Status>;
  extra?: Node;
}): Lookup {
  const { memo } = options.target;
  useSource(memo, options.source);
  const status = h('p', { class: 'temp-status', 'aria-live': 'polite' });
  const button = h(
    'button',
    { type: 'button', class: 'icon-btn temp-read', 'aria-label': options.label, title: options.label },
    icon(options.icon),
  );

  function show(next: Status) {
    status.className = next.tone ? `temp-status temp-status-${next.tone}` : 'temp-status';
    status.replaceChildren(...statusContent(next));
  }
  function remember(next: Status) {
    memo.status = next;
    show(next);
  }

  async function settle(pending: Pending) {
    button.disabled = true;
    show({ text: options.reading });
    try {
      const reading = await pending.reading;
      // The ride screen was left meanwhile: applying would save its outdated ride over newer
      // changes. A rebuilt screen of the same visit applies the reading instead, unless it dropped it.
      if (!button.isConnected || memo.pending !== pending) return;
      memo.pending = null;
      if (memo.edits !== pending.edits) {
        remember({ text: 'Kept the temperature you set meanwhile.' });
        return;
      }
      const set = options.target.apply(reading.tempC);
      const { text, stale } = describe(reading);
      const done = options.done(text);
      if (set !== Math.round(reading.tempC)) done.text += ` Set to ${formatCelsius(set)}, the nearest supported.`;
      if (stale) done.text += ' This reading is old: is the sensor online?';
      remember({ ...done, tone: stale ? 'warn' : undefined });
    } catch (error) {
      if (!button.isConnected || memo.pending !== pending) return;
      memo.pending = null;
      remember({ text: errorMessage(error), tone: pending.auto ? undefined : 'error' });
    } finally {
      button.disabled = false;
    }
  }

  function start(auto: boolean) {
    if (memo.pending) return;
    memo.started++;
    memo.pending = { reading: options.read(), edits: memo.edits, auto };
    memo.view?.settle(memo.pending);
  }
  button.addEventListener('click', () => start(false));

  // Called while the ride screen is being built, so it may not be in the page yet; and the user
  // may move to a sub-screen before it starts, whose way back shows the lookup.
  async function auto() {
    if (memo.autoStarted || memo.pending || memo.edits > 0) return;
    memo.autoStarted = true;
    const started = memo.started;
    const allowed = options.untapped ? await options.untapped() : true;
    if (!inVisit(memo) || memo.started !== started || memo.edits > 0) return;
    // Switched off meanwhile: switching it on again tries again.
    if (!memo.view?.enabled()) {
      memo.autoStarted = false;
      return;
    }
    if (allowed === true) start(true);
    else {
      memo.status = allowed;
      memo.view?.show(allowed);
    }
  }

  memo.view = { settle: (pending) => void settle(pending), show, enabled: options.target.enabled };
  if (memo.pending) void settle(memo.pending);
  else show(memo.status ?? { text: options.label });
  return {
    el: h('div', { class: 'temp-source' }, button, status, options.extra ?? null),
    auto: () => void auto(),
  };
}

/** Pump temperature from a Shelly sensor, or a way to set one up. */
export function shellyAction(app: App, target: LookupTarget): Lookup {
  const config = app.shelly();
  if (!config) {
    useSource(target.memo, '');
    target.memo.view = null;
    return {
      el: h(
        'div',
        { class: 'temp-source' },
        h('button', { type: 'button', class: 'btn btn-text btn-compact', onclick: () => app.navigate('#/sensor') }, icon('thermostat'), 'Read from a Shelly sensor…'),
      ),
      auto: () => {},
    };
  }
  return lookupAction({
    label: 'Read Shelly sensor',
    icon: 'thermostat',
    reading: 'Reading the Shelly sensor…',
    read: () => readShelly(config),
    source: `shelly:${JSON.stringify(config)}`,
    target,
    done: (reading) => ({ text: `Shelly sensor: ${reading}.` }),
    extra: iconButton('tune', 'Shelly sensor setup', () => app.navigate('#/sensor')),
  });
}

/** Ride temperature from the weather where the user is now. */
export function weatherAction(app: App, target: LookupTarget): Lookup {
  return lookupAction({
    label: 'Use local weather',
    icon: 'location',
    reading: 'Getting the local weather…',
    read: async () => {
      let position: GeolocationCoordinates;
      try {
        position = await currentPosition();
      } catch (error) {
        if (error instanceof LocationDeniedError) app.setLocationDeclined(true);
        throw error;
      }
      app.setLocationDeclined(false);
      return readWeather(position.latitude, position.longitude);
    },
    untapped: async () => {
      const permission = await locationPermission();
      if (mayLocateUntapped(permission, app.locationDeclined())) return true;
      return { text: permission === 'denied' ? 'Location access is off for this app.' : 'Tap to use the local weather.' };
    },
    source: 'weather',
    target,
    done: (reading) => ({ text: `Near you: ${reading}.`, attribution: true }),
  });
}

// ---------------------------------------------------------------------------
// Shelly sensor setup

export function sensorView(app: App): Node {
  const existing = app.shelly();
  const draft = { server: existing?.server.replace(/^https:\/\//, '') ?? '', authKey: existing?.authKey ?? '', deviceId: existing?.deviceId ?? '' };

  const testStatus = h('p', { class: 'temp-status', 'aria-live': 'polite' });
  const testButton = h('button', { type: 'button', class: 'btn btn-outline btn-block' }, 'Test');
  /** Bumped by every test and edit, so a result only shows for the fields it was tested with. */
  let attempt = 0;
  function edited(field: { el: HTMLElement }) {
    field.el.classList.remove('field-error');
    attempt++;
    testButton.disabled = false;
    testStatus.className = 'temp-status';
    testStatus.textContent = '';
  }

  const server = textField({
    label: 'Server',
    value: draft.server,
    placeholder: 'shelly-103-eu.shelly.cloud',
    verbatim: true,
    maxLength: 200,
    onInput: (v) => {
      draft.server = v;
      edited(server);
    },
  });
  const key = textField({
    label: 'Cloud key',
    value: draft.authKey,
    type: 'password',
    verbatim: true,
    maxLength: 500,
    onInput: (v) => {
      draft.authKey = v;
      edited(key);
    },
  });
  const device = textField({
    label: 'Device ID',
    value: draft.deviceId,
    placeholder: 'e4b063d1a2b4',
    verbatim: true,
    maxLength: 60,
    onInput: (v) => {
      draft.deviceId = v;
      edited(device);
    },
  });

  /** The config, or null after marking the fields that are wrong. */
  function validate(): ShellyConfig | null {
    const config = {
      server: normalizeServer(draft.server),
      authKey: draft.authKey.trim(),
      deviceId: normalizeDeviceId(draft.deviceId),
    };
    const fields = [
      [server, config.server, 'not a Shelly Cloud server'],
      [key, config.authKey, 'required'],
      [device, config.deviceId, 'not a device ID'],
    ] as const;
    for (const [field, value, error] of fields) {
      const empty = field.input.value.trim() === '';
      field.el.classList.toggle('field-error', !value);
      // On the label itself: its ::after reads the attribute, and attributes are not inherited.
      field.el.querySelector<HTMLElement>('.field-label')!.dataset.error = empty ? 'required' : error;
    }
    const invalid = fields.find(([, value]) => !value);
    if (invalid) {
      invalid[0].input.focus();
      return null;
    }
    return config as ShellyConfig;
  }

  testButton.addEventListener('click', async () => {
    const config = validate();
    if (!config) return;
    const mine = ++attempt;
    testButton.disabled = true;
    testStatus.className = 'temp-status';
    testStatus.textContent = 'Reading…';
    try {
      const { text, stale } = describe(await readShelly(config));
      if (mine !== attempt) return;
      testStatus.classList.toggle('temp-status-warn', stale);
      testStatus.textContent = `Works: ${text}.${stale ? ' This reading is old: is the sensor online?' : ''}`;
    } catch (error) {
      if (mine !== attempt) return;
      testStatus.classList.add('temp-status-error');
      testStatus.textContent = errorMessage(error);
    } finally {
      if (mine === attempt) testButton.disabled = false;
    }
  });

  const back = () => app.up('#/');
  function save() {
    const config = validate();
    if (config && app.setShelly(config)) back();
  }
  function remove() {
    if (confirm('Remove the Shelly sensor? Its cloud key is deleted from this device.') && app.setShelly(null)) back();
  }

  return h(
    'div',
    { class: 'screen screen-form' },
    appBar({
      title: 'Shelly sensor',
      leading: iconButton('back', 'Back', back),
      actions: existing ? [iconButton('delete', 'Remove sensor', remove)] : [],
    }),
    h(
      'main',
      { class: 'content' },
      section(
        'Shelly Cloud',
        h(
          'p',
          { class: 'card-text' },
          'Read the pump temperature from a Shelly H&T, or any Shelly with a temperature sensor, through Shelly Cloud. The sensor can stay on a network of its own.',
        ),
        server.el,
        key.el,
        device.el,
        h(
          'p',
          { class: 'card-text' },
          'In the Shelly app, User settings › Authorization cloud key shows the server and the key. The device ID is under the device’s Settings › Device information.',
        ),
        testButton,
        testStatus,
      ),
      alertBox(
        'info',
        'The cloud key can control every device on your Shelly account. It stays on this device, is never exported, and is only sent to Shelly Cloud.',
      ),
    ),
    h(
      'div',
      { class: 'bottom-bar' },
      h(
        'div',
        { class: 'bottom-bar-inner' },
        h('button', { class: 'btn btn-text', type: 'button', onclick: back }, 'Cancel'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Save'),
      ),
    ),
  );
}
