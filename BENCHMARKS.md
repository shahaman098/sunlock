# Benchmarks and validation

Everything here is computed by committed scripts against the same modules the app ships.
Nothing is quoted from a paper.

```bash
cd web
npm run verify     # JPL Horizons: geometry + frame
npm run bench      # sensitivity of the illumination numbers
```

Latest run: 2026-11-14, over the 2027 planning window (1 Jan – 30 Jun 2027).

---

## 1. Against JPL Horizons

Three independent comparisons at **12 epochs**, using the Horizons API
(`ssd-api.jpl.nasa.gov`).

### 1a. Geometry — are the Sun and Earth in the right direction?

Our geocentric vectors differenced to the Moon, compared with Horizons astrometric
right ascension and declination observed from the Moon's centre.

| Quantity | Max difference |
|---|---|
| Sun direction | **21.0″** (0.0058°) |
| Earth direction | **22.7″** (0.0063°) |

A ~21″ residual is the size of annual aberration, not a geometry error: the two
computations treat light-time and aberration slightly differently. It is two orders
of magnitude below the 80 m terrain resolution.

### 1b. Frame — is our lunar body-fixed frame the same frame?

This is the harder test and the one that matters. Horizons reports the
**sub-observer** and **sub-solar longitude/latitude** on the Moon (quantities 14 and 15),
which depend on the IAU rotation model — the prime meridian and its libration terms.

| Quantity | Max difference |
|---|---|
| Sub-Earth longitude | **0.0079°** |
| Sub-Earth latitude | **0.0020°** |
| Sub-solar longitude | **0.0032°** |
| Sub-solar latitude | **0.0021°** |

That is agreement at the few-arcsecond level on a 1,737 km body, i.e. a few hundred
metres of surface displacement at the equator and far less near the pole.

### What this check caught

An earlier version used only the polynomial prime-meridian expression
(`W = 38.3213 + 13.17635815 d`) and dropped the periodic libration terms. Against
Horizons that was **2.24° off in longitude**, drifting ~0.6°/year — invisible in the
latitude, and therefore easy to miss. Switching to the full IAU model in Astronomy
Engine (`RotationAxis().spin`) closed it to 0.003°.

---

## 2. Sensitivity of the illumination numbers

### 2a. Finite size of the Sun

The Sun subtends 0.266°. Near the pole its disc, not its centre, decides illumination.

| Site | Centre-of-disc | Disc-integrated | Δ |
|---|---|---|---|
| Peak near Shackleton | 86.24% | 85.84% | **−0.40%** |
| Malapert Massif | 56.26% | 56.21% | −0.05% |
| Connecting Ridge | 51.01% | 51.20% | +0.18% |

**Max effect across all nine sites: 0.40%.** The app reports the centre-of-disc value,
which is the conservative and commonly used definition; the disc-integrated number is
available from the benchmark script.

### 2b. Where exactly you land (±250 m)

Each site moved 250 m in eight directions, horizon profile held fixed, to isolate the
ephemeris/geometry term:

**Max standard deviation: 0.04% illumination.**

This is deliberately a *lower bound* on siting sensitivity: it varies the position
against a fixed skyline. Re-deriving the horizon at each shifted point would add the
terrain term, which is exactly what the app's click-anywhere mode exposes.

### 2c. Horizon sampling

The skyline is sampled hourly in azimuth by the app (360 samples). Keeping only every
fourth sample and interpolating back:

| Site | 1° horizon | 4° horizon | Δ |
|---|---|---|---|
| Peak near Shackleton | 86.24% | 87.26% | **+1.02%** |
| Connecting Ridge | 51.01% | 51.49% | +0.47% |
| Haworth | 1.27% | 1.27% | 0.00% |

**Worst case: 1.02%.** At a summit the horizon is nearly flat, so coarse sampling
matters; in rugged terrain it matters much less.

---

## 3. What is *not* validated

Being explicit is part of the benchmark:

- **No comparison with published illumination percentages.** The 86% figure is
  consistent with the 80–86% range reported for the best south-pole sites, but this
  repository does not reproduce a specific paper's numbers.
- **No 20 m terrain comparison.** Only the 80 m LOLA product is used for the presets;
  a 20 m product exists (LDEM_875S_20M) and would let us quantify resolution error.
- **No thermal, dust or power-system model.** Array output is first-order (solar
  constant × cosine incidence × cell efficiency × derate).
- **Physical libration** (<0.03°) is included only through the IAU series, not as a
  separate correction.
- **Horizon ray-marching** uses nearest-neighbour sampling of the raster and a finite
  step (160 m); sub-pixel terrain structure is not resolved.

Each of these is a next step with a named dataset, not a hand-wave.
