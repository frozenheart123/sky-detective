# Sky Detective: text for the NASA Space Apps project page

Paste each block into the field with the same name.
(AI-assisted: drafted with Claude Code. Read it and change anything that is not true for you.)

## Project Name

Sky Detective

## High-Level Project Summary

Sky Detective is a public web tool that turns NASA's SPHEREx infrared sky survey into a blink comparator anyone can use. You pick a spot in the sky by name, by coordinates or with a link. The tool finds the SPHEREx images of that spot, lines them up, stacks them for each sky visit and plays them like a short video, so anything that moved or changed brightness stands out at once. Tap any star and the tool measures it: how far it moved, how its brightness changed between visits, and its infrared spectrum from 0.75 to 5 microns. This matters because SPHEREx will image more than a billion objects, far too many for scientists alone, and volunteers using tools like this have already found most of the known brown dwarfs. We tested it on all five targets named in the challenge.

## Link to Project Demo

https://sky-detective-orpin.vercel.app/slides.html

## Link to Final Project

https://sky-detective-orpin.vercel.app/

## Detailed Project Description

WHAT IT DOES
- Enter a star name, or Right Ascension and Declination (decimal degrees or hours/degrees), or open a link such as ?ra=269.4463&dec=4.7682. The five challenge targets are one tap away.
- The tool shows that patch of sky as a series of pictures, one per SPHEREx sky visit (about every six months, or about every 45 days near the ecliptic poles), and blinks them.
- Three views: Blink (one visit after another), Difference (this visit minus the others, so only changes remain) and Add (all visits together, the deepest picture).
- SPHEREx has six detector arrays covering 0.75 to 5 microns. You can view one, or add any of them together to improve the signal.
- Field of view of 3, 5 or 10 arcminutes.
- Tap any star: the tool follows it through the visits and reports its motion in arcseconds and direction, its brightness in each visit, and its spectrum. Each SPHEREx image sees one wavelength at a given spot, so every image adds one point to the spectrum.
- Gaia DR3 stars can be overlaid at their position for the date of each picture. Fast stars get an arrow, and the tool says whether the selected star is in Gaia.
- "About the data" lists the images used, the dates, and what the SPHEREx pipeline flagged (cosmic-ray hits, saturation, snowballs, persistence, satellite streaks).
- The address always holds the coordinates and settings, so a view can be shared, and ?embed=1 gives a small player for other websites. English and Chinese.

HOW IT WORKS
1. Find the images: NASA/IPAC IRSA's image search (SIA, with TAP as a fallback) returns every SPHEREx Level-2 spectral image covering the position, from Data Release 1 and Quick Release 3.
2. Read only what is needed: each image file is about 65 MB. The tool reads the FITS header and only the pixel rows around the target with HTTP range requests, about 60 KB per image.
3. Align: we wrote the FITS world-coordinate maths (TAN projection with SIP distortion) and the wavelength lookup (WCS-WAVE table) in JavaScript, and checked them against astropy. Each image is resampled onto one north-up grid and its background is removed.
4. Stack: images are grouped by sky visit and detector and median-stacked in the browser. Pictures appear while images are still arriving and sharpen as more are added.
5. Measure: centroids per visit give the motion; aperture photometry on every single image gives the spectrum; visits are compared wavelength bin by wavelength bin to get the change in brightness.
New SPHEREx data needs no change to the tool, because every search is live. A new data release is one line in the list of collections.

RESULTS ON THE FIVE TEST TARGETS (measured by the tool from SPHEREx data)
- Barnard's Star: moved 10.2 arcsec north in 12 months, 10.3 arcsec per year (known value 10.4).
- Epsilon Indi B: moved 6.2 arcsec south-east in 16 months, 4.5 arcsec per year (Gaia DR3 gives 4.7).
- WISE 0855: moved 9.6 arcsec west in 12 months. It is visible only in detectors D5 and D6. In 2026 it passes within 3 arcsec of a background star, less than one SPHEREx pixel, so the two blend; this explains why our value is above the known 8.1 arcsec per year. The coordinates in the challenge are its 2010 position; the tool starts from its 2026 position.
- RW Aurigae: does not move; between visits it dimmed by 47% at 3.8 to 5 microns while its short-wavelength light brightened.
- R Draconis: its brightness changed by 74% over 12 time steps. Its core saturates the detectors, so the tool measures the halo and does not report a position.

BENEFITS AND WHAT WE HOPE TO ACHIEVE
A 12-year-old can use it: big controls, plain words, and the tool does the measuring. A scientist gets coordinates, spectra, Gaia matches, data flags and links to the source files. We hope classrooms and volunteers use it to find moving and changing objects in SPHEREx data, in the way WiseView is used for WISE.

STATUS AND LIMITS
- The five test targets open from saved copies of the processed SPHEREx data (made on 14 November), so they work even when the archive is slow. In a saved copy the spectrum is available for the target itself.
- Any other coordinates are read from IRSA live. On 15 November the image search answered at midday (358 images found in 2.5 seconds) and returned errors in the evening, so live mode could not be tested end to end again before the deadline. When the archive does not answer, the tool says so.
- Very bright stars saturate SPHEREx; the tool shows this instead of a wrong measurement.
- Development notes: a first prototype and the Python script that made the saved copies were started on 13 November; the tool submitted here (backend and interface) was written on 14 and 15 November.

TOOLS
JavaScript (Node.js serverless functions on Vercel, no dependencies), HTML, CSS, Canvas and SVG for the interface, Python with astropy, NumPy and SciPy for the saved copies and for reference values, and 19 automated tests (node:test).

SOURCE CODE
https://github.com/frozenheart123/sky-detective

## Use of Super Intelligence (SI)

Yes. I used Claude Code (Anthropic; models Claude Opus 5.5 and Claude Fable 5.2) as an AI coding assistant throughout.
- I chose the challenge and set the goals: an interface a 12-year-old can operate, real SPHEREx data instead of simulated data, every requirement of the challenge working, and a redesign of the first version.
- Claude read the challenge resources and the IRSA documentation, wrote and tested the code (data reading, coordinate maths, stacking, measurements, interface), ran the tests, and drafted the project text and slides, which I reviewed.
- Every source file says in its header that it was written with AI assistance.
- All sky images shown are real SPHEREx data. No image, video or audio was generated by AI. The logo and charts are drawn by code.

## NASA Data

SPHEREx Level-2 Spectral Images, Data Release 1 and Quick Release 3, from the NASA/IPAC Infrared Science Archive (IRSA): https://irsa.ipac.caltech.edu/Missions/spherex.html
- How we use it: the tool reads the calibrated image (MJy/sr), the image header (astrometry, dates, quality flags) and the WCS-WAVE wavelength table of each SPHEREx image that covers the chosen position, then aligns, stacks, blinks and measures them.
- Images covering the five test targets: Barnard's Star 358, WISE 0855 258, Epsilon Indi B 458, RW Aurigae 335, R Draconis 2,493.
- IRSA services used: SPHEREx image search (Simple Image Access), TAP, and the image file server (byte-range requests).
- SPHEREx tutorial notebooks from IRSA (data overview and cutouts): https://caltech-ipac.github.io/irsa-tutorials/spherex/
- WiseView, the tool for NASA's WISE mission that inspired this one; Sky Detective links to it for cross-checks: http://byw.tools/wiseview
- Acknowledgement: This work makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.

## Space Agency Partner Data and Other References

- ESA (European Space Agency): Gaia Data Release 3, star positions, proper motions and parallaxes, from the ESA Gaia Archive (https://gea.esac.esa.int/archive/) and the copy served by NASA/IPAC IRSA.
- CDS Sesame name resolver (SIMBAD, NED, VizieR) for looking up star names: https://cds.unistra.fr/cgi-bin/Sesame
- Astropy, NumPy and SciPy (Python) for the saved copies and for reference values in the tests.
- FITS world coordinate standards: Greisen and Calabretta (2002), Calabretta and Greisen (2002), and the SIP distortion convention (Shupe et al. 2005).
- Node.js and Vercel for hosting; fonts Atkinson Hyperlegible Next (Braille Institute) and IBM Plex Mono, from Google Fonts.
- AI assistant: Claude Code (Anthropic).
