# SUNLOCK — text for the Space Apps project page (15 Nov 2026)

## Summary

SUNLOCK answers one question for a lunar south-pole mission: if this lander touches down at this site on this date, does it survive its stay? It opens on a 3D Moon lit from the Sun's true direction, with NASA's nine Artemis III candidate regions marked. Pick a site, a date and a lander (power use, panel area, battery) and it reports SURVIVES or BATTERY DIES, the date it fails, and the smallest change that fixes it.

Under the verdict is NASA's LRO LOLA terrain at 80 metres per pixel. At each site SUNLOCK computes the skyline in 360 directions out to 150 km, then tests the Sun and Earth against it every 30 minutes to get sunlight, Earth-contact windows and battery charge through the stay.

At de Gerlache Rim 2, a 100 W lander with a 10 kWh battery that lands on 4 February 2027 loses power on 12 February. Landing at 11:30 UTC on 16 February, it survives the 14-day stay with about 59 percent of its usable battery charge remaining at its lowest point.

The sunlight model was tested against NASA's own maps, with pass marks written down beforehand: r = 0.990 against the LOLA team's 18.6-year sunlight map and r = 0.980 against LROC's photograph-based map.

## Project demonstration

https://shahaman098.github.io/sunlock-app/demo/sunlock-demo.pdf

## Project

https://shahaman098.github.io/sunlock-app/

## Project details

SUNLOCK is a landing-window navigator for the lunar south pole. It tells a mission team, an educator or a curious member of the public whether a given lander survives a given landing, and when it would be better to land instead.

The problem
Near the lunar south pole the Sun stays low in the sky, so nearby terrain strongly affects lighting. A ridge a few hundred metres away can keep a site dark for days while its neighbour stays lit. Earth also sits low, so geometric visibility changes over days. SUNLOCK evaluates sunlight, battery survival and geometric Earth visibility for a specified lander, arrival time and stay. Ground stations and radio link budgets require separate analysis.

What it does
The app opens on the whole Moon in 3D, lit for the chosen date, with landing sites marked as sunlit or in shadow. Selecting a site shows the verdict for your lander: it survives, or the battery dies on a stated date, or Earth stays hidden too long. A mission console adds the south-pole shadow map, a year-long timeline of sunlight and Earth contact, the best landing dates, a comparison of all sites against all landing dates, a site finder that filters by sunlight, Earth visibility and slope, and stress cases such as landing a day late or panels giving 20 percent less.

Example
de Gerlache Rim 2, 100 W lander, 4 square metres of panels, 10 kWh battery, 14-day stay. Land 4 February 2027: battery dies on 12 February. Land 14 February: dies on 17 February. Land 16 February at 11:30 UTC: survives, battery never below 59 percent.

How it works
1. Terrain. NASA LRO LOLA south-polar elevation model LDEM_80S_80M, 80 metres per pixel.
2. Skyline. At named polar sites the horizon is traced in 360 directions out to 150 km, with the Moon's curvature included. Arbitrary coordinates use coarser terrain and are labelled preliminary.
3. Sky. Sun and Earth directions every 30 minutes from Astronomy Engine, rotated into the Moon's body-fixed frame with the IAU 2015 model. Checked against NASA JPL Horizons at 12 epochs: within 23 arcseconds.
4. Verdict. A site is sunlit while any part of the Sun's disc clears the skyline, and can see Earth while part of Earth's disc clears it. The power model scales generation by the visible fraction of the solar disc, subtracts electrical loads and follows usable battery charge through the stay.
Everything runs in the browser, with no server.

Validation
Four tests against NASA products, with pass marks committed before any comparison was run. All four pass.
- Sunlight against the LOLA team's 18.6-year map: r = 0.990 at 1,782 random points south of 85 degrees S (pass mark 0.90).
- Permanent shadow against the LOLA team's map: intersection over union 0.926 (pass mark 0.80).
- Sunlight against LROC's photograph-based illumination map: r = 0.980 at 296 points (pass mark 0.85).
- Earth visibility against the LOLA team's map: r = 0.989 (pass mark 0.90).
An exploratory check used 261 timestamped LROC photographs from December 2009. A half-disc visibility rule agrees with photograph brightness on 96.6 percent of 467,973 samples, against an always-dark baseline of 81.2 percent. For photographed sunrises and sunsets matched within a day, median timing error is 0.5 hours; 16 percent have no match. Of seven-day missions predicted to survive under that rule, 82.7 percent also survived using photograph-derived sunlight in the same power model. The app's any-part-of-disc rule gives 95.4 percent brightness agreement, a 3.28-hour matched median timing error and 77.8 percent confirmation among predicted survivors. This checks sunlight sequences feeding the model. Photograph coverage did not support a continuous 14-day comparison. The app shows the frames and disagreements.

Limits
No thermal, dust or detailed power-system model. Terrain is 80 metres per pixel, so narrower ridges are missed. Slope and hazards are not checked away from the candidate sites. Approach lighting and landing accuracy are not covered. Not an official NASA product.

Tools
TypeScript, React, three.js and Vite in the browser; Node scripts for the terrain pipeline and validation; Astronomy Engine for ephemerides; JPL Horizons for independent checks. The data pipeline records the SHA-256 of every NASA input and every output.

Code: https://github.com/shahaman098/sunlock-app
