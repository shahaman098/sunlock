# 00 — NASA Space Apps Challenge 2026 · Command Centre

Last verified: **2026-11-14 13:5x UTC** · Owner: shahaman098 · Deadline: **2026-11-15 23:59 local (Team Owner)**

---

## A. Executive Intelligence Brief

**What this is.** The 2026 NASA International Space Apps Challenge, run by NASA's Science Mission Directorate
with Booz Allen Hamilton, Mindgrub and SecondMuse. Theme: *The Next Frontier* (Moon, Mars/deep space, the universe).
Build weekend 14–15 Nov 2026.

**Scale.** 2025 edition received **11,500+ project submissions**; **10 Global Winners** were selected.
That is a ~0.09% win rate at the top end — but the reward curve is long: Nominee → Honorable Mention →
Finalist → Winner. Nomination is achievable with a complete, real, well-presented submission.

**Our position.**
| Item | Status |
|---|---|
| Account `shahaman098` | ✅ Logged in, verified on dashboard |
| Event | ✅ Universal Event (virtual) |
| Teams | ⚠️ **0** — no team created yet |
| Projects | ⚠️ **0** submitted |
| Working code | ✅ Terrain + ephemeris pipeline built and validated today |
| Public hosting | ⚠️ Not yet deployed (GitHub CLI authenticated as `shahaman098`) |

**The single most important structural fact.** There are **10 separate Global Awards**, not one.
Judges pick winners *per award*. A project that is unmistakably the best "Best Use of Data" or
"Best Mission Concept" does not need to beat all 11,500 projects — it needs to be the clearest
exemplar of one award. This changes strategy: **optimise for one award identity, not general appeal.**

**Where the leverage is.** Universal Event projects are judged only against other Universal Event
teams, not against in-person local events. Competition is materially thinner than the headline number.

---

## B. The 10 Global Awards (verbatim definitions)

| Award | Official definition | Our fit |
|---|---|---|
| Best Use of Science | Best and most valid use of science and/or the scientific method | **High** |
| Best Use of Data | Best makes space data accessible or leverages it for a unique application | **High** |
| Best Use of Technology | Most innovative use of technology | Medium |
| Galactic Impact | Most potential to improve life on Earth or the universe | Medium |
| Best Mission Concept | Most plausible concept and design | **Very high** |
| Most Inspirational | Captures our hearts | Low |
| Best Use of Storytelling | Most creatively communicates the potential of open data | Medium |
| Global Connection | Best connects people around the world through technology | Low |
| Art & Technology | Most effectively combines technical and creative skills | Low |
| Local Impact | Greatest potential for local impact | Low |

**Strategic read.** We cannot credibly contest Inspirational, Global Connection, Art & Technology or
Local Impact. The realistic target set is **Best Mission Concept + Best Use of Data + Best Use of Science**.
A physics-grounded mission-planning tool with visible provenance is a natural inhabitant of all three.

---

## C. Judging pipeline (verified)

1. **Local/Universal Event judging** → selects **Global Nominees**
2. **Global Judging** (NASA + Space Agency Partner SMEs) → **Global Finalists** + **Honorable Mentions**
3. **Executive committee** (agency leaders) → **10 Global Winners** — announced Dec 2026; winners celebrated early 2027

**Scored on five criteria** (official): **Impact · Creativity · Validity · Relevance · Presentation**.
Weights are **NOT published** — treat them as equal until evidence says otherwise.

---

## D. Critical rules (short form — full matrix in `01-rules-compliance.md`)

- Project page fields are all **mandatory**; content **must be English**.
- Must click **"Submit for Judging"** before the deadline. Saving is not submitting.
- Demo: **≤30 s video OR ≤7 slides**. Exceeding either limit **disqualifies from Global Judging**.
- Images may be embedded (JPG/PNG/GIF ≤10 MB). **Video and documents cannot be uploaded** — link out.
- All linked material must be **public, no login, no permission request**.
- **At least one NASA data/resource** is required for a Global Award.
- **No images/likeness of anyone under 18.**
- SI (AI) use is permitted but must be **disclosed**; SI-generated images/video need a **visible watermark**.

---

## E. Recommended project (decision)

> **SUNLOCK — a landing-window navigator for the lunar south pole.**
> Challenge: *Lunar Landing Site Navigator*.

Pick a site, scrub time, and watch real terrain shadows move across the lunar south pole while
sunlight and Earth-communication windows are recomputed from real ephemerides. Output: a ranked
shortlist of landing sites and the best landing window for a chosen mission duration.

**Why this wins on the actual rubric**

| Criterion | Evidence we can put in front of a judge |
|---|---|
| Impact | Mission planning for Artemis-era south-pole landing; directly names the official challenge's stated pain (complex existing tools) |
| Creativity | Nobody visualises *terrain-driven* polar illumination as a live, scrubable map with comm windows in the same view |
| Validity | Real LOLA DEM (80 m/px) + IAU lunar orientation + JPL-grade ephemeris; independently validated (see `05-validation.md`) |
| Relevance | Exactly the named challenge, exactly the year's theme (Moon) |
| Presentation | The demo moment is intrinsically visual: shadows sweeping across the pole in one slider |

**Kill-shot demo moment:** drag one slider → the Moon's south pole goes dark and light in real time,
and the site ranking reshuffles live. A judge remembers that after seeing 60 other dashboards.

---

## F. Immediate priorities (ordered)

1. **Create the team** on spaceappschallenge.org (blocks the Project tab; 0 teams currently).
2. **Ship the working app** (terrain + ephemeris are done; UI is the remaining work).
3. **Deploy publicly** to GitHub Pages under `shahaman098` (permanent, judge-safe URL).
4. **Write the submission text** against the 7 mandatory fields, with data provenance.
5. **Produce the 7-slide demo** (safer than a 30 s video on a tight clock), host publicly.
6. **Submit for Judging** — with ≥4 h buffer before 23:59 GMT Sunday.

---

## G. Honest uncertainty

- Judging **weights** per criterion: not published. Assumed equal.
- Whether Universal Event has its own judging panel size/capacity: not published.
- 2026 award winners page is a placeholder ("announced December 18th"); 2025 winner *project details*
  were not retrievable in this session (client-rendered gallery), so the past-winner pattern analysis
  is based on the published award definitions and general Space Apps norms, **not** on inspected 2025 entries.
- Web search was unavailable (HTTP 402) during this session; all findings come from direct fetches of
  `spaceappschallenge.org` and its GraphQL API.
