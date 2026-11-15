# SUNLOCK

**Find the week the Sun comes back.**

A landing-window navigator for the lunar south pole, built for the
[NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)
challenge *Lunar Landing Site Navigator*.

**Live:** https://shahaman098.github.io/sunlock/
**Demo (7 slides):** https://shahaman098.github.io/sunlock/demo/sunlock-demo.pdf

![SUNLOCK interface](web/public/demo/map.jpg)

---

## The problem

At the lunar south pole the Sun never rises more than about **1.5°** above the horizontal.
Lighting is therefore controlled almost entirely by local terrain: a crater rim a few hundred
metres away can hold a site in darkness for days while its neighbour stays lit.

Earth sits low as well, and libration swings it through roughly **±7°**, so direct-to-Earth
communication windows open and close on a timescale of days. Power and communications drive the
whole mission architecture, which makes these two numbers the first thing a planner needs.

Existing tools exist — but they are SPICE scripts, GIS layers and research interfaces. Comparing
several candidate regions across a season is an afternoon of work per question.

## What it does

- **Opens on the Moon in 3D.** The whole Moon, lit by the Sun from its true direction for the
  chosen date, with the landing sites, the answer for the selected one and a clock. "Mission
  console" opens the detailed view below with the same site, date and lander.
- **Terrain-driven shadow map.** Scrub time and the shadow pattern across the entire pole is
  recomputed from the elevation model, not played back from a texture.
- **Nine candidate regions**, each optimised to its best local high ground within the region.
- **Click anywhere** on the map and that point is analysed with the same horizon test, using a
  1024² elevation grid (~600 m/px) shipped to the browser.
- **Four decision numbers per site:** sunlight fraction, longest continuous darkness,
  direct-to-Earth visibility, surface elevation.
- **Window finder.** Ranked, non-overlapping landing windows for a chosen mission length.

## How it works

1. **Terrain** — NASA LRO LOLA south polar gridded elevation model `LDEM_80S_80M`
   (80 m/pixel, 7,600 × 7,600 samples), decoded from its PDS product and re-projected from the
   original polar stereographic grid.
2. **Local horizon** — from each point, ray-marched along 360 azimuths out to 64 km, with the
   lunar curvature drop subtracted.
3. **Ephemeris** — Sun and Earth directions rotated into the lunar body-fixed frame using the
   IAU 2015 rotation model, including the 1.54° axial tilt and libration.
4. **Decision** — a point is sunlit when solar elevation clears its terrain horizon; the Earth
   link is counted while Earth is above the skyline (allowing its ~0.95° angular radius).

The map applies the same test at every pixel of a 384 × 384 grid.

### Research

Two documents, both written from the shipped code and public data:

- **[research/REPORT.md](research/REPORT.md)** (PDF: `research/sunlock-report.pdf`) — a
  reproducibility study of how sampling and visibility conventions change lunar polar
  illumination estimates. Includes the JPL verification, the 36.8–94.4% sampling spread, and
  the reconciliation with the published literature.
- **[research/LITERATURE.md](research/LITERATURE.md)** — annotated review with quoted
  methodology and numbers from Mazarico 2011, Speyerer & Robinson 2013, Gläser 2014/2017 and
  Barker 2021.

Rebuild the PDF with `python3 research/build-pdf.py research/REPORT.md research/report.html`
then print the HTML to PDF.

### Benchmarks

See [BENCHMARKS.md](BENCHMARKS.md) for the full set: agreement with JPL Horizons on geometry
(21″) and on the lunar frame (0.003° in longitude), the effect of the Sun's finite disc (0.40%),
position sensitivity (±250 m → σ 0.04%) and horizon-sampling sensitivity (1.02% worst case).

```bash
cd web
npm run verify     # JPL Horizons: geometry + frame
npm run bench      # disc, position, azimuth sensitivity
npm run bench:ray  # sampling-interval study
npm run bench:conv # convergence + disc-criterion study
```

### Independent verification

The sky geometry is compared against **JPL Horizons** at 12 epochs across the 2027 window
(astrometric RA/Dec, observer = Moon centre):

```
node web/scripts/verify-horizons.mjs
```

Result: maximum difference **0.0058°** for the Sun and **0.0063°** for Earth — about 23 arcseconds,
the level of aberration and light-time treatment rather than of geometry, and two orders of
magnitude below the 80 m terrain resolution. Output is committed at
`web/public/terrain/verification.json` and shown in the app's method panel.

### Validation

- The projection is checked against known relief: Malapert Massif is high, the Cabeus floor is
  deep, and Shackleton crater appears at the correct offset with a 21 km diameter.
- The lunar frame is checked against physical libration: the sub-Earth point stays within ~±7°
  of the prime meridian.
- **Validated against NASA's own map.** Compared with the LOLA team's 18.6-year average
  visibility product (`AVGVISIB_85S_060M`, PGDA product 69) at 451 points: **r = 0.995,
  RMSE 1.4 percentage points**. That comparison found a 180° horizon/azimuth error in an
  earlier build, which is now fixed.
- **Validated against photographs (pre-registered H3).** LROC's WAC illumination map counts how
  often each 100 m pixel was lit in 3,807 camera images over 2010–11, with no LOLA product in
  between. On the pre-registered random sample (296 points inside its 88–90°S coverage), our
  sunlight over the same year gives **r = 0.980, RMSE 3.1 points, bias +1.6** (threshold r ≥ 0.85).
  See `research/validation/result-wac.json`.
- **Shadow timing checked against timestamped photographs (exploratory, not pre-registered).**
  The tests above compare long-run averages; this one asks *when* shadows arrive. LROC's
  `WAC_POLE_MOVIE_SOUTH` gives one photograph of the pole per orbit. We sampled all 261 frames of
  December 2009 on a fixed 1 km grid within 24 km of the pole (1,793 points, 467,973 samples).
  - Bright or dark at the photographed minute: we agree on **96.6%** of samples. Most samples are
    dark, so "always dark" would score 81.2%; the overlap of the bright class alone is IoU 0.84.
  - Of 1,802 photographed sunrises and sunsets, 1,519 have a matching one of ours within a day;
    for those the **median timing error is 0.5 h** (frames are 1.9 h apart), 70% are within 2 h
    and 10% are off by more than 11.7 h. **283 (16%) have no crossing of ours within 24 h.**
  - 7-day missions run on the photographed light and on ours agree **95.9%** of the time
    ("always fails" would score 82%). When we say a lander survives, the photographs agree
    **82.7%** of the time. 14-day stays could not be tested: the month has no 14-day run of
    photographs without a gap.
  - These use "half the Sun's disc above the skyline" as lit; the app's "any part of the disc"
    rule scores 95.4% and a 3.3 h median timing error against photo brightness.
  See `research/validation/result-wac-movie.json`; rerun with `npm run validate:wac-movie`.
- **73% illumination** at the peak near Shackleton over 180 days. This is a region centre,
  not a searched optimum, which is why it sits below the ~85–88% published for optimised
  clusters.

## Limitations

No atmospheric refraction, no thermal or power-system model, no terrain self-shadowing between
distant peaks, no physical libration, 80 m terrain resolution. Custom clicked points are ray-marched
on the 1024² grid (~600 m/px), which is coarser than the 80 m model used for the preset regions. This is a planning aid for
comparison and intuition, not a flight-qualified analysis tool.

## Run it

```bash
cd web
npm install
npm run dev
```

## Rebuild the data from NASA's archives

Every map, site, finder and validation file is derived from pinned NASA products, listed with
their official URLs, sizes and SHA-256 in [`data/sources.json`](data/sources.json):
LOLA `LDEM_80S_80M` terrain (PDS Geosciences Node), the LOLA team's 18.6-year Sun/Earth visibility
and permanent-shadow maps (PGDA product 69) and the LROC WAC illumination map.

```bash
node scripts/fetch-data.mjs        # download what is missing; refuse anything whose hash differs
cd web
npm run data                       # rebuild every stage whose code or inputs changed
npm run data -- --check            # exit 1 if any shipped file is stale or was edited by hand
```

The pipeline (`web/scripts/pipeline.mjs`) runs, in order: terrain grids, validation against the
LOLA maps (pre-registered H1, H2, H4), validation against LROC WAC (H3), shadow timing against
LROC's timestamped photographs (from committed samples; `npm run fetch:wac-movie` re-downloads
them, about 3 GB of range requests), site selection, nearby
positions, the site finder, mission markers and the nearby-position validation. It writes
[`web/public/terrain/manifest.json`](web/public/terrain/manifest.json): for every output, its
SHA-256, the stage that made it and the hash of every input and script that went into it. A test
(`tests/provenance.test.mjs`) fails if any shipped file no longer matches the manifest.
Benchmarks (`npm run bench*`) and the JPL Horizons check (`npm run verify`, needs network) stay
separate commands.

Terrain assets are committed under `web/public/terrain/`. To rebuild them from the raw DEM:

```bash
curl -O https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.img
mkdir -p data/raw && mv ldem_80s_80m.img data/raw/
node scripts/build-terrain.mjs
```

## Data and credits

- **LRO LOLA** gridded south polar DEM, product `LDEM_80S_80M`, NASA Planetary Data System
  Geosciences Node (LRO-L-LOLA-4-GDR-V1.0). Modelling by the LOLA team at NASA Goddard.
- **Astronomy Engine** (MIT) — ephemeris and lunar rotation model.
- **IAU WGCCRE 2015** — cartographic and rotational elements.
- React, TypeScript, Vite.

## Licence

MIT. NASA data is used under its public-domain terms; please credit LRO LOLA.
