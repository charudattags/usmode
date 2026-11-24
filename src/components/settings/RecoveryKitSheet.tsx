"use client";
import { useState } from "react";
import { createRecoveryKit, MIN_PASSPHRASE_LENGTH } from "@/crypto/e2ee";
import { loadRoomKeyRaw } from "@/crypto/keystore";
import { friendlyError } from "@/data/backend";
import { useRoom } from "@/state/RoomProvider";
import { useToast } from "@/state/toast";
import { Button, Sheet, TextField } from "../ui/primitives";

/** Export the room key encrypted under a passphrase (PBKDF2-SHA256, 600k rounds). */
export function RecoveryKitSheet({ open, onClose, onboarding }: { open: boolean; onClose: () => void; onboarding?: boolean }) {
  const room = useRoom();
  const toast = useToast();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = p1.length >= MIN_PASSPHRASE_LENGTH && p1 === p2;

  async function exportKit() {
    if (!room.userId || !room.roomId) return;
    setBusy(true);
    try {
      const raw = await loadRoomKeyRaw(room.userId, room.roomId);
      if (!raw) throw new Error("No room key on this device.");
      const kit = await createRecoveryKit(raw, room.roomId, p1);
      const url = URL.createObjectURL(new Blob([JSON.stringify(kit, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "usmode-recovery-kit.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.show({ icon: "🗝️", text: "Recovery kit saved. Keep it and the passphrase somewhere safe, apart." });
      setP1("");
      setP2("");
      onClose();
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
    setBusy(false);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Save a recovery kit">
      <div className="space-y-4">
        <p className="text-sm text-on-surface-variant">
          {onboarding ? "You’re paired! " : ""}Your room key lives only on your devices. If you lose this phone, a recovery kit is the only way back in. It&apos;s
          encrypted with a passphrase you choose; we can&apos;t reset it.
        </p>
        <TextField label={`Passphrase (${MIN_PASSPHRASE_LENGTH}+ characters)`} type="password" value={p1} onChange={setP1} />
        <TextField label="Repeat passphrase" type="password" value={p2} onChange={setP2} onEnter={() => ok && exportKit()} />
        {p2 && p1 !== p2 && <p className="text-sm text-error">Passphrases don&apos;t match.</p>}
        <div className="flex gap-2">
          <Button className="flex-1" icon="download" disabled={!ok || busy} onClick={exportKit}>
            {busy ? "Encrypting (600k rounds)…" : "Download kit"}
          </Button>
          <Button variant="text" onClick={onClose}>
            {onboarding ? "Later" : "Close"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
