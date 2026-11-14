# SUNLOCK — submission copy

## Project name
SUNLOCK

## Summary (≈170 words, target 50–200)

SUNLOCK is a landing-window navigator for the lunar south pole. Choose one of nine
candidate landing regions and it shows, immediately, when that ground is sunlit and when
Earth is in view.

The tool combines NASA's LRO LOLA elevation model at 80 metres per pixel with Sun and Earth
ephemerides rotated into the Moon's body-fixed frame. At each site it ray-marches the local
horizon in 360 directions, then tests the Sun and Earth against that skyline to produce
sunlight percentage, the longest continuous night, Earth-link duty cycle and a ranked search
for landing windows.

The result is one interactive view: scrubbing a date recomputes the shadow map across the
entire pole in real time. At the peak near Shackleton it reports 86% illumination over
180 days with a 3.5-day longest darkness — consistent with published south-pole studies —
while two named regions fall below 2%, showing how easily a site can be chosen in permanent
shadow.

## Project details (long form)

### What it does
SUNLOCK answers one question for the lunar south pole: which ground can I land on, and in
which week? It presents the region as a live, terrain-driven illumination map. Every
candidate site carries four decision numbers — sunlight fraction, longest continuous
darkness, direct-to-Earth visibility and surface elevation — and a mission-readiness score.
A window finder returns ranked, non-overlapping landing windows for a chosen mission length,
so a planner can move from "where" to "when" without leaving the page.

### The problem
At the lunar south pole the Sun never rises more than about 1.5° above the horizontal. Lighting
is therefore controlled almost entirely by local terrain: a crater rim a few hundred metres away
can keep a site in darkness for days while its neighbour stays lit. Earth sits equally low, and
libration swings it through roughly ±7°, opening and closing direct-to-Earth communication
windows on a timescale of days. Power and communications drive mission architecture, so these
two numbers decide whether a concept is viable at all.

Existing capability is real but hard to use: SPICE scripting, GIS layers and research tools with
interfaces built for specialists. Comparing several candidate regions across a season is an
afternoon of work per question, which discourages exploration and hides the trade space from
educators and the public.

### How it works
1. **Terrain.** NASA's LRO LOLA south polar gridded elevation model (LDEM_80S_80M, 80 m/pixel,
   7,600 × 7,600 samples) is decoded from its PDS product and re-projected from the original
   polar stereographic grid.
2. **Local horizon.** From each candidate point the horizon is ray-marched along 360 azimuths
   out to 64 km, with the lunar curvature drop subtracted, giving the true skyline elevation
   as seen from that point.
3. **Ephemeris.** Sun and Earth directions are computed from an analytic ephemeris and rotated
   into the lunar body-fixed frame using the IAU 2015 rotation model — including the Moon's
   1.54° axial tilt and libration, which is what produces the seasonal cycle.
4. **Decision.** A point is sunlit when solar elevation clears its terrain horizon in that
   azimuth; the Earth link is counted while Earth is above the skyline, allowing for its ~0.95°
   angular radius. Illumination is then integrated over the planning window (180 days at
   30-minute resolution) to produce percentages, dark streaks and window searches.

The map view applies the same test at every pixel of a 384 × 384 grid, so the visible shadow
pattern is a physical computation, not a texture.

### Validation
- The projection is checked against known relief: Malapert Massif is high, the Cabeus floor is
  deep, and Shackleton crater appears at the correct offset and diameter (21 km).
- The lunar frame is checked against physical libration: the sub-Earth point oscillates within
  about ±7° of the prime meridian, as it should.
- The headline result — 86% illumination at the peak near Shackleton — lands inside the
  published 80–86% range for the best south-pole locations.

### Benefits and impact
Mission planners get a fast comparison of power and communication trade-offs across candidate
regions. Educators and students get a truthful, interactive answer to why the lunar south pole
is hard. The public can see the Artemis landing-site decision on data returned by a NASA
spacecraft. The same method generalises to any airless body with a digital elevation model and
an ephemeris.

### Tools and technology
TypeScript and React in the browser; Vite for the build; a Node script for terrain processing;
Astronomy Engine for ephemerides; custom WebAssembly-free numerics for projection, horizon
marching and shadow rasterisation. No server component and no machine-learning model: the
computation is deterministic and runs entirely client-side.

### Creativity and considerations
Most lunar map projects are imagery viewers. SUNLOCK starts from the physics that actually
constrains a landing — light and line-of-sight — and makes that visible at a glance. Deliberate
choices: use the real 80 m terrain rather than a synthetic hillshade; recompute shadows live
rather than pre-baking them; publish the method and the limitations in the app itself, including
the absence of atmospheric refraction, thermal modelling and terrain self-shadowing between
distant peaks. Accuracy claims are bounded by what the model can support.

## SI (Super Intelligence) use
AI coding assistants were used to help implement the application and to edit documentation
prose. All scientific computation, data handling and validation were specified, checked and
verified against the source data by the team. No SI-generated images, audio or video are
included in the submission.

## NASA data
1. LRO LOLA gridded south polar DEM, LDEM_80S_80M — NASA PDS Geosciences Node
   https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.lbl
2. LRO LOLA data products overview — NASA PDS Geosciences Node
   https://pds-geosciences.wustl.edu/missions/lro/lola.htm
3. Lunar Reconnaissance Orbiter mission — NASA Science
   https://science.nasa.gov/mission/lro/

## Space Agency Partner and other resources
1. Astronomy Engine (ephemeris library, MIT licence) — https://github.com/cosinekitty/astronomy
2. IAU WGCCRE 2015 report on cartographic and rotational elements
   https://astropedia.astrogeology.usgs.gov/download/Docs/WGCCRE/WGCCRE2015reprint.pdf
3. React — https://react.dev
4. Vite — https://vite.dev

## Links
- Live tool: https://shahaman098.github.io/sunlock/
- Source: https://github.com/shahaman098/sunlock
- Demo (7 slides, PDF): https://shahaman098.github.io/sunlock/demo/sunlock-demo.pdf
