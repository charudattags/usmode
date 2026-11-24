"use client";
import { AnimatePresence, motion, type HTMLMotionProps, useDragControls } from "framer-motion";
import { forwardRef, useEffect, useId, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export const springs = {
  nav: { type: "spring", stiffness: 420, damping: 24 } as const,
  soft: { type: "spring", stiffness: 260, damping: 26 } as const,
  bouncy: { type: "spring", stiffness: 520, damping: 18 } as const,
};

type Variant = "filled" | "tonal" | "outlined" | "text" | "elevated" | "danger";

const VARIANTS: Record<Variant, string> = {
  filled: "bg-primary text-on-primary",
  tonal: "bg-secondary-container text-on-secondary-container",
  outlined: "border border-outline text-primary",
  text: "text-primary",
  elevated: "elev-2 text-primary",
  danger: "bg-error text-on-error",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  icon?: IconName;
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "filled", icon, size = "md", className = "", children, disabled, ...rest },
  ref,
) {
  const sz = size === "lg" ? "h-14 px-7 text-base" : size === "sm" ? "h-9 px-4 text-sm" : "h-11 px-5 text-sm";
  return (
    <motion.button
      ref={ref}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      transition={springs.bouncy}
      disabled={disabled}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold tracking-wide transition-opacity disabled:opacity-40 ${sz} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 18 : 20} />}
      {children}
    </motion.button>
  );
});

export function IconButton({ icon, label, onClick, variant = "text", className = "", size = 40, disabled }: { icon: IconName; label: string; onClick?: () => void; variant?: Variant; className?: string; size?: number; disabled?: boolean }) {
  return (
    <motion.button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.85 }}
      transition={springs.bouncy}
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center rounded-full disabled:opacity-40 ${VARIANTS[variant]} ${variant === "text" ? "text-on-surface-variant hover:bg-on-surface/8" : ""} ${className}`}
    >
      <Icon name={icon} size={Math.round(size * 0.55)} />
    </motion.button>
  );
}

export function Card({ className = "", children, ...rest }: HTMLMotionProps<"div"> & { children?: ReactNode }) {
  return (
    <motion.div className={`rounded-[28px] bg-surface-container-low p-5 ${className}`} {...rest}>
      {children}
    </motion.div>
  );
}

export function Chip({ selected, onClick, children, icon }: { selected?: boolean; onClick?: () => void; children: ReactNode; icon?: ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.92 }}
      transition={springs.bouncy}
      aria-pressed={selected}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${
        selected ? "border-transparent bg-secondary-container text-on-secondary-container" : "border-outline-variant text-on-surface-variant"
      }`}
    >
      {selected && <Icon name="check" size={16} />}
      {icon}
      {children}
    </motion.button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  maxLength,
  multiline,
  autoFocus,
  inputMode,
  className = "",
  mono,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
  autoFocus?: boolean;
  inputMode?: "text" | "email" | "numeric" | "tel";
  className?: string;
  mono?: boolean;
  onEnter?: () => void;
}) {
  const id = useId();
  const cls = `peer w-full rounded-2xl border border-outline bg-transparent px-4 pb-2.5 pt-6 text-base text-on-surface outline-none transition-colors placeholder:text-transparent focus:border-2 focus:border-primary ${mono ? "tabular tracking-widest" : ""}`;
  return (
    <div className={`relative ${className}`}>
      {multiline ? (
        <textarea id={id} value={value} placeholder={placeholder ?? label} maxLength={maxLength} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} rows={3} className={`${cls} resize-none`} />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          inputMode={inputMode}
          placeholder={placeholder ?? label}
          maxLength={maxLength}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          className={cls}
        />
      )}
      <label htmlFor={id} className="pointer-events-none absolute left-4 top-2 text-xs font-medium text-on-surface-variant peer-focus:text-primary">
        {label}
      </label>
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 py-2 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block font-medium">{label}</span>
        {description && <span className="block text-sm text-on-surface-variant">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-[52px] shrink-0 rounded-full border-2 transition-colors ${checked ? "border-primary bg-primary" : "border-outline bg-surface-container-highest"}`}
      >
        <motion.span
          layout
          transition={springs.nav}
          className={`absolute top-1/2 -translate-y-1/2 rounded-full ${checked ? "right-1 h-6 w-6 bg-on-primary" : "left-1.5 h-4 w-4 bg-outline"}`}
        />
      </button>
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string; icon?: IconName }[]; value: T; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <div className="flex rounded-full border border-outline p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={o.value === value} className="relative flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold">
          {o.value === value && <motion.span layoutId={`seg-${id}`} transition={springs.nav} className="absolute inset-0 rounded-full bg-secondary-container" />}
          <span className={`relative flex items-center gap-1.5 ${o.value === value ? "text-on-secondary-container" : "text-on-surface-variant"}`}>
            {o.icon && <Icon name={o.icon} size={18} />}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/** M3 modal bottom sheet with drag-to-dismiss. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
          <motion.div className="absolute inset-0 bg-scrim/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-surface-container-low px-5 pb-8 pt-2"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.soft}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 600) && onClose()}
          >
            <div className="flex cursor-grab touch-none justify-center py-3" onPointerDown={(e) => drag.start(e)}>
              <span className="h-1 w-8 rounded-full bg-outline" />
            </div>
            {title && <h2 className="display mb-4 text-2xl font-bold">{title}</h2>}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Material "shapes": clover, starburst, scallop, squircle. Used for badges and counters. */
export function Shape({ kind, className = "", children, spin }: { kind: "clover" | "burst" | "scallop" | "squircle"; className?: string; children?: ReactNode; spin?: boolean }) {
  const d = SHAPES[kind];
  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <motion.svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full"
        animate={spin ? { rotate: 360 } : undefined}
        transition={spin ? { repeat: Infinity, duration: 18, ease: "linear" } : undefined}
        aria-hidden
      >
        <path d={d} fill="currentColor" />
      </motion.svg>
      <span className="relative">{children}</span>
    </div>
  );
}

function polar(n: number, rOuter: number, rInner: number, smooth = false): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  if (!smooth) return `M${pts.join("L")}Z`;
  // Quadratic smoothing through midpoints for scalloped edges.
  const p = pts.map((s) => s.split(" ").map(Number));
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out += i === 0 ? `M${mid[0]} ${mid[1]}` : "";
    const c = p[(i + 1) % p.length];
    const n2 = p[(i + 2) % p.length];
    const mid2 = [(c[0] + n2[0]) / 2, (c[1] + n2[1]) / 2];
    out += `Q${c[0]} ${c[1]} ${mid2[0]} ${mid2[1]}`;
  }
  return `${out}Z`;
}

const SHAPES = {
  clover: polar(4, 50, 30, true),
  burst: polar(12, 50, 40),
  scallop: polar(10, 50, 43, true),
  squircle: "M50 2C88 2 98 12 98 50S88 98 50 98 2 88 2 50 12 2 50 2Z",
};

export function Avatar({ emoji, size = 40, ring }: { emoji: string; size?: number; ring?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-tertiary-container ${ring ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.55 }}
      aria-hidden
    >
      {emoji}
    </span>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between px-1">
      <h2 className="display text-lg font-bold text-on-surface">{children}</h2>
      {action}
    </div>
  );
}
