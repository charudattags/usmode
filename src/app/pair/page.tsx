"use client";
/**
 * Invite links land here: /pair#join=CODE&s=SECRET. The fragment never reaches
 * the server. We stash it in this tab, wipe it from the address bar, and hand
 * over to the normal flow (sign in if needed, then auto-join).
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { parsePairingFragment } from "@/crypto/e2ee";
import { savePendingJoin, Splash } from "@/components/onboarding/Onboarding";
import { useRoom } from "@/state/RoomProvider";

export default function PairPage() {
  const router = useRouter();
  const room = useRoom();
  useEffect(() => {
    const link = parsePairingFragment(window.location.hash);
    if (link) savePendingJoin(link.code, link.qrSecret);
    window.history.replaceState(null, "", "/pair");
    room.reboot();
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Splash />;
}
