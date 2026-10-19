# Tire Pressure

An offline-first PWA that recommends front and rear tire pressures for each bike and rider in the family.

**App:** https://redsun82.github.io/tire-pressure/ (on Android Chrome: menu → *Add to home screen* / *Install app*)

| Bikes | Road | Gravel + trailer | Edit | Warnings |
|---|---|---|---|---|
| ![](docs/screenshots/light-1-list.png) | ![](docs/screenshots/light-2-endurace-road.png) | ![](docs/screenshots/dark-3-grizl-gravel-trailer.png) | ![](docs/screenshots/light-4-edit.png) | ![](docs/screenshots/dark-5-warning.png) |

## Using it

- **One profile per bike and rider.** A profile holds the rider's weight, the bike, tire widths (front and rear can differ), inner rim width, tubeless or tubes, hooked or hookless rims, the front/rear weight split, optional tire and rim pressure limits, and the trailer hitch load.
- **Per ride** you pick the surface, dry or wet, and the load: gear (1 kg by default), kid trailer (trailer + child, 25 kg by default) and rear bags (5 kg by default). The app remembers all of it per bike, and turning the trailer or bags off keeps their weight for next time.
- Results are in **psi** (pumps read in psi), with **bar** next to them. Inputs are in kg and mm.
- Everything is stored on the device (`localStorage`). Use **Export** and **Import** on the home screen to back up or move bikes to another phone. Import merges by profile id.
- The two seeded bikes are a Canyon Endurace CF SLX 9 Di2 and a Canyon Grizl CF 9 with ECLIPS. Edit or delete them as needed.

## The pressure model

The model is our own implementation. Every coefficient lives in [`src/model/coefficients.ts`](src/model/coefficients.ts), and the computation is in [`src/model/pressure.ts`](src/model/pressure.ts).

The SRAM/Zipp and Silca calculators are proprietary. We did not copy their maths, and we couldn't obtain their outputs to use as test references (see *Validation* below).

### 1. Wheel load

```
system  = rider + bike + gear
front   = system × front share
rear    = system × (1 − front share) + trailer tongue load + rear bags
```

- **Front share** is per bike. The seeds use 43% for the Endurace (road endurance geometry) and 42% for the Grizl (440 mm chainstays, ~1100 mm wheelbase). Most bikes with a seated rider are 40–45%. To measure yours, put the front wheel on a bathroom scale while seated in riding position.
- **Kid trailer:** the hitch sits on the rear axle, so only the tongue load reaches the bike. That defaults to 10% of trailer + child (set per ride, 25 kg by default; the percentage is set per bike) and is added to the rear wheel. The trailer's own wheel carries the rest.
- **Rear bags:** their full weight is added to the rear wheel.

### 2. Effective width

A tire measures wider on a wider rim. Following ETRTO and published measurements (tire makers, bicyclerollingresistance.com), the as-mounted width grows by about **0.4 mm per mm** of inner rim width:

```
W = nominal + 0.4 × (inner rim − reference rim)
reference rim = 19 mm (tires ≤ 32 mm), 21 mm (≤ 42 mm), 23 mm (wider)
```

### 3. Base pressure: 15% tire drop

The target is the pressure at which the tire compresses about **15% of its height** under that wheel's load. This is Frank Berto's rule from his measurements published in *Bicycle Quarterly*, summarised by Rene Herse in [Finding the perfect tire pressure](https://www.renehersecycles.com/finding-the-perfect-tire-pressure/).

```
P_base [psi] = 1490 · L^0.8 / W^1.82        (L = wheel load in kg, W = effective width in mm)
```

How the constants were chosen:

- Berto published a chart, not a formula. A widely circulated community curve fit of that chart is `P = 153.6 · L_lb / W^1.5785 − 7.1685`. We could not re-verify it against the original chart, so it is an approximation of an approximation.
- At a 45 kg wheel load, that fit gives 72.0 psi for 28 mm, 48.5 for 35 mm and 30.3 for 45 mm. Our power law reproduces those anchors to within 1.5% (unit-tested).
- The width exponent `b = 1.82` comes from solving between those anchors. `k` sets 35 mm at 45 kg to 48.5 psi.
- The load exponent `a = 0.8` is a **deliberate choice**. Berto's fit is nearly linear in load with a negative offset, which gives implausibly low pressures for light loads on wide tires (about 14 psi for a 45 mm front tire carrying 25 kg). A sub-linear load term keeps light riders and front wheels sensible. Compared with the Berto fit, the model is about 17% higher at 30 kg / 35 mm and about 9% lower at 60 kg / 35 mm.

### 4. Conditions

The base pressure is multiplied by:

| Factor | Multiplier | Why |
|---|---|---|
| Smooth tarmac | 1.00 | Baseline |
| Worn tarmac | 0.94 | |
| Rough tarmac / chipseal | 0.87 | Surface "breakpoint": on rougher surfaces, lower pressure reduces suspension losses (Silca, Rene Herse/BQ and bicyclerollingresistance.com roll-down tests) |
| Hardpack gravel | 0.90 | |
| Loose gravel | 0.82 | |
| Wet | × 0.95 | More grip from a larger contact patch |
| Inner tubes | × 1.05 | Small margin against pinch flats (tubeless is the baseline) |

The surface values are our own conservative picks within the ranges that research suggests. They are not taken from any calculator.

### 5. Limits and warnings

- **Hookless rims** are capped at **5 bar / 72.5 psi** (ETRTO / ISO). Optional tire max, tire min and rim max limits from the sidewall or rim manual also clamp the result. Clamped values are always rounded towards the safe side, so a 72.5 psi cap shows as 72, never 73.
- **Estimated tire drop** at the recommended pressure is `15% × P_base / P`, shown under each wheel. The app warns above 20% (tubeless: risk of rim strikes) or 18% (tubes: risk of pinch flats).
- Info notes cover very low pressures (< 18 psi), hookless rims with tubes, and front shares outside 30–55%.

### Validation

- The unit tests (`src/model/*.test.ts`) check monotonicity in load, width, rim width and surface, unit conversion and rounding, the trailer and bag maths, the limits and warnings, storage normalisation, load weights surviving the on/off switches, and import/export.
- **No real calculator references.** We could not get actual SRAM/Zipp or Silca outputs for the seed bikes. Instead of inventing reference numbers, the seed bike tests assert broad **sanity ranges from common published guidance** for a ~75 kg rider: 28–35 mm road tubeless at roughly 45–70 psi, and 45 mm gravel tubeless at roughly 20–40 psi.
- On top of that, a ±5% **regression snapshot** pins the model's own current outputs, so changing a coefficient is a visible, deliberate change.

### Seed bikes

| | Endurace CF SLX 9 Di2 (L) | Grizl CF 9 ECLIPS (L) |
|---|---|---|
| Bike | 7.5 kg | 8.8 kg |
| Tires | Schwalbe Pro One TLE 30 mm front, 34 mm rear | Schwalbe G-One RX Pro 45 mm |
| Rim | DT Swiss ARC 1100 DICUT, 22 mm inner, **hooked** | DT Swiss GRC 1400 SPLINE, 24 mm inner, **hookless** |
| Split | 43 / 57 | 42 / 58 |
| Smooth / dry, 75 kg rider, 1 kg gear | ~50 / 52 psi | ~25 / 32 psi |

The GRC 1400 is a **hookless** rim, according to DT Swiss and retailer specs, so the 5 bar cap applies to the Grizl. DT Swiss also publishes per-width maximums for its hookless rims. We haven't verified those values, so they are not pre-filled. Add them under *Limits* if you have them.

## Development

```sh
npm ci
npm run dev          # Vite dev server
npm test             # Vitest (model + storage)
npm run build        # type-check + production build (PWA, service worker, icons)
npm run screenshots  # Playwright: Pixel 10 Pro screenshots → docs/screenshots/
```

- **Stack:** Vite + TypeScript (no framework), [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Workbox precache, auto update), and icons generated from `public/icon.svg` by `@vite-pwa/assets-generator`.
- **Screenshots** render the app at the Pixel 10 Pro reference size: 410×912 CSS px at DPR 3.125, in light and dark. A simulated status bar and gesture bar exercise the safe-area insets. The same run checks that every touch target is at least 48 CSS px. Install the browser first with `npx playwright install chromium`.
- **CI** (`.github/workflows/ci.yml`) runs the tests, the build and the screenshots on every PR. **Deploy** (`.github/workflows/deploy.yml`) publishes `dist/` to GitHub Pages on every push to `main`.

## Disclaimer

These are estimates and a starting point. Never exceed the limits printed on your tire or rim. Adjust to feel: if the bike feels harsh, go lower; if it feels squirmy or the rim bottoms out, go higher.
