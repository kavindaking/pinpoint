import { useEffect, useState, type FormEvent } from "react";
import { CircleNotch, LockKey, SignOut } from "../components/icons";
import { Button, Panel, inputClass } from "../components/ui";
import type { RadCase } from "../types";
import { adminLogin, adminLogout, adminSession } from "../lib/admin";
import { Cases } from "./Cases";
import { AcquisitionQueue } from "./AcquisitionQueue";
import type { AcquisitionRecord } from "../lib/acquisition";

export function Admin({
  initialSection = "library",
  cases,
  onEdit,
  onStudy,
  onChanged,
  onBuildCase,
  onPrepareCase,
  onPublishCase,
}: {
  initialSection?: "library" | "acquisition";
  cases: RadCase[];
  onEdit: (radCase: RadCase) => void;
  onStudy: (radCase: RadCase) => void;
  onChanged: () => void;
  onBuildCase: (record: AcquisitionRecord) => void;
  onPrepareCase: (record: AcquisitionRecord) => Promise<AcquisitionRecord>;
  onPublishCase: (record: AcquisitionRecord) => Promise<AcquisitionRecord>;
}) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<"library" | "acquisition">(initialSection);

  useEffect(() => {
    adminSession()
      .then(setAuthenticated)
      .finally(() => setChecking(false));
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminLogin(password);
      setPassword("");
      setAuthenticated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center text-ink-faint">
        <CircleNotch size={22} className="animate-spin" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="mx-auto flex min-h-[65vh] w-full max-w-md items-center px-4 py-10">
        <Panel className="w-full p-6">
          <div className="mb-5 flex size-11 items-center justify-center rounded-(--radius-panel) bg-accent-soft text-accent">
            <LockKey size={22} weight="fill" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Admin sign in</h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-dim">
            Sign in to adjust library markings and publish corrections to every user.
          </p>
          <form onSubmit={login} className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-2 text-sm text-ink-dim">
              Admin password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoFocus
                required
                className={inputClass}
              />
            </label>
            {error && <p className="text-sm text-miss">{error}</p>}
            <Button type="submit" variant="primary" disabled={busy || !password} className="mt-2">
              {busy && <CircleNotch size={15} className="animate-spin" />}
              Sign in
            </Button>
          </form>
        </Panel>
      </div>
    );
  }

  if (section === "acquisition") {
    return (
      <AcquisitionQueue
        onBuildCase={onBuildCase}
        onPrepareCase={onPrepareCase}
        onPublishCase={onPublishCase}
        onLibrary={() => setSection("library")}
        onSignOut={async () => {
          await adminLogout();
          setAuthenticated(false);
        }}
      />
    );
  }

  return (
    <Cases
      scope="library"
      cases={cases}
      canEditLibrary
      heading="Admin library"
      description="Adjust ground-truth regions and teaching details. Saved changes are published globally."
      headerActions={
        <>
          <Button variant="primary" onClick={() => setSection("acquisition")}>
            Image acquisition
          </Button>
          <Button
            onClick={async () => {
              await adminLogout();
              setAuthenticated(false);
            }}
          >
            <SignOut size={15} />
            Sign out
          </Button>
        </>
      }
      onNew={() => {}}
      onEdit={onEdit}
      onDelete={() => {}}
      onStudy={onStudy}
      onChanged={onChanged}
    />
  );
}
