import type { Difficulty, Modality, Subspecialty } from "../types";

export interface CurriculumTarget {
  finding: string;
  modality: Modality;
  subspecialty: Subspecialty;
  difficulty: Difficulty;
}

export const HIGH_YIELD_TARGETS: CurriculumTarget[] = [
  { finding: "Small apical pneumothorax", modality: "X-ray", subspecialty: "Chest", difficulty: "hard" },
  { finding: "Right lower lobe collapse", modality: "X-ray", subspecialty: "Chest", difficulty: "medium" },
  { finding: "Pulmonary embolism", modality: "CT", subspecialty: "Chest", difficulty: "medium" },
  { finding: "Early pulmonary edema", modality: "X-ray", subspecialty: "Chest", difficulty: "hard" },
  { finding: "Scaphoid waist fracture", modality: "X-ray", subspecialty: "MSK", difficulty: "hard" },
  { finding: "Tibial plateau fracture", modality: "X-ray", subspecialty: "MSK", difficulty: "hard" },
  { finding: "Posterior shoulder dislocation", modality: "X-ray", subspecialty: "MSK", difficulty: "hard" },
  { finding: "Septic arthritis", modality: "MRI", subspecialty: "MSK", difficulty: "medium" },
  { finding: "Hyperacute MCA infarct", modality: "CT", subspecialty: "Neuro", difficulty: "hard" },
  { finding: "Subarachnoid hemorrhage", modality: "CT", subspecialty: "Neuro", difficulty: "medium" },
  { finding: "Cerebral venous sinus thrombosis", modality: "MRI", subspecialty: "Neuro", difficulty: "hard" },
  { finding: "Posterior fossa mass", modality: "MRI", subspecialty: "Neuro", difficulty: "medium" },
  { finding: "Acute appendicitis", modality: "CT", subspecialty: "Abdominal", difficulty: "medium" },
  { finding: "Closed-loop small bowel obstruction", modality: "CT", subspecialty: "Abdominal", difficulty: "hard" },
  { finding: "Acute cholecystitis", modality: "Ultrasound", subspecialty: "Abdominal", difficulty: "medium" },
  { finding: "Mesenteric ischemia", modality: "CT", subspecialty: "Abdominal", difficulty: "hard" },
  { finding: "Aortic dissection", modality: "CT", subspecialty: "Cardiac", difficulty: "medium" },
  { finding: "Pericardial effusion", modality: "Ultrasound", subspecialty: "Cardiac", difficulty: "medium" },
  { finding: "Aortic stenosis", modality: "Ultrasound", subspecialty: "Cardiac", difficulty: "hard" },
  { finding: "Coronary artery calcification", modality: "CT", subspecialty: "Cardiac", difficulty: "easy" },
  { finding: "Epiglottitis", modality: "X-ray", subspecialty: "Head & Neck", difficulty: "hard" },
  { finding: "Peritonsillar abscess", modality: "CT", subspecialty: "Head & Neck", difficulty: "medium" },
  { finding: "Mandibular fracture", modality: "CT", subspecialty: "Head & Neck", difficulty: "medium" },
  { finding: "Retropharyngeal abscess", modality: "CT", subspecialty: "Head & Neck", difficulty: "hard" },
  { finding: "Intussusception", modality: "Ultrasound", subspecialty: "Pediatric", difficulty: "medium" },
  { finding: "Pyloric stenosis", modality: "Ultrasound", subspecialty: "Pediatric", difficulty: "medium" },
  { finding: "Developmental dysplasia of the hip", modality: "X-ray", subspecialty: "Pediatric", difficulty: "hard" },
  { finding: "Necrotizing enterocolitis", modality: "X-ray", subspecialty: "Pediatric", difficulty: "medium" },
  { finding: "Spiculated breast mass", modality: "X-ray", subspecialty: "Breast", difficulty: "medium" },
  { finding: "Architectural distortion", modality: "X-ray", subspecialty: "Breast", difficulty: "hard" },
  { finding: "Suspicious microcalcifications", modality: "X-ray", subspecialty: "Breast", difficulty: "hard" },
  { finding: "Simple breast cyst", modality: "Ultrasound", subspecialty: "Breast", difficulty: "easy" },
];
