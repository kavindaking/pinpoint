import { useCallback, useEffect, useRef, useState } from "react";
import { CaretDown, CircleNotch, SignOut, UserCircle } from "./icons";
import type { AuthController } from "../lib/auth";
import { Turnstile } from "./Turnstile";

export function AccountMenu({ auth }: { auth: AuthController }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  const [turnstileEpoch, setTurnstileEpoch] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const handleTurnstileToken = useCallback((token: string) => {
    setTurnstileToken(token);
    if (token) setTurnstileFailed(false);
  }, []);

  const handleTurnstileError = useCallback(() => {
    setTurnstileFailed(true);
    setTurnstileToken("");
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!auth.configured) return null;

  if (auth.loading) {
    return (
      <div className="flex size-9 items-center justify-center text-ink-faint" aria-label="Loading account">
        <CircleNotch size={17} className="animate-spin" />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => {
            auth.clearError();
            setOpen((value) => !value);
          }}
          className="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-ctl) border border-line px-3 py-1.5 text-sm text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <UserCircle size={17} />
          <span className="hidden sm:inline">Sign in</span>
        </button>
        {open && (
          <div
            role="dialog"
            aria-label="Sign in to Pinpoint"
            className="absolute right-0 top-11 z-20 w-[min(25rem,calc(100vw-1rem))] rounded-(--radius-panel) border border-line bg-surface p-5 shadow-(--shadow)"
          >
            <h2 className="text-base font-semibold text-ink">
              {step === "email" ? "Sign in to Pinpoint" : "Check your email"}
            </h2>
            <p className="mt-1 text-sm leading-5 text-ink-dim">
              {step === "email"
                ? "Enter your email and we’ll send secure one-time sign-in instructions."
                : `We sent sign-in instructions to ${email}.`}
            </p>

            {step === "email" ? (
              <form
                className="mt-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setSubmitting(true);
                  const sent = await auth.sendEmailCode(email, turnstileToken);
                  setSubmitting(false);
                  if (sent) {
                    setStep("code");
                  } else {
                    setTurnstileToken("");
                    setTurnstileEpoch((value) => value + 1);
                  }
                }}
              >
                <label htmlFor="account-email" className="text-xs font-medium text-ink-dim">
                  Email address
                </label>
                <input
                  id="account-email"
                  type="email"
                  autoComplete="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="mt-1.5 w-full rounded-(--radius-ctl) border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
                />
                <div className="mt-3 flex min-h-[4.75rem] items-center justify-center overflow-hidden rounded-(--radius-ctl) border border-line bg-bg p-1">
                  <Turnstile
                    key={turnstileEpoch}
                    onToken={handleTurnstileToken}
                    onError={handleTurnstileError}
                  />
                </div>
                {turnstileFailed && (
                  <p className="mt-2 text-xs text-miss">
                    Security verification could not load. Check your connection and try again.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting || !turnstileToken}
                  className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-(--radius-ctl) bg-accent px-3 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-strong disabled:cursor-wait disabled:opacity-60"
                >
                  {submitting && <CircleNotch size={16} className="animate-spin" />}
                  Send sign-in email
                </button>
              </form>
            ) : (
              <form
                className="mt-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setSubmitting(true);
                  const verified = await auth.verifyEmailCode(email, code);
                  setSubmitting(false);
                  if (verified) {
                    setOpen(false);
                    setCode("");
                    setStep("email");
                  }
                }}
              >
                <label htmlFor="account-code" className="text-xs font-medium text-ink-dim">
                  Six-digit code
                </label>
                <input
                  id="account-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  minLength={6}
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  className="mt-1.5 w-full rounded-(--radius-ctl) border border-line bg-bg px-3 py-2 text-center font-mono text-xl tracking-[0.35em] text-ink placeholder:text-ink-faint"
                />
                <button
                  type="submit"
                  disabled={submitting || code.length !== 6}
                  className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-(--radius-ctl) bg-accent px-3 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting && <CircleNotch size={16} className="animate-spin" />}
                  Verify and sign in
                </button>
                <p className="mt-3 text-xs leading-5 text-ink-faint">
                  If your email contains a secure sign-in link instead of a code, open that link to
                  finish signing in.
                </p>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      auth.clearError();
                      setCode("");
                      setStep("email");
                    }}
                    className="cursor-pointer text-ink-dim hover:text-ink"
                  >
                    Change email
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      auth.clearError();
                      setTurnstileToken("");
                      setTurnstileEpoch((value) => value + 1);
                      setStep("email");
                    }}
                    className="cursor-pointer text-accent hover:text-accent-strong disabled:cursor-wait disabled:opacity-60"
                  >
                    Send again
                  </button>
                </div>
              </form>
            )}

            {auth.error && (
              <p
                role="alert"
                className="mt-3 rounded-(--radius-ctl) border border-miss/40 bg-miss-soft px-3 py-2 text-xs text-miss"
              >
                {auth.error}
              </p>
            )}
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">
              No password required. You can continue using Pinpoint as a guest by closing this box.
            </p>
          </div>
        )}
      </div>
    );
  }

  const name =
    (auth.user.user_metadata.full_name as string | undefined) ??
    (auth.user.user_metadata.name as string | undefined) ??
    auth.user.email ??
    "Account";
  const initial = name.trim().charAt(0).toUpperCase() || "P";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-2 rounded-(--radius-ctl) px-2 py-1.5 text-sm text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
          {initial}
        </span>
        <span className="hidden max-w-36 truncate lg:block">{name}</span>
        <CaretDown size={13} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-20 w-72 rounded-(--radius-panel) border border-line bg-surface p-2 shadow-(--shadow)"
        >
          <div className="border-b border-line px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            {auth.user.email && <p className="truncate text-xs text-ink-faint">{auth.user.email}</p>}
            <p className="mt-2 text-xs text-accent">Account connected</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false);
              const signedOut = await auth.signOut();
              if (signedOut) window.location.replace("/");
            }}
            className="mt-1 flex w-full cursor-pointer items-center gap-2 rounded-(--radius-ctl) px-3 py-2 text-left text-sm text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <SignOut size={16} />
            Sign out
          </button>
          {auth.error && <p className="px-3 py-2 text-xs text-miss">{auth.error}</p>}
        </div>
      )}
    </div>
  );
}
