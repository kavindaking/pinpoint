import type { CloudCaseMedia, RadCase } from "../types";
import { supabase } from "./supabase";

interface SignedObject {
  contentType?: string;
  key: string;
  url: string;
}

interface UserCaseRow {
  case_id: string;
  case_data: Omit<RadCase, "cloud">;
  media: CloudCaseMedia;
  object_keys: string[];
  updated_at: string;
}

const MAX_OBJECTS_PER_CASE = 1000;
const UPLOAD_CONCURRENCY = 4;

async function sessionDetails() {
  if (!supabase) throw new Error("Accounts are not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to use cloud case storage.");
  return { session: data.session, user: data.session.user };
}

async function r2Request<T>(method: "POST" | "DELETE", body: unknown): Promise<T> {
  const { session } = await sessionDetails();
  const response = await fetch("/api/r2", {
    method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "Cloud storage request failed.");
  return payload;
}

function contentType(blob: Blob, kind: "image" | "dicom" | "poster"): string {
  if (kind === "dicom") return "application/dicom";
  if (blob.type === "image/jpeg" || blob.type === "image/png" || blob.type === "image/webp") {
    return blob.type;
  }
  return kind === "image" || kind === "poster" ? "image/png" : "application/octet-stream";
}

function extension(type: string, kind: "image" | "dicom" | "poster"): string {
  if (kind === "dicom") return "dcm";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return "png";
}

function metadataOnly(radCase: RadCase): Omit<RadCase, "cloud"> {
  const {
    cloud: _cloud,
    dicomBlobs: _dicomBlobs,
    dicomUrls: _dicomUrls,
    imageBlob: _imageBlob,
    imageBlobs: _imageBlobs,
    imageUrl: _imageUrl,
    imageUrls: _imageUrls,
    posterBlob: _posterBlob,
    posterUrl: _posterUrl,
    ...metadata
  } = radCase;
  delete metadata.seed;
  return metadata;
}

function relativeObjectName(key: string, userId: string, caseId: string): string {
  const prefix = `users/${userId}/cases/${caseId}/`;
  if (!key.startsWith(prefix)) throw new Error("Invalid cloud object reference.");
  return key.slice(prefix.length);
}

async function uploadInBatches(
  signed: SignedObject[],
  blobs: Blob[],
): Promise<void> {
  for (let start = 0; start < signed.length; start += UPLOAD_CONCURRENCY) {
    const end = Math.min(start + UPLOAD_CONCURRENCY, signed.length);
    await Promise.all(
      signed.slice(start, end).map(async (object, offset) => {
        const response = await fetch(object.url, {
          method: "PUT",
          headers: { "Content-Type": object.contentType ?? "application/octet-stream" },
          body: blobs[start + offset],
        });
        if (!response.ok) throw new Error(`R2 upload failed (${response.status}).`);
      }),
    );
  }
}

/** Upload a personal case's media and upsert its RLS-protected metadata. */
export async function syncCaseToCloud(radCase: RadCase): Promise<void> {
  const { user } = await sessionDetails();
  const images = radCase.imageBlobs ?? (radCase.imageBlob ? [radCase.imageBlob] : []);
  const dicoms = radCase.dicomBlobs ?? [];
  const poster = radCase.posterBlob;
  const hasNewMedia = images.length > 0 || dicoms.length > 0 || !!poster;

  let media: CloudCaseMedia = radCase.cloud?.media ?? {};
  let objectKeys = radCase.cloud?.objectKeys ?? [];
  const previousKeys = [...objectKeys];

  if (hasNewMedia) {
    const revision = crypto.randomUUID();
    const descriptors: { blob: Blob; kind: "image" | "dicom" | "poster"; name: string }[] = [];
    images.forEach((blob, index) => {
      const type = contentType(blob, "image");
      descriptors.push({
        blob,
        kind: "image",
        name: `${revision}/images/${String(index).padStart(5, "0")}.${extension(type, "image")}`,
      });
    });
    dicoms.forEach((blob, index) => {
      descriptors.push({
        blob,
        kind: "dicom",
        name: `${revision}/dicom/${String(index).padStart(5, "0")}.dcm`,
      });
    });
    if (poster) {
      const type = contentType(poster, "poster");
      descriptors.push({ blob: poster, kind: "poster", name: `${revision}/poster.${extension(type, "poster")}` });
    }
    if (descriptors.length > MAX_OBJECTS_PER_CASE) {
      throw new Error(`This case has too many files to sync (maximum ${MAX_OBJECTS_PER_CASE}).`);
    }

    const signed = await r2Request<{ objects: SignedObject[] }>("POST", {
      action: "upload",
      caseId: radCase.id,
      objects: descriptors.map(({ blob, kind, name }) => ({
        name,
        contentType: contentType(blob, kind),
        size: blob.size,
      })),
    });
    await uploadInBatches(
      signed.objects,
      descriptors.map(({ blob }) => blob),
    );

    const keysFor = (kind: "image" | "dicom") =>
      signed.objects
        .filter((_object, index) => descriptors[index].kind === kind)
        .map((object) => object.key);
    media = {
      imageKeys: keysFor("image"),
      dicomKeys: keysFor("dicom"),
      posterKey: signed.objects.find((_object, index) => descriptors[index].kind === "poster")?.key,
    };
    objectKeys = signed.objects.map((object) => object.key);
  }

  if (objectKeys.length === 0) throw new Error("This case has no media to sync.");
  const { error } = await supabase!.from("user_cases").upsert(
    {
      user_id: user.id,
      case_id: radCase.id,
      case_data: metadataOnly(radCase),
      media,
      object_keys: objectKeys,
    },
    { onConflict: "user_id,case_id" },
  );
  if (error) {
    if (hasNewMedia) {
      await r2Request("DELETE", {
        action: "delete",
        caseId: radCase.id,
        keys: objectKeys,
      }).catch(() => undefined);
    }
    throw new Error(error.message);
  }

  const obsolete = previousKeys.filter((key) => !objectKeys.includes(key));
  if (obsolete.length > 0) {
    await r2Request("DELETE", { action: "delete", caseId: radCase.id, keys: obsolete }).catch(
      () => undefined,
    );
  }
}

/** Load the signed-in user's remote cases with fresh, short-lived media URLs. */
export async function loadCloudCases(): Promise<RadCase[]> {
  const { user } = await sessionDetails();
  const { data, error } = await supabase!
    .from("user_cases")
    .select("case_id, case_data, media, object_keys, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: true });
  if (error) throw new Error(error.message);

  const cases: RadCase[] = [];
  for (const row of (data ?? []) as UserCaseRow[]) {
    const objects = row.object_keys.map((key) => ({
      name: relativeObjectName(key, user.id, row.case_id),
    }));
    const signed = await r2Request<{ objects: SignedObject[] }>("POST", {
      action: "download",
      caseId: row.case_id,
      objects,
    });
    const urls = new Map(signed.objects.map((object) => [object.key, object.url]));
    const imageUrls = row.media.imageKeys?.map((key) => urls.get(key)).filter(Boolean) as string[];
    const dicomUrls = row.media.dicomKeys?.map((key) => urls.get(key)).filter(Boolean) as string[];
    cases.push({
      ...row.case_data,
      seed: false,
      imageUrl: imageUrls?.length === 1 ? imageUrls[0] : undefined,
      imageUrls: imageUrls?.length && imageUrls.length > 1 ? imageUrls : undefined,
      dicomUrls: dicomUrls?.length ? dicomUrls : undefined,
      posterUrl: row.media.posterKey ? urls.get(row.media.posterKey) : undefined,
      cloud: {
        media: row.media,
        objectKeys: row.object_keys,
        updatedAt: row.updated_at,
      },
    });
  }
  return cases;
}

export async function deleteCloudCase(radCase: RadCase): Promise<void> {
  if (!radCase.cloud) return;
  const { user } = await sessionDetails();
  const { error } = await supabase!
    .from("user_cases")
    .delete()
    .eq("user_id", user.id)
    .eq("case_id", radCase.id);
  if (error) throw new Error(error.message);
  await r2Request("DELETE", {
    action: "delete",
    caseId: radCase.id,
    keys: radCase.cloud.objectKeys,
  });
}
