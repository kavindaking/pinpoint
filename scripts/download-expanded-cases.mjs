import { access, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const files = [
  ["pleural-effusion", "File:Pleural effusion of primary pulmonary tuberculosis.jpg"],
  ["hilar-tb", "File:Chest x-ray of bilateral hilar adenopathy of primary pulmonary tuberculosis.jpg"],
  ["gallstones", "File:Ultrasonography of sludge and gallstones.jpg"],
  ["rib-fractures", "File:56-03-Rippenfrakturen - Thorax Pneu 2 Tage spaeter.png"],
  ["bullous-emphysema", "File:Medical X-Ray imaging WFH07 nevit.jpg"],
  ["rll-atelectasis", "File:Unterlappenatelektase rechts pa.jpg"],
  ["hiatal-hernia", "File:07-01-Hiatushernie pa.png"],
  ["situs-inversus", "File:Situs inversus chest Nevit.jpg"],
  ["bronchiectasis", "File:Massive Bronchiektasen - CT LF axial 001.jpg"],
  ["sarcoidosis", "File:Pulmonale Sarkoidose 37M - CR pa und CT coronar - 001.jpg"],
  ["lung-metastases", "File:Lungenmetastasen bei Zervixkarzinom 50W - CT - 001.jpg"],
  ["mediastinal-mass", "File:Rad 1300180.JPG"],
  ["ccam", "File:Zystisch adenomatoide Malformation bei Neugeborenem-Roe.jpg"],
  ["aortic-dissection", "File:Dissektion im Aortenbogen im Roentgenbild 76W - CR und CT - 001.jpg"],
  ["pulmonary-fibrosis", "File:IPF amiodarone.JPG"],
  ["clavicle-fracture", "File:Medical X-Ray imaging FXJ04 nevit.jpg"],
  ["scaphoid-fracture", "File:Scaphoid fracture with a radiolucent line after 12 days.jpg"],
  ["boxer-fracture", "File:Boxerfraktur.png"],
  ["ankle-fracture", "File:Medical X-Ray imaging CIT03 nevit.jpg"],
  ["tibial-plateau-fracture", "File:Okkulte Tibiakopffraktur.jpg"],
  ["patella-fracture", "File:Patella-Querfraktur kaum disloziert.png"],
  ["knee-osteoarthritis", "File:Rad 1300125.JPG"],
  ["synovial-chondromatosis", "File:Bakerzyste mit Chondromen.jpg"],
  ["rheumatoid-hand", "File:Rheumatoide Arthritis der Hand 65W - CR ap - 001.jpg"],
  ["gout-foot", "File:Gichtfuss im Roentgenbild 002.png"],
  ["spondylolisthesis", "File:Spondylolisthesis vera 57M - CR seitlich - 001.jpg"],
  ["scoliosis", "File:Medical X-Ray imaging CUP03 nevit.jpg"],
  ["humeral-metastasis", "File:Ossaere Metastase Lungenkarzinom distaler Humerus 56W - CR und CT - 001.jpg"],
  ["segond-fracture", "File:Segond-Fraktur 38jm - Roe und CT - 001.png"],
  ["calcaneal-fracture", "File:STIR MRI of of calcaneal fracture.jpg"],
  ["subdural-hematoma", "File:Parafalzines Subduralhaematom 74M - CT - 001.jpg"],
  ["subarachnoid-hemorrhage", "File:Subarachnoidalblutung traumatisch 83W - CT - 001.jpg"],
  ["cerebral-contusion", "File:Frontale Kontusionsblutung als Contre coup 01.png"],
  ["hydrocephalus", "File:Langjaehrig bestehender Hydrocephalus 48M - CT - 001.jpg"],
  ["falx-meningioma", "File:Falxmeningeom MRT T1 mit Kontrastmittel.jpg"],
  ["glioblastoma", "File:Glioblastoma multiforme - MRT T1KM ax.jpg"],
  ["cerebral-aneurysm", "File:Aneurysma A cerebri media.jpg"],
  ["brain-metastases", "File:BC - Hirnmetastasen MRT T1KM ax.jpg"],
  ["spinal-meningioma", "File:Meningeom im Spinalkanal MRT.jpg"],
  ["breast-cancer", "File:Mammogram showing breast cancer.jpg"],
  ["appendicitis", "File:Hufeisenniere 05 mit Appendizitis - CT - axial - 011.jpg"],
  ["staghorn-calculus", "File:Ausgussstein des rechten Nierenbeckens 84W - CR CT MR - 001.jpg"],
  ["acute-pancreatitis", "File:Akute exsudative Pankreatitis - CT axial.jpg"],
  ["diverticulitis", "File:02-Sigmadivertikulitis CT ax 001 Umgebung.png"],
  ["pneumoperitoneum", "File:Pneumoperitoneum bei Sigmaperforation 76M - CR LSL - 001.jpg"],
  ["liver-metastases", "File:MANEC Leberfiliae 49jm.jpg"],
  ["renal-cell-carcinoma", "File:Zystoides Nierenzellkarzinom 73W - CT axial und coronar KM pv - 001.jpg"],
  ["splenic-laceration", "File:Milzruptur - Computertomographie axial - pv-Kontrastphase 001.jpg"],
  ["crohn-ileitis", "File:Ileitis terminalis bei langjaehrigem Morbus Crohn 63W - CT und MRT - 001.jpg"],
  ["mesenteric-ischemia", "File:Gas in Pfortaderaesten bei Mesenterialischaemie 90W - CT axial KM - 001.jpg"],
];

const outputDir = new URL("../public/cases/expanded/", import.meta.url);
await mkdir(outputDir, { recursive: true });
const sources = [];

async function fetchWithRetry(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": "PinpointRadiology/1.0 (educational case curation)" },
    });
    if (response.ok) return response;
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
  throw new Error(`Request failed: ${url}`);
}

for (let start = 0; start < files.length; start += 10) {
  const batch = files.slice(start, start + 10);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "300",
    titles: batch.map(([, title]) => title).join("|"),
    origin: "*",
  });
  const response = await fetchWithRetry(`https://commons.wikimedia.org/w/api.php?${params}`);
  const data = await response.json();
  const pages = new Map((data.query?.pages ?? []).map((page) => [page.title, page]));

  for (const [slug, title] of batch) {
    const info = pages.get(title)?.imageinfo?.[0];
    if (!info) throw new Error(`No image info for ${title}`);
    const extension = info.thumbmime === "image/png" || info.mime === "image/png" ? "png" : "jpg";
    const destination = fileURLToPath(new URL(`${slug}.${extension}`, outputDir));
    let exists = true;
    try {
      await access(destination);
    } catch {
      exists = false;
    }
    if (!exists) {
      const curlArgs = ["-L", "--fail", "--retry", "8", "--retry-all-errors", "--retry-delay", "8", "-o", destination];
      try {
        await execFileAsync("curl", [...curlArgs, info.thumburl ?? info.url]);
      } catch {
        await execFileAsync("curl", [...curlArgs, info.url]);
      }
    }
    const metadata = info.extmetadata ?? {};
    const clean = (value = "") => value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    sources.push({
      slug,
      file: `${slug}.${extension}`,
      title,
      page: info.descriptionurl,
      creator: clean(metadata.Artist?.value) || clean(metadata.Credit?.value) || "Wikimedia Commons contributor",
      license: clean(metadata.LicenseShortName?.value),
      licenseUrl: metadata.LicenseUrl?.value,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

await writeFile(new URL("sources.json", outputDir), `${JSON.stringify(sources, null, 2)}\n`);
await writeFile(
  new URL("../src/data/expandedSources.json", import.meta.url),
  `${JSON.stringify(sources, null, 2)}\n`,
);
console.log(`Downloaded ${sources.length} cases.`);
