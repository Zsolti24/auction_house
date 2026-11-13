import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

/** Frosted glass panel. `min-w-0` lets it shrink inside grids instead of overflowing. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("glass min-w-0 rounded-[28px] p-6", className)}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold text-muted">{children}</p>;
}

export function Button({
  variant = "primary",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-full px-6 py-3 text-[15px] font-semibold transition active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-accent text-white shadow-[0_8px_24px_-8px_rgb(0_122_255/0.6)] hover:bg-accent-dark",
        variant === "secondary" && "glass-control text-ink hover:bg-white/80",
        variant === "danger" && "bg-danger text-white hover:brightness-95",
        className,
      )}
      {...rest}
    />
  );
}

const inputClass =
  "glass-control w-full rounded-2xl px-4 py-3 text-base text-ink outline-none transition placeholder:text-muted/70 focus:border-accent/60 focus:bg-white/85 focus:ring-4 focus:ring-accent/15";

export function Field({
  label,
  hint,
  errors,
  children,
}: {
  label: string;
  hint?: string;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink/80">{label}</span>
      {children}
      {errors && errors.length > 0 ? (
        <span role="alert" className="mt-1.5 block text-[13px] font-medium text-danger">
          {errors.join(" ")}
        </span>
      ) : (
        hint && <span className="mt-1.5 block text-[13px] text-muted">{hint}</span>
      )}
    </label>
  );
}

export function TextInput({ invalid, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(inputClass, invalid && "border-danger/60 ring-4 ring-danger/10", className)}
      {...rest}
    />
  );
}

export function TextArea({ invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx(inputClass, "min-h-28 resize-y", invalid && "border-danger/60 ring-4 ring-danger/10")}
      {...rest}
    />
  );
}

/** Text input with a € prefix. Amounts are typed as text and parsed to cents (no floats). */
export function MoneyInput({ invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <div className="relative">
      {/* z-10: the translucent input is painted after this span and would cover it. */}
      <span className="pointer-events-none absolute inset-y-0 left-4 z-10 flex items-center font-medium text-muted">€</span>
      <TextInput invalid={invalid} inputMode="decimal" autoComplete="off" className="pl-9 tabular-nums" {...rest} />
    </div>
  );
}

export function Notice({ tone, children }: { tone: "success" | "error" | "warning" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cx(
        "rounded-2xl px-4 py-3 text-sm font-medium wrap-anywhere",
        tone === "success" && "bg-success-soft text-success",
        tone === "error" && "bg-danger-soft text-danger",
        tone === "warning" && "bg-warning-soft text-warning",
        tone === "info" && "bg-accent-soft text-accent",
      )}
    >
      {children}
    </div>
  );
}
