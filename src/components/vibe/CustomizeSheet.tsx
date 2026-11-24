"use client";
import { useEffect, useState } from "react";
import { AVATARS, cleanPhone } from "@/state/config";
import { useRoom } from "@/state/RoomProvider";
import { useToast } from "@/state/toast";
import { isHexColor, seedFromFile, type SchemeVariant } from "@/theme/materialYou";
import { applySeed } from "@/theme/materialYou";
import { Button, Segmented, Sheet, TextField } from "../ui/primitives";

const PRESETS = ["#d0436e", "#6750a4", "#00897b", "#f4511e", "#3949ab", "#c0ca33", "#8d6e63", "#e91e63"];

export function CustomizeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const room = useRoom();
  const toast = useToast();
  const me = room.userId ?? "";
  const partner = room.partner?.user_id ?? "";
  // Remounted (via key) each time it opens, so fields start from the saved values.
  const c0 = room.config;
  const [name, setName] = useState(c0.roomName);
  const [mine, setMine] = useState(c0.petNames[me] ?? "");
  const [theirs, setTheirs] = useState(partner ? (c0.petNames[partner] ?? "") : "");
  const [avatar, setAvatar] = useState(c0.avatars[me] ?? room.names.meAvatar);
  const [phone, setPhone] = useState(c0.phones[me] ?? "");
  const [time, setTime] = useState(room.room?.backchodi_start_time.slice(0, 5) ?? "21:00");
  const [seed, setSeed] = useState(room.room?.theme_seed_hex ?? "#d0436e");
  const [variant, setVariant] = useState<SchemeVariant>(c0.variant);
  const [busy, setBusy] = useState(false);

  // Live preview while picking a colour or style.
  useEffect(() => {
    if (open && isHexColor(seed)) applySeed(seed, variant);
  }, [open, seed, variant]);

  function close() {
    if (room.room) applySeed(room.room.theme_seed_hex, room.config.variant);
    onClose();
  }

  async function save() {
    setBusy(true);
    const c = room.config;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const timeChanged = time !== room.room?.backchodi_start_time.slice(0, 5);
    await room.saveConfig(
      {
        roomName: name.trim() || "Our Room",
        petNames: { ...c.petNames, [me]: mine.trim(), ...(partner ? { [partner]: theirs.trim() } : {}) },
        avatars: { ...c.avatars, [me]: avatar },
        phones: { ...c.phones, [me]: cleanPhone(phone) },
        variant,
      },
      {
        theme_seed_hex: isHexColor(seed) ? seed : "#d0436e",
        ...(timeChanged ? { backchodi_start_time: time, backchodi_tz: tz } : {}),
      },
    );
    setBusy(false);
    toast.show({ icon: "✨", text: "Room updated for both of you." });
    onClose();
  }

  return (
    <Sheet open={open} onClose={close} title="Customize room">
      <div className="space-y-4">
        <TextField label="Room name" value={name} onChange={setName} maxLength={40} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label={`What I call ${room.names.partner === "Partner" ? "them" : room.names.partner}`} value={mine} onChange={setMine} maxLength={30} placeholder="Pet name" />
          <TextField label="What they call me" value={theirs} onChange={setTheirs} maxLength={30} placeholder="Pet name" />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">My avatar</p>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button key={a} onClick={() => setAvatar(a)} aria-pressed={avatar === a} className={`h-11 w-11 rounded-full text-2xl ${avatar === a ? "bg-primary-container ring-2 ring-primary" : "bg-surface-container-high"}`}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <TextField label="My phone number (for the Call room)" type="tel" inputMode="tel" value={phone} onChange={(v) => setPhone(cleanPhone(v))} placeholder="+91 98765 43210" />
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="bc-time">
            Daily 2-hour Backchodi window starts at
          </label>
          <input id="bc-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="tabular h-12 w-full rounded-2xl border border-outline bg-transparent px-4 text-lg" />
          <p className="mt-1 text-xs text-on-surface-variant">In your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Your partner sees it in theirs.</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Material You colour</p>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => setSeed(p)} aria-label={`Colour ${p}`} className={`h-10 w-10 rounded-full ${seed === p ? "ring-2 ring-on-surface ring-offset-2 ring-offset-surface" : ""}`} style={{ background: p }} />
            ))}
            <label className="relative h-10 w-10 cursor-pointer overflow-hidden rounded-full border border-outline" title="Custom colour">
              <input type="color" value={isHexColor(seed) ? seed : "#d0436e"} onChange={(e) => setSeed(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              <span className="flex h-full w-full items-center justify-center text-lg">🎨</span>
            </label>
            <label className="cursor-pointer rounded-full bg-secondary-container px-4 py-2 text-sm font-semibold text-on-secondary-container">
              From a photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setSeed(await seedFromFile(f));
                    toast.show({ icon: "🖼️", text: "Colour picked from your photo. The photo itself stays on this device." });
                  } catch {
                    toast.show({ tone: "error", icon: "⚠️", text: "Couldn't read that photo." });
                  }
                }}
              />
            </label>
          </div>
          <div className="mt-3">
            <Segmented<SchemeVariant>
              value={variant}
              onChange={setVariant}
              options={[
                { value: "tonal", label: "Tonal" },
                { value: "vibrant", label: "Vibrant" },
                { value: "expressive", label: "Expressive" },
              ]}
            />
          </div>
        </div>
        <Button size="lg" className="w-full" onClick={save} disabled={busy}>
          {busy ? "Encrypting…" : "Save for both of us"}
        </Button>
        <p className="text-center text-xs text-on-surface-variant">Names, numbers and avatars are end-to-end encrypted.</p>
      </div>
    </Sheet>
  );
}
