import { useMemo, useState } from "react";
import { Play as PlayIcon, SlidersHorizontal } from "../components/icons";
import type { Difficulty, Modality, Subspecialty, RadCase, RoundFilters, ScoringSettings } from "../types";
import { DIFFICULTIES, SUBSPECIALTIES } from "../types";
import { Button, Chip, Field, Panel, Select, inputClass } from "../components/ui";

export function Home({
  cases,
  settings,
  onSettings,
  onStart,
}: {
  cases: RadCase[];
  settings: ScoringSettings;
  onSettings: (s: ScoringSettings) => void;
  onStart: (filters: RoundFilters) => void;
}) {
  const modalities = useMemo(() => [...new Set(cases.map((c) => c.modality))], [cases]);
  const subspecialties = useMemo(
    () => SUBSPECIALTIES.filter((s) => cases.some((c) => c.subspecialty === s)),
    [cases],
  );

  const [pickedModalities, setPickedModalities] = useState<Modality[]>([]);
  const [pickedSubs, setPickedSubs] = useState<Subspecialty[]>([]);
  const [pickedDifficulties, setPickedDifficulties] = useState<Difficulty[]>([]);
  const [shuffle, setShuffle] = useState(true);
  const [showScoring, setShowScoring] = useState(false);

  const matching = useMemo(
    () =>
      cases.filter(
        (c) =>
          (pickedModalities.length === 0 || pickedModalities.includes(c.modality)) &&
          (pickedSubs.length === 0 || pickedSubs.includes(c.subspecialty)) &&
          (pickedDifficulties.length === 0 || pickedDifficulties.includes(c.difficulty)),
      ),
    [cases, pickedModalities, pickedSubs, pickedDifficulties],
  );

  const toggle = <T,>(list: T[], set: (v: T[]) => void, item: T) =>
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
      {/* Left: pitch + start */}
      <div className="flex flex-col justify-center">
        <h1 className="text-4xl font-semibold tracking-tighter md:text-5xl">
          Spot the abnormality.
        </h1>
        <p className="mt-3 max-w-[42ch] text-base leading-relaxed text-ink-dim">
          One image per case. Click where the pathology is, get scored on precision, learn from
          the reveal.
        </p>
        <div className="mt-6 flex items-center gap-4">
          <Button
            variant="primary"
            className="!px-6 !py-3 !text-base"
            disabled={matching.length === 0}
            onClick={() => onStart({ modalities: pickedModalities, subspecialties: pickedSubs, difficulties: pickedDifficulties, shuffle })}
          >
            <PlayIcon size={18} weight="fill" />
            Start round
          </Button>
          <span className="font-mono text-sm tabular-nums text-ink-faint">
            {matching.length} {matching.length === 1 ? "case" : "cases"}
          </span>
        </div>
        {settings.timerSeconds > 0 && (
          <p className="mt-3 text-xs text-ink-faint">
            Timer on: {settings.timerSeconds}s per case, up to +{settings.timerBonusMax} speed bonus.
          </p>
        )}
      </div>

      {/* Right: round configuration */}
      <Panel className="p-5">
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-2 text-sm text-ink-dim">Modality</p>
            <div className="flex flex-wrap gap-2">
              {modalities.map((m) => (
                <Chip key={m} active={pickedModalities.includes(m)} onClick={() => toggle(pickedModalities, setPickedModalities, m)}>
                  {m}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-ink-dim">Subspecialty</p>
            <div className="flex flex-wrap gap-2">
              {subspecialties.map((s) => (
                <Chip key={s} active={pickedSubs.includes(s)} onClick={() => toggle(pickedSubs, setPickedSubs, s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm text-ink-dim">Difficulty</p>
            <div className="flex flex-wrap gap-2">
              {DIFFICULTIES.map((d) => (
                <Chip key={d} active={pickedDifficulties.includes(d)} onClick={() => toggle(pickedDifficulties, setPickedDifficulties, d)}>
                  {d}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-dim">
              <input
                type="checkbox"
                checked={shuffle}
                onChange={(e) => setShuffle(e.target.checked)}
                className="size-4 accent-(--accent)"
              />
              Shuffle order
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-dim">
              <input
                type="checkbox"
                checked={settings.timerSeconds > 0}
                onChange={(e) => onSettings({ ...settings, timerSeconds: e.target.checked ? 30 : 0 })}
                className="size-4 accent-(--accent)"
              />
              Timer
            </label>
            {settings.timerSeconds > 0 && (
              <Select
                value={settings.timerSeconds}
                onChange={(e) => onSettings({ ...settings, timerSeconds: Number(e.target.value) })}
                aria-label="Seconds per case"
              >
                {[15, 30, 45, 60].map((s) => (
                  <option key={s} value={s}>
                    {s}s per case
                  </option>
                ))}
              </Select>
            )}
            <button
              type="button"
              onClick={() => setShowScoring((v) => !v)}
              className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink"
            >
              <SlidersHorizontal size={15} />
              Scoring
            </button>
          </div>

          {showScoring && (
            <div className="rise-in grid grid-cols-2 gap-4 border-t border-line pt-4">
              <Field label="Points for a hit">
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={settings.hitPoints}
                  onChange={(e) => onSettings({ ...settings, hitPoints: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Max points when close">
                <input
                  type="number"
                  min={0}
                  max={settings.hitPoints}
                  value={settings.nearMaxPoints}
                  onChange={(e) => onSettings({ ...settings, nearMaxPoints: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Close-miss range" hint="Fraction of image diagonal">
                <input
                  type="number"
                  step={0.01}
                  min={0.02}
                  max={0.5}
                  value={settings.nearThreshold}
                  onChange={(e) => onSettings({ ...settings, nearThreshold: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Point-target radius" hint="For point ground truths">
                <input
                  type="number"
                  step={0.005}
                  min={0.01}
                  max={0.2}
                  value={settings.pointTolerance}
                  onChange={(e) => onSettings({ ...settings, pointTolerance: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
