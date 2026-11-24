import type { KissStyle } from "@/data/types";

export const KISS_STYLES: Record<KissStyle, { label: string; emoji: string; blurb: string }> = {
  forehead: { label: "Forehead kiss", emoji: "😚", blurb: "Soft and sweet" },
  smooch: { label: "Dramatic smooch", emoji: "💋", blurb: "Full movie scene" },
  flying: { label: "Flying kiss", emoji: "😘", blurb: "Across the miles" },
  attack10: { label: "Attack of 10 kisses", emoji: "💥", blurb: "Counts as 10" },
};

/** Up to 3 words for the optional note. */
export function clampNote(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(" ").slice(0, 40);
}
