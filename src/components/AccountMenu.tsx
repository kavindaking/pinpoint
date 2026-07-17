import { useEffect, useRef, useState } from "react";
import { CaretDown, CircleNotch, GoogleLogo, SignOut } from "./icons";
import type { AuthController } from "../lib/auth";

export function AccountMenu({ auth }: { auth: AuthController }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
      <div className="relative">
        <button
          type="button"
          onClick={() => void auth.signInWithGoogle()}
          className="inline-flex cursor-pointer items-center gap-2 rounded-(--radius-ctl) border border-line px-3 py-1.5 text-sm text-ink-dim transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
        >
          <GoogleLogo size={17} />
          <span className="hidden sm:inline">Sign in</span>
        </button>
        {auth.error && (
          <p className="absolute right-0 top-11 z-20 w-64 rounded-(--radius-ctl) border border-miss bg-surface p-3 text-xs text-miss shadow-(--shadow)">
            {auth.error}
          </p>
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
            onClick={() => void auth.signOut()}
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
