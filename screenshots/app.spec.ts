import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

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

test.beforeEach(async ({ page }) => {
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
  await expect(page.getByRole('switch')).toHaveCount(0);
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

test('edit profile form', async ({ page }) => {
  await open(page, '#/edit/seed-grizl');
  await shoot(page, '4-edit');
  await page.locator('.content').evaluate((el) => el.lastElementChild?.scrollIntoView({ block: 'end' }));
  await page.evaluate(() => window.scrollBy(0, 1000));
  await shoot(page, '4-edit-bottom');
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
        lastProfileId: 'warn',
      }),
    );
  });
  await open(page, '#/ride/warn');
  await expect(page.locator('.alert').first()).toBeVisible();
  await shoot(page, '5-warning');
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

test('touch targets are at least 48 CSS px', async ({ page }) => {
  for (const hash of ['#/', '#/ride/seed-grizl', '#/edit/seed-grizl']) {
    await open(page, hash);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, input, select, [role="radio"], [role="switch"], a')]
        .filter((el) => el.offsetParent !== null && !el.closest('.footnote'))
        // An input inside a <label> is tapped through the whole label.
        .map((el) => ({ el, rect: (el.closest('label') ?? el).getBoundingClientRect() }))
        .filter(({ rect }) => rect.width < 47.5 || rect.height < 47.5)
        .map(({ el, rect }) => `${el.tagName}.${el.className} "${el.textContent?.trim() || el.getAttribute('aria-label')}" ${Math.round(rect.width)}×${Math.round(rect.height)}`),
    );
    expect(small, `small targets on ${hash}`).toEqual([]);
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
