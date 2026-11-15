# 08 — How to be No. 1: research findings and the build list

Date: 15 Nov 2026, 16:00 GMT · Sources: the official challenge page and Resources tab, the official Judging & Awards Guide, the 2025 Global Winners page, LROC and NASA landing-site pages.

## The main finding
**Our biggest risk is not a rival. It is the challenge text itself.**

Judges score *Relevance* by whether the project "fully and directly addresses the challenge". The challenge's objectives name things SUNLOCK did not have:

| The challenge asks for (quoted from the objectives) | SUNLOCK before this round |
|---|---|
| "a curated list of notable landing sites – such as past Apollo missions, future CLPS mission targets, targets of other commercial lunar missions, or landing sites from other countries' lunar programs" | South-pole Artemis III regions only |
| "the ability to input custom lunar coordinates" | Click on the polar map only |
| "side-by-side or sequential comparison of multiple sites" | Ranking list and porkchop chart; no side-by-side view |
| "how much time remains before sunset or Earthset" (asked twice) | Not shown |
| "solar elevation angle … displaying this prominently" | Shown ✓ |
| "Earth's libration … orbital variations" | IAU 2015 model, checked against JPL Horizons ✓ |
| "lack of atmosphere … horizon is determined by local terrain and the edge of the lunar sphere" | 150 km terrain horizon with curvature ✓ |
| "steep slopes and deep craters that create extreme shadow conditions" | Live whole-pole shadows, slope, permanent shadow ✓ |
| Tools named in the challenge: Quickmap, Moon Trek, JPL Horizons | Horizons used for verification; no link out for users |

The Resources tab lists Quickmap, Moon Trek, JPL Horizons and the Canadian Space Agency's Moon Exploration page.

## How judging works (official guide)
- Five criteria, each scored 1–5: Impact, Creativity, Validity, Relevance, Presentation.
- Validity explicitly includes being "highly usable and user-friendly".
- Relevance explicitly includes NASA data being "integral".
- The guide says to give Presentation equal weight; the demo is limited to 7 slides or a 30-second video.
- Global Finalists go to NASA and partner executives. Awards that fit SUNLOCK:
  - **Best Use of Data**: "makes space data accessible"
  - **Best Mission Concept**: "most plausible concept and design"
  - **Best Use of Science**: "most valid use of the scientific method", which fits our pre-registered validation
- 2025 winners include an interactive design tool (Best Mission Concept, habitat layout creator) and a physics-first data engine (Best Use of Data).

## Build list for the rest of the tool window (by gain in Relevance)
1. **Time to sunset and Earthset**, plus the next sunrise and Earthrise, in the top bar and sky view.
2. **Notable landings list:**
   - Apollo 11–17, Chang'e 4 and 6, Chandrayaan-3, SLIM, and Blue Ghost Mission 1, all with a smooth-sphere horizon (our terrain covers 80–90°S only, and the app says so).
   - IM-1 and IM-2 inside the polar terrain, so they get real horizons.
   - Coordinates come from NASA, LROC or mission sources.
3. **Typed coordinates** anywhere on the Moon.
4. **Side-by-side comparison** of up to three sites on one time axis.
5. **"Check this in JPL Horizons"** link that opens a pre-filled Horizons query for the selected site and date, so judges can verify the Sun's position themselves.

## What we will not claim
- A global terrain horizon. Outside 80°S we use the lunar sphere's edge, which the challenge itself names as part of the horizon, and we label it.
- Coordinates for CLPS targets that have not been published precisely.

## Compliance check against the challenge text (16:20 GMT, local build)
| Challenge line | Where it is in SUNLOCK | Status |
|---|---|---|
| Curated list: past Apollo missions | Sites list → "Past landings": Apollo 11, 12, 14, 15, 16, 17 | ✅ |
| Future CLPS mission targets | "Planned missions": Griffin Mission One, IM-3 (target areas, labelled approximate) | ✅ |
| Other commercial missions' targets | IM-1, IM-2 and Blue Ghost Mission 1 (landed); Blue Moon MK1 (planned area) | ✅ |
| Other countries' programmes | Chandrayaan-3, SLIM, Chang'e 4, Chang'e 6; Chang'e 7 (planned area) | ✅ |
| Input custom lunar coordinates | "Check any spot on the Moon" form (anywhere), map click (pole); both shareable by link | ✅ |
| Side-by-side or sequential comparison | Compare tab (3 sites, one time axis), ranking, porkchop of every site × date | ✅ |
| Select landing dates and times | Year picker 2026–2030, month/day/6-hour steppers, slider, keyboard | ✅ |
| Change across lunar days or seasons | Full calendar year per view; 18.6-year averages for Artemis sites | ✅ |
| Sun and Earth relative to the horizon | Sky tab (now the first tab): panorama with the terrain horizon | ✅ |
| Time before sunset or Earthset | Top bar, plus the always-visible "right now" strip with countdowns and clock times | ✅ |
| Solar elevation prominent | "Right now" strip, top bar, sky panorama | ✅ |
| Duration of sunlight, Earth visibility windows | Timeline, best landing windows, Radio tab windows, criteria | ✅ |
| Power and communication assessment | Lander check (survives / battery dies), Power tab, Radio tab | ✅ |
| 2D maps / 3D / other creative views | Live shadow map, **3D terrain (overview and standing at the site)**, sky panorama, timelines, porkchop | ✅ |
| Animation or timeline over a lunar day | Play / speed controls, timeline strips | ✅ |
| Accessible to planners, educators and the public | Plain-language UI, 4-stop tour, "In short" plus technical drawer, phone layout | ✅ |
| Ephemeris (Horizons or precomputed) | Astronomy Engine, checked against JPL Horizons; one-click Horizons links per site | ✅ |
| LOLA topography for horizons | 80 m LOLA, 150 km rays with curvature | ✅ |
| No atmosphere / no refraction | Modelled, and stated in the Sky tab and drawer | ✅ |
| Earth libration, orbital variations | IAU 2015 rotation; topocentric Earth; matches Horizons to ~0.01° | ✅ |
| Steep slopes, deep craters, extreme shadows | Whole-pole live shadows, slope, permanent-shadow distance | ✅ |
| Extreme lunar vs terrestrial differences | "Why this sky is not like Earth's" notes with the site's own numbers; Apollo vs pole comparison | ✅ |
| Small location or date changes, large impacts | Tour (4 Feb dies, 14 Feb survives), panel height, porkchop, earliest survivable date | ✅ |
| Science–engineering coordination, schedule slips | Share links, mission CSV, earliest survivable landing, porkchop | ✅ |
| Resources: Quickmap, Moon Trek, Horizons | Per-site Moon Trek deep link, QuickMap (coordinates copied), Horizons queries | ✅ |
