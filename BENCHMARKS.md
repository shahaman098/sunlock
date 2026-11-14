# Benchmarks, validation, and one unresolved accuracy issue

Everything here is produced by committed scripts against the modules the app ships.

```bash
cd web
npm run verify     # JPL Horizons: geometry + frame
npm run bench      # solar disc, position, azimuth sampling
npm run bench:ray  # horizon ray-sampling study
```

Latest run: 15 Nov 2026, planning window 1 Jan – 30 Jun 2027.

---

## 1. Against JPL Horizons (solid)

Twelve epochs, Horizons API.

### 1a. Geometry — Sun and Earth directions from the Moon

| Quantity | Max difference |
|---|---|
| Sun direction | **21.0″** (0.0058°) |
| Earth direction | **22.7″** (0.0063°) |

Aberration-scale. Two orders of magnitude below the 80 m terrain resolution.

### 1b. Frame — the lunar body-fixed frame itself

Horizons sub-observer and sub-solar lon/lat (quantities 14, 15), which depend on the IAU
rotation model:

| Quantity | Max difference |
|---|---|
| Sub-Earth longitude | **0.0079°** |
| Sub-Earth latitude | **0.0020°** |
| Sub-solar longitude | **0.0032°** |
| Sub-solar latitude | **0.0021°** |

### What this caught

An earlier version used only the polynomial prime meridian
(`W = 38.3213 + 13.17635815 d`), dropping the periodic libration terms. That was
**2.24° off in longitude**, drifting ~0.6°/year, while latitude matched perfectly.
Switching to Astronomy Engine's full IAU `spin` closed it to 0.003°.

---

## 2. Solar disc, position, azimuth sampling

| Effect | Result |
|---|---|
| Finite solar disc (0.266°) vs centre-of-disc | **≤ 0.40%** |
| Landing point moved ±250 m, horizon held fixed | **σ 0.04%** |
| Horizon sampled every 4° instead of 1° | **≤ 1.02%** |

All small. None of them is the dominant uncertainty.

---

## 3. The dominant uncertainty: horizon ray sampling

This is the important one, and it is **not yet resolved**.

Same coordinate (peak near Shackleton, 89.438°S 222.717°E), same 64 km range, same
curvature correction. Only the distance between ray samples changes:

| Terrain product | Step | Step/pixel | Mean horizon | Illumination |
|---|---|---|---|---|
| 80 m | 80 m | 1 px | −1.05° | **54.2%** |
| 80 m | 160 m | 2 px | −1.74° | **86.4%** |
| 80 m | 320 m | 4 px | −2.24° | **93.3%** |
| 40 m | 80 m | 2 px | −0.44° | **36.8%** |
| 40 m | 160 m | 4 px | −1.50° | **76.8%** |
| 40 m | 320 m | 8 px | −2.10° | **92.7%** |
| 20 m | 80 m | 4 px | −0.71° | **48.2%** |
| 20 m | 160 m | 8 px | −1.68° | **85.9%** |
| 20 m | 320 m | 16 px | −2.19° | **94.4%** |

**Illumination at one point spans 37–94% depending only on sampling.** A naive
nearest-neighbour max-slope march is therefore not a well-posed estimator: coarse
sampling steps over near-field ridges and inflates sunlight.

### Convergence test (bilinear sampling, 80 m DEM)

| Step | Mean horizon | Centre-of-disc | Any part of disc |
|---|---|---|---|
| 160 m | — | 87.0% | 94.8% |
| 80 m | — | 60.0% | 72.4% |
| 40 m | — | 58.6% | 70.8% |

The estimator converges toward **~70–72%** (any-part-of-disc) at this coordinate, not 86%.

### What the literature actually measures

This is the part that matters, and it resolves most of the discrepancy.

**Gläser et al. (2017)**, *Illumination Conditions at the Lunar Poles: Implications for Future
Exploration* (NASA NTRS 20170007365), computes illumination over a **20-year** period,
hourly, **2 m above ground**, and defines it as *"the percentage of a given period in which
**any portion of the Sun is visible**"*. Their numbers:

| Site | Max average illumination |
|---|---|
| Connecting Ridge clusters (C1-0, C1-1) | **88.0%** |
| Shackleton rim clusters (S0–S2) | **85.5%** |
| Peary rim (north) | 85.1% |
| Whipple crater (north) | 85.1% |

and *"these sites are typically illuminated for about 90%"*, with *"maximum times in shadow
of less than three and up to eight days"*.

Three conventions differ from ours, and each pushes in a known direction:

1. **Any part of the disc vs disc centre** — worth **+8 to +12 points** in our own test
   (87.0 → 94.8; 60.0 → 72.4).
2. **Optimised cluster vs region-centre coordinate** — their sites are found by exhaustive
   search on the ridge; ours is a region centre snapped at 80 m.
3. **20 years vs 180 days** — longer baselines catch worse seasons.

**Barker et al. (2021)**, *Improved LOLA elevation maps for south pole landing sites*
(NTRS 20205009660), independently reports that *"natural terrain slope variations and
sub-pixel sampling cause [height uncertainty] to be larger"* than geolocation error, and that
these propagate into horizon elevation and predicted illumination. That is the same effect
measured in section 3.

### Reconciled position

- Our shipped **86–87%** (disc centre, nearest-neighbour, 2-pixel steps) lands in the
  published 85–88% band, but it is **not the same quantity**: the literature counts any
  part of the disc, at optimised ridge clusters.
- Our **converged** estimate at this coordinate is **~71%** any-part-of-disc, which is
  consistent with being a region centre rather than a searched cluster.
- One number *is* like-for-like: our longest continuous darkness at the Shackleton peak is
  **3.5 days**, inside the *"less than three and up to eight days"* reported by Gläser et al.

The right fix is to adopt the literature convention explicitly — any part of the solar disc,
converged sampling, and site coordinates found by search rather than by 80 m snapping — and
then compare numbers. That is a defined piece of work, not an unknown.

## 4. What is not validated

- **No reproduction of a specific published illumination figure.** Without the paper's
  exact coordinates and disc convention this cannot be done meaningfully.
- **No thermal, dust or power-system model.** Array output is first-order.
- **Horizon estimator is the open problem** (section 3).
- **Physical libration** enters only through the IAU series.
- **Sub-pixel terrain structure** below the DEM resolution is not resolved.
