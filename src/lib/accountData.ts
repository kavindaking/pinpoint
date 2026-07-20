import type {
  CaseOutcome,
  ClickResult,
  RoundFilters,
  RoundRecord,
  ScoringSettings,
} from "../types";
import { DEFAULT_SCORING } from "../types";
import { supabase } from "./supabase";

interface RoundRow {
  client_id: string;
  finished_at: string;
  case_count: number;
  total_score: number;
  max_score: number;
  hits: number;
  nears: number;
  misses: number;
  by_modality: RoundRecord["byModality"];
}

interface ProgressRow {
  case_id: string;
  attempt_count: number;
  best_score: number;
}

async function currentUserId(): Promise<string> {
  if (!supabase) throw new Error("Accounts are not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to save account data.");
  return data.session.user.id;
}

/** Load only the signed-in user's private score history. */
export async function loadAccountHistory(): Promise<RoundRecord[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase!
    .from("rounds")
    .select(
      "client_id, finished_at, case_count, total_score, max_score, hits, nears, misses, by_modality",
    )
    .eq("user_id", userId)
    .order("finished_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as RoundRow[]).map((row) => ({
    id: row.client_id,
    finishedAt: new Date(row.finished_at).getTime(),
    caseCount: row.case_count,
    totalScore: row.total_score,
    maxScore: row.max_score,
    hits: row.hits,
    nears: row.nears,
    misses: row.misses,
    byModality: row.by_modality ?? {},
  }));
}

function overallResult(outcome: CaseOutcome): ClickResult {
  if (outcome.timedOut || outcome.outcomes.some((item) => item.result === "miss")) return "miss";
  if (outcome.outcomes.some((item) => item.result === "near")) return "near";
  return "hit";
}

/** Persist a completed round and per-case progress behind Supabase RLS. */
export async function saveAccountRound(
  record: RoundRecord,
  outcomes: CaseOutcome[],
  filters: RoundFilters,
): Promise<void> {
  const userId = await currentUserId();
  const { data: existing, error: existingError } = await supabase!
    .from("rounds")
    .select("id")
    .eq("user_id", userId)
    .eq("client_id", record.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return;

  const { data: round, error: roundError } = await supabase!
    .from("rounds")
    .insert({
      user_id: userId,
      client_id: record.id,
      finished_at: new Date(record.finishedAt).toISOString(),
      case_count: record.caseCount,
      total_score: record.totalScore,
      max_score: record.maxScore,
      hits: record.hits,
      nears: record.nears,
      misses: record.misses,
      by_modality: record.byModality,
      filters,
    })
    .select("id")
    .single();
  if (roundError) throw new Error(roundError.message);

  if (outcomes.length > 0) {
    const { error: attemptsError } = await supabase!.from("case_attempts").insert(
      outcomes.map((outcome) => ({
        user_id: userId,
        round_id: round.id,
        case_id: outcome.caseId,
        title: outcome.title,
        modality: outcome.modality,
        body_region: outcome.bodyRegion,
        base_score: outcome.baseScore,
        time_bonus: outcome.timeBonus,
        outcomes: outcome.outcomes,
        answered_at: new Date(record.finishedAt).toISOString(),
      })),
    );
    if (attemptsError) {
      await supabase!.from("rounds").delete().eq("id", round.id);
      throw new Error(attemptsError.message);
    }

    const caseIds = [...new Set(outcomes.map((outcome) => outcome.caseId))];
    const { data: previous, error: progressError } = await supabase!
      .from("user_case_progress")
      .select("case_id, attempt_count, best_score")
      .eq("user_id", userId)
      .in("case_id", caseIds);
    if (progressError) throw new Error(progressError.message);
    const byCase = new Map(
      ((previous ?? []) as ProgressRow[]).map((row) => [row.case_id, row]),
    );
    const { error: upsertError } = await supabase!.from("user_case_progress").upsert(
      outcomes.map((outcome) => {
        const old = byCase.get(outcome.caseId);
        const score = outcome.baseScore + outcome.timeBonus;
        return {
          user_id: userId,
          case_id: outcome.caseId,
          attempt_count: (old?.attempt_count ?? 0) + 1,
          best_score: Math.max(old?.best_score ?? 0, score),
          last_score: score,
          last_result: overallResult(outcome),
          last_attempted_at: new Date(record.finishedAt).toISOString(),
        };
      }),
      { onConflict: "user_id,case_id" },
    );
    if (upsertError) throw new Error(upsertError.message);
  }
}

export async function clearAccountHistory(): Promise<void> {
  const userId = await currentUserId();
  const { error: roundsError } = await supabase!.from("rounds").delete().eq("user_id", userId);
  if (roundsError) throw new Error(roundsError.message);
  const { error: progressError } = await supabase!
    .from("user_case_progress")
    .delete()
    .eq("user_id", userId);
  if (progressError) throw new Error(progressError.message);
}

export async function loadAccountSettings(): Promise<ScoringSettings> {
  const userId = await currentUserId();
  const { data, error } = await supabase!
    .from("user_settings")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { ...DEFAULT_SCORING, ...((data?.settings as Partial<ScoringSettings> | null) ?? {}) };
}

export async function saveAccountSettings(settings: ScoringSettings): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase!.from("user_settings").upsert(
    { user_id: userId, settings },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}
