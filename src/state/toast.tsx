"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export interface Toast {
  id: number;
  text: string;
  icon?: string;
  tone?: "default" | "error" | "love";
  action?: { label: string; run: () => void };
}

interface ToastCtx {
  toasts: Toast[];
  show(t: Omit<Toast, "id">, ms?: number): void;
  dismiss(id: number): void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, "id">, ms = 4500) => {
      const id = next.current++;
      setToasts((list) => [...list.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}
