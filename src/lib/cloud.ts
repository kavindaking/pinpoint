import { upload } from "@vercel/blob/client";
import type { RadCase } from "../types";
import { exportCases, importCases, parseImportedCases } from "./storage";

/**
 * Cloud sharing for case sets. A set (cases plus their embedded images) is
 * uploaded straight from the browser to Vercel Blob and lives on the edge
 * CDN, so anyone with the short code can pull it back fast from anywhere.
 */

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars

export function shortId(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export interface Shared {
  id: string;
  url: string;
}

/** Publish a set of cases and return its share code plus a public link. */
export async function publishCases(cases: RadCase[]): Promise<Shared> {
  if (cases.length === 0) throw new Error("There are no cases to share.");
  const json = await exportCases(cases);
  const id = shortId();
  const blob = new Blob([json], { type: "application/json" });
  const result = await upload(`sets/${id}.json`, blob, {
    access: "public",
    handleUploadUrl: "/api/blob-upload",
    contentType: "application/json",
  });
  return { id, url: result.url };
}

/** Pull a URL like ".../?share=CODE" or a raw code down to just the code. */
export function codeFromInput(input: string): string {
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    const q = u.searchParams.get("share") ?? u.searchParams.get("import");
    if (q) return q.replace(/[^a-zA-Z0-9_-]/g, "");
  } catch {
    /* not a URL */
  }
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Import a shared set by code or link. Returns how many cases were added. */
export async function importFromCloud(input: string): Promise<number> {
  const text = await downloadSharedSet(input);
  return importCases(text);
}

export async function parseCasesFromCloud(input: string): Promise<RadCase[]> {
  return parseImportedCases(await downloadSharedSet(input));
}

async function downloadSharedSet(input: string): Promise<string> {
  const code = codeFromInput(input);
  if (!code) throw new Error("Enter a share code or link.");
  const res = await fetch(`/api/share?id=${encodeURIComponent(code)}`);
  if (res.status === 404) throw new Error("No shared set found for that code.");
  if (!res.ok) throw new Error("Could not reach the cloud. Try again shortly.");
  return res.text();
}

/** A friendly share link that deep-links straight into an import. */
export function shareLink(id: string): string {
  return `${location.origin}/?share=${id}`;
}
