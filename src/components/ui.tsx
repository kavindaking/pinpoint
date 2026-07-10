import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type ButtonVariant = "primary" | "ghost" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-bg font-medium hover:bg-accent-strong active:translate-y-px disabled:opacity-40 disabled:pointer-events-none",
  ghost:
    "border border-line text-ink hover:border-line-strong hover:bg-surface-2 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none",
  danger:
    "border border-line text-miss hover:bg-miss-soft hover:border-miss active:translate-y-px disabled:opacity-40 disabled:pointer-events-none",
};

export function Button({
  variant = "ghost",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-(--radius-ctl) px-4 py-2 text-sm transition-colors cursor-pointer ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={`rounded-(--radius-ctl) border px-3 py-1.5 text-sm transition-colors cursor-pointer ${
        active
          ? "border-accent bg-accent-soft text-ink"
          : "border-line text-ink-dim hover:border-line-strong hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="text-ink-dim">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "rounded-(--radius-ctl) border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none transition-colors";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass + " cursor-pointer"} {...props} />;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-(--radius-panel) border border-line bg-surface ${className}`}>{children}</div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="text-ink-faint">{icon}</div>
      <p className="text-lg font-medium text-ink">{title}</p>
      <p className="max-w-sm text-sm text-ink-dim">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
