/**
 * Material You (M3) dynamic colour. A seed colour (picked, or extracted from a
 * photo or album cover) becomes the full set of M3 tonal roles, written as
 * --md-sys-color-* custom properties for light and dark.
 */
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  MaterialDynamicColors,
  SchemeTonalSpot,
  SchemeVibrant,
  SchemeExpressive,
  sourceColorFromImage,
  type DynamicScheme,
} from "@material/material-color-utilities";

export const DEFAULT_SEED = "#d0436e";

export type SchemeVariant = "tonal" | "vibrant" | "expressive";

/** Role name (kebab) → MaterialDynamicColors key. */
const ROLES = {
  primary: "primary",
  "on-primary": "onPrimary",
  "primary-container": "primaryContainer",
  "on-primary-container": "onPrimaryContainer",
  secondary: "secondary",
  "on-secondary": "onSecondary",
  "secondary-container": "secondaryContainer",
  "on-secondary-container": "onSecondaryContainer",
  tertiary: "tertiary",
  "on-tertiary": "onTertiary",
  "tertiary-container": "tertiaryContainer",
  "on-tertiary-container": "onTertiaryContainer",
  error: "error",
  "on-error": "onError",
  "error-container": "errorContainer",
  "on-error-container": "onErrorContainer",
  background: "background",
  "on-background": "onBackground",
  surface: "surface",
  "on-surface": "onSurface",
  "surface-variant": "surfaceVariant",
  "on-surface-variant": "onSurfaceVariant",
  "surface-dim": "surfaceDim",
  "surface-bright": "surfaceBright",
  "surface-container-lowest": "surfaceContainerLowest",
  "surface-container-low": "surfaceContainerLow",
  "surface-container": "surfaceContainer",
  "surface-container-high": "surfaceContainerHigh",
  "surface-container-highest": "surfaceContainerHighest",
  outline: "outline",
  "outline-variant": "outlineVariant",
  "inverse-surface": "inverseSurface",
  "inverse-on-surface": "inverseOnSurface",
  "inverse-primary": "inversePrimary",
  scrim: "scrim",
  shadow: "shadow",
} as const satisfies Record<string, keyof typeof MaterialDynamicColors>;

export type RoleName = keyof typeof ROLES;
export type Palette = Record<RoleName, string>;

export function isHexColor(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

function makeScheme(seedHex: string, dark: boolean, variant: SchemeVariant): DynamicScheme {
  const hct = Hct.fromInt(argbFromHex(isHexColor(seedHex) ? seedHex : DEFAULT_SEED));
  switch (variant) {
    case "vibrant":
      return new SchemeVibrant(hct, dark, 0);
    case "expressive":
      return new SchemeExpressive(hct, dark, 0);
    default:
      return new SchemeTonalSpot(hct, dark, 0);
  }
}

export function paletteFromSeed(seedHex: string, dark: boolean, variant: SchemeVariant = "tonal"): Palette {
  const scheme = makeScheme(seedHex, dark, variant);
  const out = {} as Palette;
  for (const [role, key] of Object.entries(ROLES) as [RoleName, keyof typeof MaterialDynamicColors][]) {
    const dc = MaterialDynamicColors[key] as { getArgb(s: DynamicScheme): number };
    out[role] = hexFromArgb(dc.getArgb(scheme));
  }
  return out;
}

export function paletteToCss(p: Palette): string {
  return Object.entries(p)
    .map(([role, hex]) => `--md-sys-color-${role}:${hex};`)
    .join("");
}

/** Full stylesheet: light, dark (system), and forced themes via data-theme. */
export function themeStylesheet(seedHex: string, variant: SchemeVariant = "tonal"): string {
  const light = paletteToCss(paletteFromSeed(seedHex, false, variant));
  const dark = paletteToCss(paletteFromSeed(seedHex, true, variant));
  return [
    `:root{${light}color-scheme:light;}`,
    `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}color-scheme:dark;}}`,
    `:root[data-theme="dark"]{${dark}color-scheme:dark;}`,
    `:root[data-theme="light"]{${light}color-scheme:light;}`,
  ].join("\n");
}

const STYLE_ID = "md-dynamic-theme";

/** Writes (or rewrites) the theme <style> tag. Instant, no reload. */
export function applySeed(seedHex: string, variant: SchemeVariant = "tonal"): void {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = themeStylesheet(seedHex, variant);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", paletteFromSeed(seedHex, matchMedia("(prefers-color-scheme: dark)").matches).surface);
}

/** Seed from an image (photo of the two of you, album art). Image must be CORS-clean. */
export async function seedFromImage(img: HTMLImageElement): Promise<string> {
  return hexFromArgb(await sourceColorFromImage(img));
}

export async function seedFromImageUrl(url: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return seedFromImage(img);
}

/** For a local File: draws to a small canvas first (fast, and no EXIF leaves the device). */
export async function seedFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return await seedFromImageUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Mood presets for the ambient mesh backgrounds (rotations of the seed hue). */
export type Mood = "vibe" | "arena" | "cozy" | "confession" | "backchodi" | "jam";

export function moodColors(seedHex: string, mood: Mood, dark: boolean): [string, string, string] {
  const base = Hct.fromInt(argbFromHex(isHexColor(seedHex) ? seedHex : DEFAULT_SEED));
  const mk = (hueShift: number, chroma: number, tone: number) =>
    hexFromArgb(Hct.from((base.hue + hueShift + 360) % 360, chroma, tone).toInt());
  const t = (light: number, darkTone: number) => (dark ? darkTone : light);
  switch (mood) {
    case "arena":
      return [mk(0, 90, t(70, 45)), mk(40, 90, t(78, 40)), mk(-60, 80, t(72, 35))];
    case "cozy":
      return [mk(200, 30, t(85, 22)), mk(240, 36, t(80, 18)), mk(280, 30, t(88, 26))];
    case "confession":
      return [mk(-30, 50, t(40, 14)), mk(-10, 60, t(30, 10)), mk(20, 40, t(35, 16))];
    case "backchodi":
      return [mk(60, 80, t(80, 38)), mk(120, 70, t(82, 34)), mk(-40, 80, t(76, 36))];
    case "jam":
      return [mk(0, 60, t(75, 30)), mk(30, 60, t(70, 26)), mk(-30, 60, t(72, 28))];
    default:
      return [mk(0, 40, t(88, 22)), mk(60, 36, t(90, 20)), mk(-60, 36, t(86, 24))];
  }
}
