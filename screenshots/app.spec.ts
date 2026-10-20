import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { computePressure } from '../src/model/pressure';
import { SEED_PROFILES, defaultRide, toPressureInput } from '../src/model/profile';
import { ridePsi } from '../src/model/temperature';
import { formatKg, formatPsi } from '../src/model/units';

/**
 * Design-review screenshots at the Pixel 10 Pro reference size (see playwright.config.ts).
 * Run with `npm run screenshots`; images are written to docs/screenshots/<theme>-<state>.png.
 *
 * The page is rendered as an installed (standalone) PWA would be on Android: edge to edge,
 * with a simulated status bar (top inset) and gesture bar (bottom inset) drawn on top.
 */

const STATUS_BAR = 40;
const GESTURE_BAR = 24;

const roboto = readFileSync(
  fileURLToPath(import.meta.resolve('@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2')),
).toString('base64');

const deviceChrome = `
@font-face {
  font-family: 'Screenshot Roboto';
  src: url(data:font/woff2;base64,${roboto}) format('woff2');
  font-weight: 100 900;
}
:root {
  --safe-top: ${STATUS_BAR}px !important;
  --safe-bottom: ${GESTURE_BAR}px !important;
}
*, *::before, *::after { font-family: 'Screenshot Roboto', sans-serif !important; }
#device-status, #device-gesture { position: fixed; left: 0; right: 0; z-index: 9999; pointer-events: none; }
#device-status {
  top: 0; height: ${STATUS_BAR}px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 28px; font: 500 14px 'Screenshot Roboto', sans-serif; color: CanvasText;
}
#device-status .icons { display: flex; gap: 6px; align-items: center; }
#device-status svg { display: block; width: 16px; height: 16px; fill: currentColor; }
#device-gesture { bottom: 0; height: ${GESTURE_BAR}px; display: grid; place-items: center; }
#device-gesture i { display: block; width: 108px; height: 4px; border-radius: 2px; background: CanvasText; opacity: .6; }
`;

async function dressAsDevice(page: Page) {
  await page.addStyleTag({ content: deviceChrome });
  await page.evaluate(() => {
    const status = document.createElement('div');
    status.id = 'device-status';
    status.innerHTML =
      '<span>9:41</span><span class="icons">' +
      '<svg viewBox="0 0 24 24"><path d="M12 21 1 8a16 16 0 0 1 22 0z"/></svg>' +
      '<svg viewBox="0 0 24 24"><path d="M2 22 22 2v20z"/></svg>' +
      '<svg viewBox="0 0 24 24"><path d="M8 4V2h8v2h2v18H6V4z"/></svg></span>';
    const gesture = document.createElement('div');
    gesture.id = 'device-gesture';
    gesture.innerHTML = '<i></i>';
    document.body.append(status, gesture);
  });
  await page.evaluate(() => document.fonts.ready);
}

async function open(page: Page, hash: string) {
  await page.goto(`./${hash}`);
  await dressAsDevice(page);
  await expect(page.locator('#app .screen')).toBeVisible();
}

async function shoot(page: Page, name: string) {
  const theme = test.info().project.name;
  await page.screenshot({ path: `docs/screenshots/${theme}-${name}.png`, animations: 'disabled' });
}

const SHELLY_STATUS = 'https://shelly-103-eu.shelly.cloud/device/status';
const cors = { 'access-control-allow-origin': '*' };

test.beforeEach(async ({ page }) => {
  // Lookups never reach real services; tests that need them route them (later routes win).
  await page.route(/^https:/, (route) => route.abort());
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('screenshots:init')) {
      localStorage.clear();
      sessionStorage.setItem('screenshots:init', '1');
    }
  });
});

test('profile list', async ({ page }) => {
  await open(page, '#/');
  await expect(page.locator('.bike-card')).toHaveCount(2);
  await shoot(page, '1-list');
});

test('Endurace on smooth tarmac', async ({ page }) => {
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('radio', { name: /Smooth/ }).click();
  await expect(page.locator('.psi-num').first()).toBeVisible();
  await shoot(page, '2-endurace-road');
});

test('Grizl on loose gravel with the trailer', async ({ page }) => {
  await open(page, '#/ride/seed-grizl');
  await page.getByRole('radio', { name: /Loose/ }).click();
  await page.getByRole('switch', { name: /Kid trailer/ }).click();
  await expect(page.getByRole('switch', { name: /Kid trailer/ })).toHaveAttribute('aria-checked', 'true');
  await shoot(page, '3-grizl-gravel-trailer');
});

test('Grizl on a rocky path', async ({ page }) => {
  await open(page, '#/ride/seed-grizl');
  await page.getByRole('radio', { name: /Hardpack/ }).click();
  const front = async () => Number(await page.locator('.psi-num').first().textContent());
  const hardpack = await front();
  await expect(page.getByText(/inserts/)).toBeHidden();
  await page.getByRole('radio', { name: /Rocky/ }).click();
  await expect(page.getByRole('radio', { name: /Rocky/ })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(front).toBeLessThan(hardpack);
  await expect(page.locator('.alert', { hasText: /inserts/ })).toBeVisible();
  await expect(page.locator('.alert')).toHaveCount(1);
  await expect(page.locator('.result-foot')).toContainText('Rocky path');
  await shoot(page, '11-grizl-rocky');
});

/** CSS px left above the Gboard keyboard (plus its nav row) on the Pixel 10 Pro. */
const ABOVE_KEYBOARD = 590;

test('Grizl with trailer and bags, editing the bag weight', async ({ page }) => {
  await open(page, '#/ride/seed-grizl');
  await page.getByRole('radio', { name: /Hardpack/ }).click();
  await page.getByRole('switch', { name: /Kid trailer/ }).click();
  await page.getByRole('switch', { name: /Rear bags/ }).click();
  const mini = page.getByRole('button', { name: 'Scroll up to the result' });
  await expect(mini).toBeHidden();

  // The keyboard covers the gesture bar and, with interactive-widget=resizes-content, shrinks the page.
  await page.addStyleTag({ content: ':root { --safe-bottom: 0px !important; } #device-gesture { display: none; }' });
  await page.setViewportSize({ width: 410, height: ABOVE_KEYBOARD });
  const bags = page.getByRole('textbox', { name: /Bag weight/ });
  await bags.focus();
  await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'end' }));
  await expect(mini).toBeVisible();
  await expect(mini).toContainText(/F \d+ · R \d+ psi/);
  const rear = async () => Number((await mini.textContent())?.match(/R (\d+)/)?.[1]);
  const before = await rear();
  await bags.fill('15');
  await expect.poll(rear).toBeGreaterThan(before);
  await bags.fill('8');
  await page.waitForTimeout(300);
  await shoot(page, '6-grizl-both-loads-keyboard');

  await mini.click();
  await expect(mini).toBeHidden();
});

test('Endurace on smooth tarmac in the wet', async ({ page }) => {
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('radio', { name: /Smooth/ }).click();
  await page.getByRole('radio', { name: /Wet/ }).click();
  await expect(page.getByRole('radio', { name: /Wet/ })).toHaveAttribute('aria-checked', 'true');
  await shoot(page, '7-endurace-wet');
});

test('the road bike has no trailer or bag rows', async ({ page }) => {
  await open(page, '#/ride/seed-endurace');
  await expect(page.getByRole('textbox', { name: /^Gear/ })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('switch', { name: /Correct for temperature/ })).toBeVisible();
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('switch', { name: /Can carry rear bags/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('switch', { name: /Rear bags/ })).toBeVisible();
  await expect(page.getByRole('switch', { name: /Kid trailer/ })).toHaveCount(0);
});

test('load weights survive toggling and reloads', async ({ page }) => {
  await open(page, '#/ride/seed-grizl');
  const trailer = page.getByRole('switch', { name: /Kid trailer/ });
  const weight = page.getByRole('textbox', { name: /Trailer \+ child/ });
  const gear = page.getByRole('textbox', { name: /^Gear/ });
  await expect(gear).toHaveValue('1');
  await expect(weight).toBeHidden();

  await trailer.click();
  await expect(weight).toHaveValue('25');
  await expect(trailer).toContainText('+2.5 kg on the rear');
  await weight.fill('30');
  await expect(trailer).toContainText('+3 kg on the rear');
  await trailer.click();
  await expect(weight).toBeHidden();
  await page.reload();
  await expect(trailer).toHaveAttribute('aria-checked', 'false');
  await trailer.click();
  await expect(weight).toHaveValue('30');
  await page.reload();
  await expect(trailer).toHaveAttribute('aria-checked', 'true');
  await expect(weight).toHaveValue('30');
});

test('Endurace pumped indoors for a cold ride', async ({ page, context }) => {
  await page.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ headers: cors, json: { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 5.2 } } }),
  );
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.46, longitude: 9.19 });
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('radio', { name: /Smooth/ }).click();
  const front = page.locator('.psi-num').first();
  const before = Number(await front.textContent());
  // Switching the correction on looks the ride temperature up.
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(page.getByRole('textbox', { name: /Ride temperature/ })).toHaveValue('5');
  await expect.poll(async () => Number(await front.textContent())).toBeGreaterThan(before);
  // The caption is what the displayed pump value reads on the ride, which rounds to about the target.
  const reads = Math.round(ridePsi(Number(await front.textContent()), { pumpC: 20, rideC: 5 }));
  expect(Math.abs(reads - before)).toBeLessThanOrEqual(1);
  await expect(page.locator('.wheel-ride').first()).toHaveText(`reads ${reads} psi at 5\u00a0°C`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, '8-endurace-temperature');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('.mini-wrap')).toHaveClass(/shown/);
  await page.waitForTimeout(300);
  await shoot(page, '8-endurace-temperature-inputs');
  await page.getByRole('button', { name: 'All bikes' }).click();
  await expect(page.locator('.bike-preview').first()).toContainText('pump 20\u00a0°C');
  await shoot(page, '8-list-temperature');
});

test('temperatures survive toggling and reloads', async ({ page }) => {
  await open(page, '#/ride/seed-endurace');
  const toggle = page.getByRole('switch', { name: /Correct for temperature/ });
  const pump = page.getByRole('textbox', { name: /Pump temperature/ });
  const rideTemp = page.getByRole('textbox', { name: /Ride temperature/ });
  const front = page.locator('.psi-num').first();
  const plain = await front.textContent();
  await expect(pump).toBeHidden();

  await toggle.click();
  await expect(pump).toHaveValue('20');
  await expect(rideTemp).toHaveValue('20');
  await expect(toggle).toContainText('Same temperature');
  await expect(front).toHaveText(plain!);
  await expect(page.locator('.wheel-ride')).toHaveCount(0);

  await page.getByRole('button', { name: 'Decrease Ride temperature' }).click();
  await expect(rideTemp).toHaveValue('19');
  await rideTemp.fill('-2');
  await pump.fill('22');
  await expect(toggle).toContainText('Pump at 22\u00a0°C for a \u22122\u00a0°C ride');
  await expect.poll(async () => Number(await front.textContent())).toBeGreaterThan(Number(plain));
  const pumped = Number(await front.textContent());
  const reads = Math.round(ridePsi(pumped, { pumpC: 22, rideC: -2 }));
  await expect(page.locator('.wheel-ride').first()).toHaveText(`reads ${reads} psi at \u22122\u00a0°C`);
  expect(pumped).toBeGreaterThan(Number(plain));
  // The compact result (hidden until the card scrolls away) shows the same pump values.
  await expect(page.locator('.mini-result')).toContainText(`F ${pumped} · R`);
  await expect(page.locator('.mini-result')).toContainText('pump at 22\u00a0°C');

  await toggle.click();
  await expect(pump).toBeHidden();
  await expect(front).toHaveText(plain!);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(front).toHaveText(plain!);
  await toggle.click();
  await expect(pump).toHaveValue('22');
  await expect(rideTemp).toHaveValue('-2');
  await expect(front).toHaveText(String(pumped));
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(rideTemp).toHaveValue('-2');
  await expect(front).toHaveText(String(pumped));
});

test('pump and ride temperatures from a Shelly sensor and the local weather', async ({ page, context }) => {
  const shellyBodies: string[] = [];
  await page.route(SHELLY_STATUS, (route) => {
    shellyBodies.push(route.request().postData() ?? '');
    const status = { 'temperature:0': { id: 0, tC: 21.4 }, sys: { unixtime: Math.floor(Date.now() / 1000) - 5 * 60 } };
    return route.fulfill({ headers: cors, json: { isok: true, data: { online: false, device_status: status } } });
  });
  const weatherUrls: URL[] = [];
  await page.route('https://api.open-meteo.com/**', (route) => {
    weatherUrls.push(new URL(route.request().url()));
    return route.fulfill({ headers: cors, json: { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 4.6 } } });
  });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.46427, longitude: 9.18951 });

  await open(page, '#/ride/seed-endurace');
  const pump = page.getByRole('textbox', { name: /Pump temperature/ });
  const rideTemp = page.getByRole('textbox', { name: /Ride temperature/ });
  // Switching the correction on looks the ride temperature up, without a tap.
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(rideTemp).toHaveValue('5');
  await expect(page.getByText(/Near you: 4\.6\u00a0°C, now\. Weather data by Open-Meteo\.com\./)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open-Meteo.com' })).toHaveAttribute('href', 'https://open-meteo.com/');
  // Only a position rounded to about 1 km leaves the device.
  expect(weatherUrls[0]!.searchParams.get('latitude')).toBe('45.46');
  expect(weatherUrls[0]!.searchParams.get('longitude')).toBe('9.19');
  // Without a sensor, there is nothing to read.
  await expect(pump).toHaveValue('20');
  expect(shellyBodies).toHaveLength(0);

  await page.getByRole('button', { name: 'Read from a Shelly sensor…' }).click();
  await expect(page).toHaveURL(/#\/sensor$/);
  await page.getByRole('textbox', { name: 'Server' }).fill('https://shelly-103-eu.shelly.cloud/');
  await page.getByLabel('Cloud key').fill('secret-key');
  await page.getByRole('textbox', { name: 'Device ID' }).fill('shellyhtg3-E4B063D1A2B4');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.locator('.temp-status')).toHaveText('Works: 21.4\u00a0°C, 5 min ago.');
  expect(new URLSearchParams(shellyBodies[0])).toEqual(new URLSearchParams({ id: 'e4b063d1a2b4', auth_key: 'secret-key' }));
  await shoot(page, '9-sensor-setup');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ride\/seed-endurace$/);

  // Back on the bike, the new sensor is read; the weather, already looked up, is not.
  await expect(pump).toHaveValue('21');
  await expect(page.getByText('Shelly sensor: 21.4\u00a0°C, 5 min ago.')).toBeVisible();
  await expect(page.getByText(/Near you: 4\.6\u00a0°C/)).toBeVisible();
  expect(shellyBodies).toHaveLength(2);
  expect(weatherUrls).toHaveLength(1);
  await expect(page.locator('.wheel-ride').first()).toContainText('at 5\u00a0°C');
  // The compact lookup line keeps its buttons clear of the stepper's.
  const plus = await page.getByRole('button', { name: 'Increase Pump temperature' }).boundingBox();
  const setup = await page.getByRole('button', { name: 'Shelly sensor setup' }).boundingBox();
  expect(setup!.y).toBeGreaterThanOrEqual(plus!.y + plus!.height);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await shoot(page, '9-temperature-lookup');

  // A tap reads again.
  await page.getByRole('button', { name: 'Read Shelly sensor' }).click();
  await expect.poll(() => shellyBodies.length).toBe(3);
  await page.getByRole('button', { name: 'Use local weather' }).click();
  await expect.poll(() => weatherUrls.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Use local weather' })).toBeEnabled();

  // Opening the app again looks both up afresh.
  await page.reload();
  await expect.poll(() => [shellyBodies.length, weatherUrls.length]).toEqual([4, 3]);
  await expect(page.getByText('Shelly sensor: 21.4\u00a0°C, 5 min ago.')).toBeVisible();
  await expect(pump).toHaveValue('21');
  await expect(rideTemp).toHaveValue('5');
  // The key has its own storage entry, so it never ends up in the bikes or their export.
  const stored = await page.evaluate(() => ({ bikes: localStorage.getItem('tire-pressure:v1'), shelly: localStorage.getItem('tire-pressure:shelly') }));
  expect(stored.bikes).not.toContain('secret-key');
  expect(JSON.parse(stored.shelly!)).toEqual({ server: 'https://shelly-103-eu.shelly.cloud', authKey: 'secret-key', deviceId: 'e4b063d1a2b4' });

  await page.getByRole('button', { name: 'Shelly sensor setup' }).click();
  await expect(page.getByRole('textbox', { name: 'Server' })).toHaveValue('shelly-103-eu.shelly.cloud');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove sensor' }).click();
  await expect(page).toHaveURL(/#\/ride\/seed-endurace$/);
  await expect(page.getByRole('button', { name: 'Read from a Shelly sensor…' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tire-pressure:shelly'))).toBeNull();
  expect(shellyBodies).toHaveLength(4);
});

test('temperatures are looked up once per visit, and never over the user’s', async ({ page, context }) => {
  let weather = 12;
  const weatherUrls: string[] = [];
  await page.route('https://api.open-meteo.com/**', (route) => {
    weatherUrls.push(route.request().url());
    return route.fulfill({ headers: cors, json: { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: weather } } });
  });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.46, longitude: 9.19 });
  await open(page, '#/ride/seed-endurace');
  const toggle = page.getByRole('switch', { name: /Correct for temperature/ });
  const rideTemp = page.getByRole('textbox', { name: /Ride temperature/ });
  await toggle.click();
  await expect(rideTemp).toHaveValue('12');
  await rideTemp.fill('5');
  await rideTemp.blur();
  weather = 14;

  // Not again on switching off and on, nor on coming back from editing the bike.
  await toggle.click();
  await toggle.click();
  await page.getByRole('button', { name: 'Edit bike' }).click();
  await expect(page).toHaveURL(/#\/edit\//);
  await page.goBack();
  await expect(rideTemp).toHaveValue('5');
  await page.waitForTimeout(300);
  await expect(rideTemp).toHaveValue('5');
  expect(weatherUrls).toHaveLength(1);

  // The next visit to the bike looks it up afresh.
  await page.getByRole('button', { name: 'All bikes' }).click();
  await page.locator('.bike-card', { hasText: 'Endurace' }).click();
  await expect(rideTemp).toHaveValue('14');
  expect(weatherUrls).toHaveLength(2);
});

test('temperature lookups explain what went wrong', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'tire-pressure:shelly',
      JSON.stringify({ server: 'https://shelly-103-eu.shelly.cloud', authKey: 'old-key', deviceId: 'e4b063d1a2b4' }),
    );
    // As when the user closes the browser's prompt: the permission stays "prompt".
    navigator.geolocation.getCurrentPosition = (_ok, fail) => {
      sessionStorage.setItem('locates', String(Number(sessionStorage.getItem('locates')) + 1));
      fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: 'denied' } as GeolocationPositionError);
    };
  });
  await page.route(SHELLY_STATUS, (route) =>
    route.fulfill({ status: 401, headers: cors, json: { isok: false, errors: { invalid_token: 'Invalid token' }, error: 'UNAUTHORIZED' } }),
  );
  const locates = () => page.evaluate(() => Number(sessionStorage.getItem('locates')));
  await open(page, '#/ride/seed-endurace');
  const [pumpStatus, rideStatus] = [page.locator('.temp-status').first(), page.locator('.temp-status').nth(1)];
  // Looked up without a tap, failures are a quiet line.
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(pumpStatus).toHaveText('Shelly Cloud rejected the cloud key. Check the sensor setup.');
  await expect(rideStatus).toHaveText(/^Location access is off for this app/);
  await expect(page.locator('.temp-status-error')).toHaveCount(0);
  await expect(page.locator('.alert')).toHaveCount(0);
  // Tapped, they are flagged.
  await page.getByRole('button', { name: 'Read Shelly sensor' }).click();
  await expect(pumpStatus).toHaveClass(/temp-status-error/);
  await expect(page.getByRole('textbox', { name: /Pump temperature/ })).toHaveValue('20');
  await expect(page.getByRole('textbox', { name: /Ride temperature/ })).toHaveValue('20');
  expect(await locates()).toBe(1);

  // Having said no, the user isn't asked again without a tap.
  await page.reload();
  await expect(rideStatus).toHaveText('Tap to use the local weather.');
  await expect(pumpStatus).toHaveText('Shelly Cloud rejected the cloud key. Check the sensor setup.');
  expect(await locates()).toBe(1);
  await page.getByRole('button', { name: 'Use local weather' }).click();
  await expect(rideStatus).toHaveText(/^Location access is off for this app/);
  await expect(rideStatus).toHaveClass(/temp-status-error/);
  expect(await locates()).toBe(2);

  // The key is only ever sent to Shelly Cloud.
  await page.getByRole('button', { name: 'Shelly sensor setup' }).click();
  await page.getByRole('textbox', { name: 'Server' }).fill('shelly.example.com');
  await page.getByRole('textbox', { name: 'Device ID' }).fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/sensor$/);
  await expect(page.locator('.field-error')).toHaveCount(2);
  // The reason is what the label actually shows.
  const reason = (field: string) =>
    page
      .locator('.field-error .field-label', { hasText: field })
      .evaluate((label) => getComputedStyle(label, '::after').content);
  await expect.poll(() => reason('Server')).toBe('" · not a Shelly Cloud server"');
  await expect.poll(() => reason('Device ID')).toBe('" · required"');
  await expect(page.getByRole('textbox', { name: 'Server' })).toBeFocused();
});

test('blocked location access is never asked for without a tap', async ({ page }) => {
  await page.addInitScript(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (descriptor) =>
      descriptor.name === 'geolocation' ? Promise.resolve({ state: 'denied' } as PermissionStatus) : query(descriptor);
    navigator.geolocation.getCurrentPosition = () => {
      throw new Error('asked for the position');
    };
  });
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(page.locator('.temp-status')).toHaveText('Location access is off for this app.');
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});

/** The location permission is only told once the test calls `answerPermission`; positions are counted. */
const HELD_PERMISSION = () => {
  const w = window as unknown as { answerPermission: () => void };
  const asked = new Promise<void>((resolve) => (w.answerPermission = resolve));
  const query = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (descriptor) =>
    descriptor.name === 'geolocation' ? asked.then(() => ({ state: 'prompt' }) as PermissionStatus) : query(descriptor);
  navigator.geolocation.getCurrentPosition = (ok) => {
    sessionStorage.setItem('locates', String(Number(sessionStorage.getItem('locates')) + 1));
    ok({ coords: { latitude: 45.46, longitude: 9.19 } } as GeolocationPosition);
  };
};
const answerPermission = (page: Page) => page.evaluate(() => (window as unknown as { answerPermission: () => void }).answerPermission());
const locates = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem('locates')));

test('switching the correction off before the location is asked for asks nothing', async ({ page }) => {
  await page.addInitScript(HELD_PERMISSION);
  await page.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ headers: cors, json: { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 12 } } }),
  );
  await open(page, '#/ride/seed-endurace');
  const toggle = page.getByRole('switch', { name: /Correct for temperature/ });
  await toggle.click();
  await toggle.click();
  await answerPermission(page);
  await page.waitForTimeout(200);
  expect(await locates(page)).toBe(0);
  // Switching it on again does look it up.
  await toggle.click();
  await expect(page.getByRole('textbox', { name: /Ride temperature/ })).toHaveValue('12');
  expect(await locates(page)).toBe(1);
});

test('a tap while the location permission is being checked is the only lookup', async ({ page }) => {
  await page.addInitScript(HELD_PERMISSION);
  const weatherUrls: string[] = [];
  await page.route('https://api.open-meteo.com/**', (route) => {
    weatherUrls.push(route.request().url());
    return route.fulfill({ headers: cors, json: { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 12 } } });
  });
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await page.getByRole('button', { name: 'Use local weather' }).click();
  await expect(page.getByText(/^Near you: 12\u00a0°C/)).toBeVisible();
  await answerPermission(page);
  await page.waitForTimeout(200);
  await expect(page.getByText(/^Near you: 12\u00a0°C/)).toBeVisible();
  expect(await locates(page)).toBe(1);
  expect(weatherUrls).toHaveLength(1);
});

test('a lookup never overwrites a temperature set while it was pending', async ({ page, context }) => {
  let respond!: () => void;
  let answered!: Promise<void>;
  const hold = () => (answered = new Promise<void>((resolve) => (respond = resolve)));
  hold();
  await page.route('https://api.open-meteo.com/**', async (route) => {
    await answered;
    await route.fulfill({ headers: cors, json: { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 12 } } });
  });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.46, longitude: 9.19 });
  await open(page, '#/ride/seed-endurace');
  const rideTemp = page.getByRole('textbox', { name: /Ride temperature/ });
  const weatherButton = page.getByRole('button', { name: 'Use local weather' });
  const reading = page.getByText('Getting the local weather…');
  let responded = page.waitForResponse('https://api.open-meteo.com/**');
  // The lookup that starts on switching the correction on.
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(reading).toBeVisible();
  await expect(weatherButton).toBeDisabled();
  await rideTemp.fill('5');
  await rideTemp.blur();
  respond();
  await responded;
  await expect(page.getByText('Kept the temperature you set meanwhile.')).toBeVisible();
  await expect(rideTemp).toHaveValue('5');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tire-pressure:v1')!).rides['seed-endurace']);
  expect(saved).toMatchObject({ temperature: true, pumpC: 20, rideC: 5 });
  // Nor one still being typed.
  hold();
  await weatherButton.click();
  await expect(reading).toBeVisible();
  await rideTemp.fill('-');
  respond();
  await expect(page.getByText('Kept the temperature you set meanwhile.')).toBeVisible();
  await expect(rideTemp).toHaveValue('-');
  await rideTemp.pressSequentially('3');
  await rideTemp.blur();
  await expect(rideTemp).toHaveValue('-3');
  // Editing the other temperature meanwhile does not block it.
  hold();
  responded = page.waitForResponse('https://api.open-meteo.com/**');
  await weatherButton.click();
  await expect(reading).toBeVisible();
  await page.getByRole('button', { name: 'Increase Pump temperature' }).click();
  respond();
  await responded;
  await expect(rideTemp).toHaveValue('12');
  await expect(page.getByRole('textbox', { name: /Pump temperature/ })).toHaveValue('21');
});

test('a sensor test only reports on the fields it was run with', async ({ page }) => {
  let respond!: () => void;
  const answered = new Promise<void>((resolve) => (respond = resolve));
  await page.route(SHELLY_STATUS, async (route) => {
    await answered;
    await route.fulfill({ headers: cors, json: { isok: true, data: { device_status: { 'temperature:0': { tC: 21 } } } } });
  });
  const status = page.locator('.temp-status');
  const deviceId = page.getByRole('textbox', { name: 'Device ID' });
  await open(page, '#/sensor');
  await page.getByRole('textbox', { name: 'Server' }).fill('shelly-103-eu.shelly.cloud');
  await page.getByLabel('Cloud key').fill('key');
  await deviceId.fill('e4b063d1a2b4');
  const responded = page.waitForResponse(SHELLY_STATUS);
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(status).toHaveText('Reading…');
  // Edited while the test is still running: its answer is about another device.
  await deviceId.fill('e4b063d1a2b5');
  await expect(status).toBeEmpty();
  respond();
  await responded;
  await page.waitForTimeout(200);
  await expect(status).toBeEmpty();
  // A result that came back is cleared by the next edit too.
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(status).toHaveText(/^Works: 21\u00a0°C/);
  await deviceId.fill('e4b063d1a2b4');
  await expect(status).toBeEmpty();
  await expect(page.getByRole('button', { name: 'Test' })).toBeEnabled();
});

const SHELLY_KEY = () =>
  localStorage.setItem(
    'tire-pressure:shelly',
    JSON.stringify({ server: 'https://shelly-103-eu.shelly.cloud', authKey: 'key', deviceId: 'e4b063d1a2b4' }),
  );

test('a lookup that ends after leaving the bike changes nothing', async ({ page }) => {
  await page.addInitScript(SHELLY_KEY);
  let respond!: () => void;
  const answered = new Promise<void>((resolve) => (respond = resolve));
  let requests = 0;
  await page.route(SHELLY_STATUS, async (route) => {
    // The first reading is slow and outdated by the time it comes.
    const tC = ++requests === 1 ? 30 : 25;
    if (requests === 1) await answered;
    await route.fulfill({ headers: cors, json: { isok: true, data: { device_status: { 'temperature:0': { tC } } } } });
  });
  const responded = page.waitForResponse(SHELLY_STATUS);
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(page.getByText('Reading the Shelly sensor…')).toBeVisible();
  await page.getByRole('button', { name: 'All bikes' }).click();
  await page.locator('.bike-card', { hasText: 'Endurace' }).click();
  const pump = page.getByRole('textbox', { name: /Pump temperature/ });
  const rideTemp = page.getByRole('textbox', { name: /Ride temperature/ });
  // The new visit reads the sensor again.
  await expect(pump).toHaveValue('25');
  await rideTemp.fill('7');
  await rideTemp.blur();
  respond();
  await responded;
  await page.waitForTimeout(200);
  await expect(pump).toHaveValue('25');
  await expect(rideTemp).toHaveValue('7');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tire-pressure:v1')!).rides['seed-endurace']);
  expect(saved).toMatchObject({ temperature: true, pumpC: 25, rideC: 7 });
});

test('a lookup of a sensor replaced meanwhile is dropped', async ({ page }) => {
  await page.addInitScript(SHELLY_KEY);
  let respond!: () => void;
  const answered = new Promise<void>((resolve) => (respond = resolve));
  const devices: string[] = [];
  await page.route(SHELLY_STATUS, async (route) => {
    const id = new URLSearchParams(route.request().postData() ?? '').get('id')!;
    devices.push(id);
    // The old sensor answers late, the new one at once.
    if (id === 'e4b063d1a2b4') await answered;
    const tC = id === 'e4b063d1a2b4' ? 30 : 25;
    await route.fulfill({ headers: cors, json: { isok: true, data: { device_status: { 'temperature:0': { tC } } } } });
  });
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(page.getByText('Reading the Shelly sensor…')).toBeVisible();
  await page.getByRole('button', { name: 'Shelly sensor setup' }).click();
  await page.getByRole('textbox', { name: 'Device ID' }).fill('e4b063d1a2b5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ride\/seed-endurace$/);
  const pump = page.getByRole('textbox', { name: /Pump temperature/ });
  // The new sensor is read instead.
  await expect(pump).toHaveValue('25');
  await expect(page.getByText('Shelly sensor: 25\u00a0°C.')).toBeVisible();
  respond();
  await page.waitForTimeout(200);
  await expect(pump).toHaveValue('25');
  expect(devices).toEqual(['e4b063d1a2b4', 'e4b063d1a2b5']);
});

test('a lookup that ends while editing the bike applies on coming back', async ({ page }) => {
  await page.addInitScript(SHELLY_KEY);
  let respond!: () => void;
  const answered = new Promise<void>((resolve) => (respond = resolve));
  let requests = 0;
  await page.route(SHELLY_STATUS, async (route) => {
    requests++;
    await answered;
    await route.fulfill({ headers: cors, json: { isok: true, data: { device_status: { 'temperature:0': { tC: 23 } } } } });
  });
  const responded = page.waitForResponse(SHELLY_STATUS);
  await open(page, '#/ride/seed-endurace');
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(page.getByText('Reading the Shelly sensor…')).toBeVisible();
  await page.getByRole('button', { name: 'Edit bike' }).click();
  respond();
  await responded;
  await page.goBack();
  await expect(page.getByRole('textbox', { name: /Pump temperature/ })).toHaveValue('23');
  await expect(page.getByText('Shelly sensor: 23\u00a0°C.')).toBeVisible();
  expect(requests).toBe(1);
});

test('edit profile form', async ({ page }) => {
  await open(page, '#/edit/seed-grizl');
  await shoot(page, '4-edit');
  await page.locator('.content').evaluate((el) => el.lastElementChild?.scrollIntoView({ block: 'end' }));
  await page.evaluate(() => window.scrollBy(0, 1000));
  await shoot(page, '4-edit-bottom');
});

test('a kid bike with 20″ wheels', async ({ page }) => {
  await open(page, '#/new');
  await page.getByRole('textbox', { name: 'Bike name' }).fill('Kids MTB');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Anna');
  await page.getByRole('textbox', { name: 'Rider weight (kg)' }).fill('25');
  await page.getByRole('textbox', { name: 'Bike weight (kg)' }).fill('8');
  const wheel = page.getByRole('radiogroup', { name: 'Wheel size' });
  await expect(wheel.getByRole('radio', { name: /700c/ })).toHaveAttribute('aria-checked', 'true');
  await wheel.getByRole('radio', { name: /^20″/ }).click();
  await expect(wheel.getByRole('radio', { name: /^20″/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('textbox', { name: 'Front tire (mm)' }).fill('44');
  await page.getByRole('textbox', { name: 'Rear tire (mm)' }).fill('44');
  await page.getByRole('textbox', { name: 'Inner rim width (mm)' }).fill('19');
  await page.getByRole('radio', { name: 'Tubes' }).click();
  // Show the whole "Tires & rims" card below the app bar.
  await page.getByText('Tires & rims').evaluate((el) => {
    el.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -120);
  });
  await shoot(page, '10-kid-edit');

  await page.getByRole('button', { name: 'Add bike' }).click();
  await expect(page).toHaveURL(/#\/ride\//);
  await page.getByRole('radio', { name: /Hardpack/ }).click();
  const psi = async () => Number(await page.locator('.psi-num').first().textContent());
  const on20 = await psi();
  await shoot(page, '10-kid-ride');

  await open(page, '#/');
  await expect(page.locator('.bike-card', { hasText: 'Kids MTB' })).toContainText('20″ · 44 mm · tubes');
  // 700c bikes don't show their wheel size.
  await expect(page.locator('.bike-card', { hasText: 'Grizl' })).not.toContainText('700c');
  await shoot(page, '10-kid-list');

  // The same bike on 700c wheels needs less.
  await page.locator('.bike-card', { hasText: 'Kids MTB' }).click();
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('radiogroup', { name: 'Wheel size' }).getByRole('radio', { name: /700c/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(psi).toBeLessThan(on20);
});

test('warning state', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'tire-pressure:v1',
      JSON.stringify({
        profiles: [
          {
            id: 'warn',
            name: 'Aero road',
            riderName: 'Guest',
            riderKg: 110,
            bikeKg: 8,
            frontWidthMm: 25,
            rearWidthMm: 25,
            innerRimMm: 25,
            tubeless: false,
            hookless: true,
            frontSharePct: 42,
            tireMinPsi: null,
            tireMaxPsi: null,
            rimMaxPsi: null,
            trailerTonguePct: 10,
            canTowTrailer: false,
            canCarryBags: false,
          },
        ],
        rides: {},
      }),
    );
  });
  await open(page, '#/ride/warn');
  await expect(page.locator('.alert').first()).toBeVisible();
  await shoot(page, '5-warning');
});

test('opens on the bike list, also after riding a bike', async ({ page }) => {
  for (let visit = 0; visit < 2; visit++) {
    await open(page, '');
    await expect(page).toHaveURL(/\/tire-pressure\/$/);
    await expect(page.locator('.bike-card')).toHaveCount(2);
    await page.locator('.bike-card', { hasText: 'Grizl' }).click();
    await expect(page).toHaveURL(/#\/ride\/seed-grizl$/);
    await page.getByRole('radio', { name: /Loose/ }).click();
    await page.getByRole('button', { name: 'All bikes' }).click();
    await expect(page.locator('.bike-card')).toHaveCount(2);
    await expect(page).toHaveURL(/\/tire-pressure\/$/);
  }
});

test('works with seeded bikes when storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
  await page.goto('./#/');
  await expect(page.locator('.bike-card')).toHaveCount(2);
  await expect(page.getByText(/changes will not be saved/)).toBeVisible();
});

test('an import that cannot be saved says so', async ({ page }) => {
  await open(page, '#/');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await page.locator('input[type=file]').setInputFiles(await download.path());
  await expect(page.locator('.toast')).toHaveText(/not saved/);
});

test('touch targets are at least 48 CSS px', async ({ page }) => {
  for (const hash of ['#/', '#/ride/seed-grizl', '#/edit/seed-grizl', '#/sensor']) {
    await open(page, hash);
    if (hash.startsWith('#/ride/')) {
      // Open every revealed row, too.
      for (const name of [/Kid trailer/, /Rear bags/, /Correct for temperature/]) await page.getByRole('switch', { name }).click();
      await expect(page.getByRole('textbox', { name: /Ride temperature/ })).toBeVisible();
    }
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, input, select, [role="radio"], [role="switch"], a')]
        .filter((el) => el.offsetParent !== null && !el.closest('.footnote, .temp-status'))
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width < 47.5 || rect.height < 47.5)
        .map(({ el, rect }) => `${el.tagName}.${el.className} "${el.textContent?.trim() || el.getAttribute('aria-label')}" ${Math.round(rect.width)}×${Math.round(rect.height)}`),
    );
    expect(small, `small targets on ${hash}`).toEqual([]);
  }
});

test('tapping anywhere in a value box focuses its input', async ({ page }) => {
  await open(page, '#/ride/seed-grizl');
  const box = page.locator('.stepper-value').first();
  const gear = page.getByRole('textbox', { name: /^Gear/ });
  const { width, height } = (await box.boundingBox())!;
  for (const position of [
    { x: 2, y: height / 2 },
    { x: width / 2, y: 2 },
    { x: width / 2, y: height - 2 },
    { x: width - 12, y: height / 2 }, // on the unit
  ]) {
    await page.locator('h1').first().click();
    await expect(gear).not.toBeFocused();
    await box.click({ position });
    await expect(gear).toBeFocused();
  }
});

test('editing a bike updates its pressures', async ({ page }) => {
  await open(page, '#/ride/seed-endurace');
  const front = page.locator('.psi-num').first();
  const before = Number(await front.textContent());
  await page.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('button', { name: 'Increase Rider weight' }).click();
  await page.getByRole('textbox', { name: 'Rider weight (kg)' }).fill('90');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ride\/seed-endurace$/);
  await expect.poll(async () => Number(await front.textContent())).toBeGreaterThan(before);
  await page.reload();
  await expect.poll(async () => Number(await page.locator('.psi-num').first().textContent())).toBeGreaterThan(before);
});

test('a per-bike pressure correction', async ({ page }) => {
  const endurace = SEED_PROFILES.find((p) => p.id === 'seed-endurace')!;
  /** The front/rear values the ride screen shows for the Endurace on smooth tarmac with this correction. */
  const expected = (correctionPct: number) => {
    const r = computePressure(toPressureInput({ ...endurace, correctionPct }, { ...defaultRide(endurace), surface: 'smooth' }));
    return [r.front, r.rear].map((w) => formatPsi(w.pump.psi, w.pump.limits));
  };
  const shown = async () => page.locator('.psi-num').allTextContents();
  const foot = page.locator('.result-foot');
  const card = page.locator('.bike-card', { hasText: 'Endurace' });

  await open(page, '#/ride/seed-endurace');
  await page.getByRole('radio', { name: /Smooth/ }).click();
  await expect.poll(shown).toEqual(expected(0));
  await expect(foot).not.toContainText('correction');

  await page.getByRole('button', { name: /Edit/ }).click();
  const correction = page.getByRole('textbox', { name: 'Correction (%)' });
  await expect(correction).toHaveValue('0');
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Increase Correction' }).click();
  await expect(correction).toHaveValue('+5');
  await correction.evaluate((el) => el.closest('.card')?.scrollIntoView({ block: 'center' }));
  await shoot(page, '12-correction-edit');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/#\/ride\/seed-endurace$/);
  await expect.poll(shown).toEqual(expected(5));
  expect(expected(5)).not.toEqual(expected(0));
  await expect(foot).toContainText('+5% correction');
  await shoot(page, '12-correction-ride');

  await page.getByRole('button', { name: 'All bikes' }).click();
  await expect(card.locator('.bike-preview-correction')).toHaveText('+5%');
  await expect(card.locator('.bike-preview')).toHaveAttribute('aria-label', /with a \+5% correction$/);
  await expect(page.locator('.bike-card', { hasText: 'Grizl' })).not.toContainText('%');
  await shoot(page, '12-correction-list');

  // Typed values are kept within −15…+15%, and survive a reload.
  await page.goto('./#/edit/seed-endurace');
  await correction.fill('-40');
  await correction.blur();
  await expect(correction).toHaveValue('-15');
  await expect(page.getByRole('button', { name: 'Decrease Correction' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(shown).toEqual(expected(-15));
  await expect(foot).toContainText('\u221215% correction');
  await page.reload();
  await expect.poll(shown).toEqual(expected(-15));

  // Back at 0, nothing shows.
  await page.getByRole('button', { name: /Edit/ }).click();
  await correction.fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(shown).toEqual(expected(0));
  await expect(foot).not.toContainText('correction');
  await page.getByRole('button', { name: 'All bikes' }).click();
  await expect(card.locator('.bike-preview-correction')).toHaveCount(0);
  await expect(card).not.toContainText('%');
});

test('a rear hub motor', async ({ page }) => {
  const grizl = SEED_PROFILES.find((p) => p.id === 'seed-grizl')!;
  /** The front/rear values and loads the ride screen shows for the Grizl at 14.3 kg with this motor. */
  const expected = (rearHubMotorKg: number) => {
    const r = computePressure(toPressureInput({ ...grizl, bikeKg: 14.3, rearHubMotorKg }, defaultRide(grizl)));
    return {
      psi: [r.front, r.rear].map((w) => formatPsi(w.pump.psi, w.pump.limits)),
      loads: [r.front, r.rear].map((w) => `${formatKg(w.loadKg)} kg`),
    };
  };
  const shown = async () => ({
    psi: await page.locator('.psi-num').allTextContents(),
    loads: (await page.locator('.wheel-meta').allTextContents()).map((t) => t.split(' · ')[0]),
  });
  const bike = page.getByRole('textbox', { name: 'Bike weight (kg)' });
  const motor = page.getByRole('textbox', { name: 'Rear hub motor (kg)' });

  await open(page, '#/edit/seed-grizl');
  await expect(motor).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Decrease Rear hub motor' })).toBeDisabled();
  await bike.fill('14.3');
  await motor.fill('3.5');
  await motor.blur();
  await expect(motor).toHaveValue('3.5');
  await motor.evaluate((el) => el.closest('.card')?.scrollIntoView({ block: 'center' }));
  await shoot(page, '13-motor-edit');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/#\/ride\/seed-grizl$/);
  await expect.poll(shown).toEqual(expected(3.5));
  // The Grizl's 42% front share of the motor moves onto the rear: the same total, a softer front.
  expect(expected(3.5).psi).not.toEqual(expected(0).psi);
  await shoot(page, '13-motor-ride');
  await page.reload();
  await expect.poll(shown).toEqual(expected(3.5));

  // Never more than the bike weight, nor 10 kg; a lower bike weight keeps what was set for when it goes back up.
  await page.getByRole('button', { name: /Edit/ }).click();
  await bike.fill('3');
  await bike.blur();
  await expect(motor).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Increase Rear hub motor' })).toBeDisabled();
  await bike.fill('14.3');
  await bike.blur();
  await expect(motor).toHaveValue('3.5');
  // A value set while the bike is lighter is what is kept, also when it is clamped to the one shown.
  for (const typed of ['12', '3']) {
    await bike.fill('3');
    await bike.blur();
    await expect(motor).toHaveValue('3');
    await motor.fill(typed);
    await motor.blur();
    await expect(motor).toHaveValue('3');
    await bike.fill('14.3');
    await bike.blur();
    await expect(motor).toHaveValue('3');
    await motor.fill('3.5');
  }
  await motor.fill('12');
  await motor.blur();
  await expect(motor).toHaveValue('10');
  await page.getByRole('button', { name: 'Increase Bike weight' }).click();
  await expect(motor).toHaveValue('10');
  await bike.fill('2.5');
  await bike.blur();
  await expect(motor).toHaveValue('2.5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/ride\/seed-grizl$/);
  await page.getByRole('button', { name: /Edit/ }).click();
  await expect(bike).toHaveValue('2.5');
  await expect(motor).toHaveValue('2.5');

  // Back at 0: the same as the bike without a motor.
  await bike.fill('14.3');
  await motor.fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(shown).toEqual(expected(0));
});

test.describe('installed PWA', () => {
  test.use({ serviceWorkers: 'allow' });

  test('works offline after the first visit', async ({ page, context }) => {
    await page.goto('./');
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cachedEntries = () =>
      page.evaluate(async () => {
        const counts = await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).length));
        return counts.reduce((a, b) => a + b, 0);
      });
    await expect.poll(cachedEntries).toBeGreaterThan(5);
    await context.setOffline(true);
    await page.goto('./#/ride/seed-grizl');
    await page.reload();
    await expect(page.locator('.psi-num').first()).toHaveText(/^\d+$/);
  });
});
