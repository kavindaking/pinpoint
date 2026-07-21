import { upload } from "@vercel/blob/client";
import type { RadCase } from "../types";

async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string };
  return body.error ?? `Request failed (${response.status}).`;
}

export async function loadPublishedLibraryCases(): Promise<RadCase[]> {
  const response = await fetch("/api/library-cases", { cache: "no-store" });
  if (!response.ok) return [];
  return ((await response.json()) as { cases?: RadCase[] }).cases ?? [];
}

function extension(blob: Blob, dicom = false) {
  if (dicom) return "dcm";
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/webp") return "webp";
  return "png";
}

async function putMedia(path: string, blob: Blob) {
  const result = await upload(path, blob, {
    access: "public",
    handleUploadUrl: "/api/admin-case-upload",
  });
  return result.url;
}

export async function publishLibraryCase(radCase: RadCase): Promise<RadCase> {
  const revision = crypto.randomUUID();
  const root = `library/media/${radCase.id}/${revision}`;
  const images = radCase.imageBlobs ?? (radCase.imageBlob ? [radCase.imageBlob] : []);
  const dicoms = radCase.dicomBlobs ?? [];
  const imageUrls = await Promise.all(images.map((blob, index) => putMedia(`${root}/images/${String(index).padStart(5, "0")}.${extension(blob)}`, blob)));
  const dicomUrls = await Promise.all(dicoms.map((blob, index) => {
    const typed = blob.type ? blob : new Blob([blob], { type: "application/dicom" });
    return putMedia(`${root}/dicom/${String(index).padStart(5, "0")}.dcm`, typed);
  }));
  const posterUrl = radCase.posterBlob
    ? await putMedia(`${root}/poster/poster.${extension(radCase.posterBlob)}`, radCase.posterBlob)
    : undefined;
  const keepsExisting = !imageUrls.length && !dicomUrls.length && !!(
    radCase.imageUrl || radCase.imageUrls?.length || radCase.dicomUrls?.length
  );
  if (!imageUrls.length && !dicomUrls.length && !keepsExisting) throw new Error("Upload the approved image or DICOM series before publishing.");
  const published: RadCase = {
    ...radCase,
    imageUrl: keepsExisting ? radCase.imageUrl : imageUrls.length === 1 ? imageUrls[0] : undefined,
    imageUrls: keepsExisting ? radCase.imageUrls : imageUrls.length > 1 ? imageUrls : undefined,
    dicomUrls: keepsExisting ? radCase.dicomUrls : dicomUrls.length ? dicomUrls : undefined,
    posterUrl: posterUrl ?? (keepsExisting ? radCase.posterUrl : undefined),
    imageBlob: undefined, imageBlobs: undefined, dicomBlobs: undefined, posterBlob: undefined,
    cloud: undefined, seed: true,
  };
  const response = await fetch("/api/library-cases", {
    method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ case: published }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const saved = ((await response.json()) as { case?: RadCase }).case;
  if (!saved) throw new Error("The server did not confirm the published case.");
  return saved;
}
