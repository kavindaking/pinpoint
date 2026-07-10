import type { RadCase } from "../types";

/**
 * Bundled teaching cases. All images are de-identified, openly licensed
 * files from Wikimedia Commons; attribution is kept on each case and in the
 * README. Region coordinates are normalized (0..1) against the image.
 */
export const SEED_CASES: RadCase[] = [
  {
    id: "seed-pneumothorax",
    title: "Pneumothorax",
    stem: "28-year-old, sudden left pleuritic chest pain and breathlessness.",
    explanation:
      "A large left pneumothorax: the visceral pleural edge is visible with no lung markings beyond it, and the underlying lung is partially collapsed toward the hilum.",
    modality: "X-ray",
    bodyRegion: "Chest",
    subspecialty: "Chest",
    difficulty: "medium",
    regions: [
      {
        id: "r1",
        label: "Pleural air space",
        shape: { kind: "ellipse", cx: 0.79, cy: 0.35, rx: 0.17, ry: 0.29 },
      },
    ],
    imageUrl: "/cases/pneumothorax.jpg",
    credit: "Clinical Cases, Wikimedia Commons, CC BY-SA 2.5",
    seed: true,
    createdAt: 1,
  },
  {
    id: "seed-lobar-pneumonia",
    title: "Lobar pneumonia",
    stem: "62-year-old, fever and productive cough with focal crackles.",
    explanation:
      "Confluent consolidation in the right mid and lower zones. Dense airspace opacity with preserved lung volume is typical of lobar pneumonia.",
    modality: "X-ray",
    bodyRegion: "Chest",
    subspecialty: "Chest",
    difficulty: "easy",
    regions: [
      {
        id: "r1",
        label: "Consolidation",
        shape: { kind: "ellipse", cx: 0.27, cy: 0.7, rx: 0.17, ry: 0.19 },
      },
    ],
    imageUrl: "/cases/lobar-pneumonia.jpg",
    credit: "Mikael Häggström, M.D., Wikimedia Commons, CC0",
    seed: true,
    createdAt: 2,
  },
  {
    id: "seed-colles",
    title: "Colles fracture",
    stem: "68-year-old fell on an outstretched hand; painful, deformed wrist.",
    explanation:
      "Extra-articular fracture of the distal radial metaphysis with dorsal angulation of the distal fragment, the classic dinner-fork pattern. Find it on both views.",
    modality: "X-ray",
    bodyRegion: "Upper limb",
    subspecialty: "MSK",
    difficulty: "medium",
    regions: [
      {
        id: "r1",
        label: "Fracture, frontal view",
        shape: { kind: "ellipse", cx: 0.315, cy: 0.53, rx: 0.095, ry: 0.06 },
      },
      {
        id: "r2",
        label: "Fracture, lateral view",
        shape: { kind: "ellipse", cx: 0.72, cy: 0.51, rx: 0.09, ry: 0.06 },
      },
    ],
    imageUrl: "/cases/colles-fracture.jpg",
    credit: "Lucien Monfils, Wikimedia Commons, CC BY-SA 4.0",
    seed: true,
    createdAt: 3,
  },
  {
    id: "seed-edh",
    title: "Epidural hematoma",
    stem: "Teenager struck on the head; lucid interval, then rapid deterioration.",
    explanation:
      "A biconvex (lentiform) hyperdense extra-axial collection that does not cross sutures, classically from middle meningeal artery injury after a skull fracture.",
    modality: "CT",
    bodyRegion: "Head",
    subspecialty: "Neuro",
    difficulty: "easy",
    regions: [
      {
        id: "r1",
        label: "Hyperdense collection",
        shape: { kind: "ellipse", cx: 0.22, cy: 0.16, rx: 0.2, ry: 0.12 },
      },
    ],
    imageUrl: "/cases/epidural-hematoma.jpg",
    credit: "Jpogi, Wikimedia Commons, CC BY-SA 3.0",
    seed: true,
    createdAt: 4,
  },
  {
    id: "seed-shoulder",
    title: "Anterior shoulder dislocation",
    stem: "25-year-old fell onto an abducted arm; arm held in external rotation.",
    explanation:
      "The humeral head sits inferomedial to the glenoid in a subcoracoid position, the classic appearance of anterior glenohumeral dislocation.",
    modality: "X-ray",
    bodyRegion: "Upper limb",
    subspecialty: "MSK",
    difficulty: "easy",
    regions: [
      {
        id: "r1",
        label: "Displaced humeral head",
        shape: { kind: "ellipse", cx: 0.55, cy: 0.4, rx: 0.23, ry: 0.14 },
      },
    ],
    imageUrl: "/cases/shoulder-dislocation.jpg",
    credit: "Mikael Häggström, M.D., Wikimedia Commons, CC0",
    seed: true,
    createdAt: 5,
  },
  {
    id: "seed-hip",
    title: "Comminuted trochanteric fracture",
    stem: "81-year-old after a fall; unable to bear weight, leg shortened and externally rotated.",
    explanation:
      "A comminuted fracture through the trochanteric region of the proximal femur with displacement. Trochanteric fractures are extracapsular, so femoral head blood supply is usually preserved.",
    modality: "X-ray",
    bodyRegion: "Pelvis",
    subspecialty: "MSK",
    difficulty: "easy",
    regions: [
      {
        id: "r1",
        label: "Fracture site",
        shape: { kind: "ellipse", cx: 0.62, cy: 0.45, rx: 0.2, ry: 0.17 },
      },
    ],
    imageUrl: "/cases/hip-fracture.jpg",
    credit: "Memon, Patel and Juva, Wikimedia Commons, CC BY 4.0",
    seed: true,
    createdAt: 6,
  },
];
