# Pinpoint

A radiology training game. One image per case: click where you think the abnormality is,
get scored on precision, and learn from the reveal. Built as a fast, fully client-side
single-page app.

**Live: [pinpoint-jade.vercel.app](https://pinpoint-jade.vercel.app)**

Dark-first UI designed for reading-room conditions, with a light theme toggle.

## Features

- **Landing page** with a live one-click demo, driven by the same viewer and scoring engine
  as the game.
- **Game mode**: play through cases sequentially or shuffled, filtered by subspecialty
  (Chest, MSK, Neuro, Abdominal, Cardiac, Head & Neck, Pediatric, Breast), modality, and
  difficulty. Optional per-case countdown with a speed bonus.
- **Precision scoring**: full points inside the ground-truth region, partial points scaled
  by distance for close misses, zero beyond a configurable threshold. All thresholds are
  adjustable from the home screen (Scoring panel).
- **Two case pools**: a curated **Library** of bundled, openly licensed teaching cases
  (read-only, always restorable) and **My cases** for your own uploads, kept only in your
  browser. Rounds can draw from either pool or both.
- **Scrollable CT/MRI stacks**: cases can hold a multi-slice image stack. Scroll with the
  mouse wheel or the side slider to find the right level, then click. Ground truth is
  per-slice, scoring is slice-aware (a click on the wrong slice misses), and the reveal
  jumps to the slice with the finding. A curated normal-brain CT stack ships as an example.
- **Case builder**: add cases from any de-identified PNG/JPG. Upload a single image, or
  several files at once for a scrollable stack. Draw the ground truth directly on the image
  with ellipse, box, freehand polygon, or point tools; multiple regions per case, on any
  slice, are supported. Metadata: subspecialty, modality, body region, difficulty, clinical
  stem, teaching point, image credit.
- **Case library filters**: filter each pool by subspecialty, modality, and difficulty, or
  search by finding name.
- **Study mode**: browse any case with the answer overlaid, no scoring.
- **Stats**: local score history, hit rate overall and by modality.
- **Import / export**: cases (including uploaded images) round-trip through a single JSON
  file, so a case set can be shared with a colleague.
- Keyboard: `Enter` next case, `Esc` exit round, arrow keys and `R` in study mode.

## Running it

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
```

The build is static files only; host `dist/` anywhere (GitHub Pages, Netlify, etc.).

## How scoring works

Region coordinates are stored normalized (0 to 1) against the image, so ground truth is
independent of display size. A click is evaluated in the image's natural pixel space:

- inside a region: full points (default 100),
- outside but within the close-miss range (default 12% of the image diagonal): partial
  points falling off linearly with distance (default max 60),
- beyond that: zero.

Cases with several findings give you one click per finding; the case score is the mean of
the per-region scores. With the timer on, a bonus of up to 50 points scales with remaining
time and answer quality.

## Adding cases

1. **Cases > New case**, drop in a de-identified PNG or JPG.
2. Pick a tool and draw the abnormality region (ellipse, box, freehand outline, or point).
   Add more regions if the case has several findings.
3. Fill in the finding name, an optional clinical stem, and a one-line teaching point.
4. Save. The case (image included) is stored in your browser's IndexedDB.

Only upload images that are de-identified and that you have the right to use.

## Architecture notes

- **Stack**: React 19, Vite, Tailwind CSS v4 (CSS-variable design tokens, dark/light),
  Phosphor icons, self-hosted Geist / Geist Mono. No router, no state library: a small
  discriminated-union route state in `App.tsx` is enough for four screens.
- **Persistence** is intentionally client-side so the app deploys as static files: cases
  live in IndexedDB (uploaded images as Blobs), settings and history in localStorage.
  Bundled seed cases are copied into IndexedDB on first run; deleting one leaves a
  tombstone so it stays deleted, and "Restore bundled" brings them back. If multi-user
  shared uploads are ever needed, that is a backend + database project; the storage module
  (`src/lib/storage.ts`) is the single seam to swap.
- **Hit testing** (`src/lib/geometry.ts`) computes point-to-shape distance for ellipse,
  rect, polygon, and point ground truths in natural-pixel space, then normalizes by the
  image diagonal so scoring is aspect- and resolution-independent.
- **Viewer** (`src/components/ImageViewer.tsx`): the container is sized to the image's
  exact aspect ratio, and an SVG overlay shares that box with a natural-pixel `viewBox`,
  so pointer coordinates map 1:1 to normalized image coordinates at any display size. A
  multi-frame case resolves to a list of slice URLs/Blobs; wheel and slider events change
  the active slice, and that slice flows through every pointer and overlay callback so
  scoring and drawing stay slice-aware.
- **DICOM**: out of scope for now; the viewer accepts standard PNG/JPG exports and treats a
  stack as an ordered set of slice images. Native `.dcm` with windowing/leveling would slot
  in behind the viewer via cornerstone3D.

## Bundled case images

All seed images are de-identified, openly licensed teaching files from Wikimedia Commons.

| Case | Source file | Author | License |
| --- | --- | --- | --- |
| Pneumothorax | [Pneumothorax CXR.jpg](https://commons.wikimedia.org/wiki/File:Pneumothorax_CXR.jpg) | Clinical Cases | CC BY-SA 2.5 |
| Lobar pneumonia | [X-ray of lobar pneumonia.jpg](https://commons.wikimedia.org/wiki/File:X-ray_of_lobar_pneumonia.jpg) | Mikael Häggström, M.D. | CC0 |
| Colles fracture | [Colles' Fracture of Radius.jpg](https://commons.wikimedia.org/wiki/File:Colles%27_Fracture_of_Radius.jpg) | Lucien Monfils | CC BY-SA 4.0 |
| Epidural hematoma | [Traumatic acute epidual hematoma.jpg](https://commons.wikimedia.org/wiki/File:Traumatic_acute_epidual_hematoma.jpg) | Jpogi | CC BY-SA 3.0 |
| Shoulder dislocation | [Shoulder dislocation, anteroposterior before reduction.jpg](https://commons.wikimedia.org/wiki/File:Shoulder_dislocation,_anteroposterior_before_reduction.jpg) | Mikael Häggström, M.D. | CC0 |
| Hip fracture | [X-ray of a comminuted hip fracture.jpg](https://commons.wikimedia.org/wiki/File:X-ray_of_a_comminuted_hip_fracture.jpg) | Memon, Patel and Juva | CC BY 4.0 |
| Lateral ventricles (CT stack) | [CT of a normal brain, axial 14-23.png](https://commons.wikimedia.org/wiki/File:CT_of_a_normal_brain,_axial_16.png) | Mikael Häggström, M.D. | CC0 |

The CT stack is ten consecutive axial slices, cropped to the axial panel and framed as a
cross-sectional anatomy localization task (not a pathology case). Ground-truth regions and
teaching points were authored for this app and are approximate;
they are for training the eye, not for clinical reference.

## Disclaimer

Pinpoint is an educational game. It is not a medical device and must not be used for
diagnosis or clinical decision-making.
