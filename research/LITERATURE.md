# Literature review — lunar polar illumination

Compiled 15 Nov 2026. Sources were found with the OpenAlex API and read from NASA NTRS
open PDFs where available. Numbers below are **quoted**, not remembered; anything not read
directly is marked as second-hand via the review paper that reports it.

---

## Why the comparison is not trivial

Published "illumination percentages" differ in at least five ways that each move the answer
by more than the effect most papers are trying to measure:

1. **Terrain resolution** — 20 m to 240 m per pixel across the key studies.
2. **Observer height** — surface level vs 2 m above ground.
3. **Temporal baseline** — one year vs twenty years.
4. **Criterion** — Sun centre above the horizon vs *any part of the disc* visible.
5. **Site choice** — a searched optimum cluster vs an arbitrary or region-centre coordinate.

A number is only comparable if all five are stated.

---

## Studies

| Study | DOI | DTM resolution | Baseline | Observer height | Headline result |
|---|---|---|---|---|---|
| Mazarico et al. 2011, *Icarus* | 10.1016/j.icarus.2010.10.030 | **240 m/px** | 20 yr | surface | max average illumination ≈ 86% |
| Speyerer & Robinson 2013, *Icarus* | 10.1016/j.icarus.2012.10.010 | **100 m/px** (LROC WAC) | 1 yr | surface | persistently illuminated regions |
| Gläser et al. 2014, *Icarus* | 10.1016/j.icarus.2014.08.013 | high-res DTM | — | — | south-pole illumination |
| **Gläser et al. 2017** (NTRS 20170007365) | — | **20 m/px** (LOLA) | **20 yr**, hourly | surface **and 2 m** | **88.0%** max at Connecting Ridge C1; 92.1% longest solar visibility |
| Barker et al. 2021, *P&SS* (NTRS 20205009660) | 10.1016/j.pss.2020.105119 | **5 m/px** | — | — | error propagation into horizon elevation and illumination |

The resolution spread alone (20 m → 240 m) is a factor of 12.

## The definition used by the most-cited modern study

Gläser et al. 2017 define solar visibility as:

> *"the percentage of a given period in which **any portion of the Sun is visible**. On average,
> 88.5% of the time the Sun is at least partially visible there."*

and at 2 m above ground:

> *"The maximum average illumination of **88.0%** is now found at the south pole at Connecting
> Ridge (C1). There also the longest solar visibility of **92.1%** is found."*

Their south-polar cluster values at 2 m (Table 3 of the paper):

| Cluster | Max average illumination | Solar visibility | Longest shadow |
|---|---|---|---|
| Shackleton S0 | 85.5% | 89.4% | ~17 d? (table columns truncated in extraction) |
| Shackleton S1 | 84.3% | 89.8% | — |
| Shackleton S2 | 73.9% | 78.8% | — |

and

> *"these sites are typically illuminated for about 90%"* … *"Maximum times in shadow of less
> than three and up to eight days were calculated for these sites."*

## Resolution cuts both ways — an important subtlety

Gläser et al. argue that *coarser* data **underestimates** illumination of the *area*:

> *"the lower resolution of the images used in the study of Speyerer and Robinson (2013)
> compared to the LOLA DTM of this study is underestimating illumination since small-scale
> illuminated areas less than 100 meters across are [not resolved]"*

but they also note the illuminated ridges are narrow:

> *"ridges, whose width however, only reaches **twenty to forty meters** (one to two pixels)"*

This is consistent with — not contradictory to — our finding, because the two are different
metrics:

- **Area fraction at an instant**: coarse terrain misses small lit patches → *underestimates*.
- **Time series at a point**: coarse terrain misses small obstructions → *overestimates*.

Our work measures the second.

## Barker et al. on error propagation

Barker et al. 2021 build 5 m/px products for four south-pole landing sites and report:

> *"Natural terrain slope variations and sub-pixel sampling cause [uncertainty] to be larger
> than [geolocation error]"*

and that these uncertainties *"propagate to variations in horizon elevation and thus the
predicted illumination conditions at these polar latitudes."*

That is an independent statement of the effect we quantify in our report.

---

## Where our tool sits

| Our convention | Value at 89.438°S, 222.717°E |
|---|---|
| 80 m DEM, nearest-neighbour, 2-pixel (160 m) steps, disc centre | **86.4%** |
| 20 m DEM, same sampling | 85.9% |
| Converged bilinear, disc centre | ~55% |
| Converged bilinear, any part of disc | ~71% |
| Gläser 2017 (20 m, 20 yr, 2 m, any part, optimised cluster) | 85.5–88.0% |

Our shipped 86% is numerically inside the published band, but it is **disc-centre at a
region-centre coordinate**, whereas the literature value is **any-part-of-disc at a searched
cluster**. Two approximations offset: coarse sampling inflates by ~15 points, the stricter
criterion deflates by ~8–12.

The one directly comparable quantity is the **longest continuous darkness at the Shackleton
peak: 3.5 days**, inside Gläser's "less than three and up to eight days".

---

## References

1. Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., Torrence, M. H. (2011).
   Illumination conditions of the lunar polar regions using LOLA topography. *Icarus* 211,
   1066–1081. doi:10.1016/j.icarus.2010.10.030
2. Speyerer, E. J., Robinson, M. S. (2013). Persistently illuminated regions at the lunar
   poles: Ideal sites for future exploration. *Icarus* 222, 122–136.
   doi:10.1016/j.icarus.2012.10.010
3. Gläser, P., Oberst, J., Neumann, G. A., Mazarico, E., Speyerer, E. J., Robinson, M. S.
   (2017). Illumination conditions at the lunar poles: Implications for future exploration.
   NASA NTRS 20170007365.
4. Gläser, P., Scholten, F., De Rosa, D., Marco Figuera, R., Oberst, J., Mazarico, E.,
   Neumann, G. A., Robinson, M. S. (2014). Illumination conditions at the lunar south pole
   using high resolution Digital Terrain Models from LROC. *Icarus* 243, 78–90.
   doi:10.1016/j.icarus.2014.08.013
5. Barker, M. K., et al. (2021). Improved LOLA elevation maps for south pole landing sites:
   Error estimates and their impact on illumination conditions. *Planetary and Space Science*
   203, 105119. doi:10.1016/j.pss.2020.105119. NASA NTRS 20205009660.
