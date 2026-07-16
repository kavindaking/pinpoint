import type { RadCase } from "../types";

type GlobalCaseOverride = Pick<
  RadCase,
  | "id"
  | "title"
  | "stem"
  | "explanation"
  | "modality"
  | "bodyRegion"
  | "subspecialty"
  | "difficulty"
  | "credit"
  | "regions"
> & { updatedAt?: string };

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.error || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export async function mergeGlobalCaseOverrides(cases: RadCase[]): Promise<RadCase[]> {
  try {
    const response = await fetch("/api/admin-overrides", { cache: "no-store" });
    if (!response.ok) return cases;
    const body = (await response.json()) as { overrides?: Record<string, GlobalCaseOverride> };
    const overrides = body.overrides ?? {};
    return cases.map((radCase) => {
      const override = radCase.seed ? overrides[radCase.id] : undefined;
      if (!override) return radCase;
      return {
        ...radCase,
        ...override,
        id: radCase.id,
        seed: true,
        createdAt: radCase.createdAt,
      };
    });
  } catch {
    return cases;
  }
}

export async function adminSession(): Promise<boolean> {
  const response = await fetch("/api/admin-auth", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return false;
  return Boolean((await response.json()).authenticated);
}

export async function adminLogin(password: string): Promise<void> {
  const response = await fetch("/api/admin-auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function adminLogout(): Promise<void> {
  await fetch("/api/admin-auth", { method: "DELETE", credentials: "same-origin" });
}

export async function saveGlobalCaseOverride(radCase: RadCase): Promise<void> {
  const response = await fetch("/api/admin-overrides", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ case: radCase }),
  });
  if (!response.ok) throw new Error(await errorMessage(response));
}
