import { LookupError, STALE_AFTER_MS, formatAge, type Reading } from '../model/lookup';
import { normalizeDeviceId, normalizeServer, readShelly, type ShellyConfig } from '../model/shelly';
import { formatCelsius } from '../model/temperature';
import { WEATHER_ATTRIBUTION, currentPosition, readWeather } from '../model/weather';
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

/**
 * A button that looks a temperature up and applies it, with a status line underneath.
 * `apply` returns the value actually set, which differs when the reading is out of range.
 */
export function lookupAction(options: {
  label: string;
  icon: IconName;
  read: () => Promise<Reading>;
  apply: (tempC: number) => number;
  /** Status after a successful read, e.g. "Shelly sensor: 21.4 °C, now." */
  done: (reading: string) => (Node | string)[];
  extra?: Node;
}): HTMLElement {
  const status = h('p', { class: 'temp-status', 'aria-live': 'polite' });
  const label = h('span', null, options.label);
  const button = h('button', { type: 'button', class: 'btn btn-outline btn-compact' }, icon(options.icon), label);
  button.addEventListener('click', async () => {
    button.disabled = true;
    label.textContent = 'Reading…';
    status.className = 'temp-status';
    status.replaceChildren();
    try {
      const reading = await options.read();
      const set = options.apply(reading.tempC);
      const { text, stale } = describe(reading);
      const notes: string[] = [];
      if (set !== Math.round(reading.tempC)) notes.push(` Set to ${formatCelsius(set)}, the nearest supported.`);
      if (stale) notes.push(' This reading is old: is the sensor online?');
      status.classList.toggle('temp-status-warn', stale);
      status.replaceChildren(...options.done(text), ...notes);
    } catch (error) {
      status.classList.add('temp-status-error');
      status.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
      label.textContent = options.label;
    }
  });
  return h('div', { class: 'temp-source' }, h('div', { class: 'temp-source-actions' }, button, options.extra ?? null), status);
}

/** Pump temperature from a Shelly sensor, or a way to set one up. */
export function shellyAction(app: App, apply: (tempC: number) => number): HTMLElement {
  const config = app.shelly();
  if (!config) {
    return h(
      'div',
      { class: 'temp-source' },
      h(
        'div',
        { class: 'temp-source-actions' },
        h('button', { type: 'button', class: 'btn btn-text btn-compact', onclick: () => app.navigate('#/sensor') }, icon('thermostat'), 'Read from a Shelly sensor…'),
      ),
    );
  }
  return lookupAction({
    label: 'Read Shelly sensor',
    icon: 'thermostat',
    read: () => readShelly(config),
    apply,
    done: (reading) => [`Shelly sensor: ${reading}.`],
    extra: iconButton('tune', 'Shelly sensor setup', () => app.navigate('#/sensor')),
  });
}

/** Ride temperature from the weather where the user is now. */
export function weatherAction(apply: (tempC: number) => number): HTMLElement {
  return lookupAction({
    label: 'Use local weather',
    icon: 'location',
    read: async () => {
      const { latitude, longitude } = await currentPosition();
      return readWeather(latitude, longitude);
    },
    apply,
    done: (reading) => [
      `Near you: ${reading}. Weather data by `,
      h('a', { href: WEATHER_ATTRIBUTION.url, target: '_blank', rel: 'noopener' }, WEATHER_ATTRIBUTION.name),
      '.',
    ],
  });
}

// ---------------------------------------------------------------------------
// Shelly sensor setup

export function sensorView(app: App): Node {
  const existing = app.shelly();
  const draft = { server: existing?.server.replace(/^https:\/\//, '') ?? '', authKey: existing?.authKey ?? '', deviceId: existing?.deviceId ?? '' };

  const server = textField({
    label: 'Server',
    value: draft.server,
    placeholder: 'shelly-103-eu.shelly.cloud',
    verbatim: true,
    maxLength: 200,
    onInput: (v) => {
      draft.server = v;
      server.el.classList.remove('field-error');
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
      key.el.classList.remove('field-error');
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
      device.el.classList.remove('field-error');
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
      field.el.dataset.error = empty ? 'required' : error;
    }
    const invalid = fields.find(([, value]) => !value);
    if (invalid) {
      invalid[0].input.focus();
      return null;
    }
    return config as ShellyConfig;
  }

  const testStatus = h('p', { class: 'temp-status', 'aria-live': 'polite' });
  const testButton = h('button', { type: 'button', class: 'btn btn-outline btn-block' }, 'Test');
  testButton.addEventListener('click', async () => {
    const config = validate();
    if (!config) return;
    testButton.disabled = true;
    testStatus.className = 'temp-status';
    testStatus.textContent = 'Reading…';
    try {
      const { text, stale } = describe(await readShelly(config));
      testStatus.classList.toggle('temp-status-warn', stale);
      testStatus.textContent = `Works: ${text}.${stale ? ' This reading is old: is the sensor online?' : ''}`;
    } catch (error) {
      testStatus.classList.add('temp-status-error');
      testStatus.textContent = errorMessage(error);
    } finally {
      testButton.disabled = false;
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
