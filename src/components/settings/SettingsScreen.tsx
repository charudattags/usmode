"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { keyFingerprint, safetyNumber } from "@/crypto/e2ee";
import { forgetUser, loadAppLockCredential, saveAppLockCredential } from "@/crypto/keystore";
import { friendlyError } from "@/data/backend";
import { resetDemoServer } from "@/data/demo/backend";
import {
  appLockSupported,
  askNotificationPermission,
  notificationsAllowed,
  prefs,
  pushConfigured,
  registerAppLock,
  savePrefs,
  subscribePush,
  type Prefs,
} from "@/lib/device";
import { useRoom } from "@/state/RoomProvider";
import { useToast } from "@/state/toast";
import { AmbientBackground } from "../animations/AmbientBackground";
import { Splash } from "../onboarding/Onboarding";
import { Icon } from "../ui/Icon";
import { Button, Card, SectionTitle, Segmented, Shape, Switch } from "../ui/primitives";
import { RecoveryKitSheet } from "./RecoveryKitSheet";

export function SettingsScreen() {
  const room = useRoom();
  const router = useRouter();
  const toast = useToast();
  const [fp, setFp] = useState<{ me: string; them: string; safety: string } | null>(null);
  const [kitOpen, setKitOpen] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const [notif, setNotif] = useState(notificationsAllowed);
  const [p, setP] = useState<Prefs>(prefs);

  useEffect(() => {
    if (room.phase !== "ready" && room.phase !== "booting") router.replace("/");
  }, [room.phase, router]);

  useEffect(() => {
    if (room.userId) void loadAppLockCredential(room.userId).then((c) => setLockOn(Boolean(c)));
  }, [room.userId]);

  useEffect(() => {
    if (!room.me || !room.partner || !room.roomId) return;
    void Promise.all([keyFingerprint(room.me.public_key_jwk), keyFingerprint(room.partner.public_key_jwk), safetyNumber(room.roomId, room.me.public_key_jwk, room.partner.public_key_jwk)]).then(([me, them, safety]) =>
      setFp({ me, them, safety }),
    );
  }, [room.me, room.partner, room.roomId]);

  if (room.phase !== "ready") return <Splash />;

  function setPref(patch: Partial<Prefs>) {
    savePrefs(patch);
    setP(prefs());
  }

  async function toggleLock(on: boolean) {
    if (!room.userId) return;
    try {
      if (on) {
        const id = await registerAppLock();
        await saveAppLockCredential(room.userId, id);
        toast.show({ icon: "🔐", text: "App lock on. You'll unlock with your fingerprint, face or device PIN." });
      } else {
        await saveAppLockCredential(room.userId, null);
      }
      setLockOn(on);
      window.dispatchEvent(new Event("usmode-applock"));
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: e instanceof DOMException ? "App lock was cancelled." : friendlyError(e) });
    }
  }

  async function toggleNotifications(on: boolean) {
    if (!on) {
      setNotif(false);
      toast.show({ icon: "🔕", text: "To fully turn notifications off, use your browser's site settings." });
      return;
    }
    const perm = await askNotificationPermission();
    setNotif(perm === "granted");
    if (perm !== "granted") return toast.show({ icon: "🔕", text: "Notifications stay off. The app works fine without them." });
    if (pushConfigured() && room.mode === "live" && room.roomId && room.userId) {
      try {
        const sub = await subscribePush();
        if (sub) await room.backend.savePushSubscription(room.roomId, room.userId, sub);
      } catch (e) {
        toast.show({ tone: "error", icon: "⚠️", text: `Push setup failed: ${friendlyError(e)}` });
      }
    }
  }

  async function signOut() {
    if (room.mode === "demo") {
      await room.backend.signOut();
    } else {
      if (!confirm("Sign out? Your room key stays on this device unless you also choose to forget it.")) return;
      await room.backend.signOut();
    }
    room.reboot();
    router.replace("/");
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-16 pt-6">
      <AmbientBackground mood="vibe" seed={room.room?.theme_seed_hex ?? "#d0436e"} />
      <header className="mb-6 flex items-center gap-2 pt-2">
        <Link href="/vibe" aria-label="Back" className="inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-on-surface/5">
          <Icon name="back" />
        </Link>
        <h1 className="display text-3xl font-black">Room settings</h1>
      </header>

      <Card className="elev-2 flex items-center gap-4">
        <Shape kind="squircle" className="h-16 w-16 shrink-0 text-primary">
          <span className="text-on-primary">
            <Icon name="shield" size={30} />
          </span>
        </Shape>
        <div className="min-w-0">
          <p className="display text-xl font-bold">E2EE Locked • 2/2 Devices</p>
          <p className="text-sm text-on-surface-variant">AES-256-GCM, keys made on your phones by ECDH P-256. The server only stores ciphertext.</p>
        </div>
      </Card>

      {fp && (
        <Card className="elev-1 mt-3 space-y-3">
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-on-surface-variant">Your device</span>
            <span className="tabular font-semibold">{fp.me}</span>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-on-surface-variant">{room.names.partner}&apos;s device</span>
            <span className="tabular font-semibold">{fp.them}</span>
          </div>
          <div>
            <p className="text-sm text-on-surface-variant">Safety number. Compare it on a call; it should match exactly on both phones.</p>
            <p className="tabular mt-1 text-lg font-bold tracking-wider">{fp.safety}</p>
          </div>
        </Card>
      )}

      <SectionTitle>Keys</SectionTitle>
      <Card className="elev-1 space-y-3">
        <p className="text-sm text-on-surface-variant">Lose this phone without a recovery kit and the room&apos;s history can&apos;t be decrypted again. Not by us, not by anyone.</p>
        <Button variant="tonal" icon="key" onClick={() => setKitOpen(true)}>
          Export recovery kit
        </Button>
        <Switch
          checked={lockOn}
          onChange={toggleLock}
          disabled={!appLockSupported()}
          label="App lock"
          description={appLockSupported() ? "Fingerprint, face or device PIN (WebAuthn). Re-locks after 5 min away." : "This browser doesn't support passkeys."}
        />
      </Card>

      <SectionTitle>Notifications &amp; feel</SectionTitle>
      <Card className="elev-1 space-y-1">
        <Switch
          checked={notif}
          onChange={toggleNotifications}
          label="Notifications"
          description={pushConfigured() ? "Kisses, end-of-day nudges. Never shows what was written." : "In-app and while the app is open. Push needs VAPID keys (see README)."}
        />
        <Switch checked={p.sound} onChange={(v) => setPref({ sound: v })} label="Sounds" description="Chimes and wheel ticks" />
        <Switch checked={p.haptics} onChange={(v) => setPref({ haptics: v })} label="Haptics" description="Vibration on supported phones" />
        <div className="py-2">
          <p className="mb-2 font-medium">Motion</p>
          <Segmented
            value={p.reducedMotion}
            onChange={(v) => setPref({ reducedMotion: v })}
            options={[
              { value: "system", label: "System" },
              { value: "off", label: "Full" },
              { value: "on", label: "Reduced" },
            ]}
          />
        </div>
        <div className="py-2">
          <p className="mb-2 font-medium">Theme</p>
          <Segmented
            value={p.theme}
            onChange={(v) => setPref({ theme: v })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </div>
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card className="elev-1 space-y-3">
        <Button variant="outlined" icon="logout" onClick={signOut}>
          {room.mode === "demo" ? "Switch partner" : "Sign out"}
        </Button>
        {room.mode === "demo" ? (
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              if (!confirm("Wipe the local demo server and both partners' demo keys?")) return;
              await resetDemoServer();
              window.location.replace(new URL("/", window.location.origin));
            }}
          >
            Reset demo
          </Button>
        ) : (
          <Button
            variant="danger"
            icon="trash"
            onClick={async () => {
              if (!room.userId || !confirm("Forget this device's keys and sign out? Without a recovery kit you can't read the room on this device again.")) return;
              await forgetUser(room.userId);
              await room.backend.signOut();
              window.location.replace(new URL("/", window.location.origin));
            }}
          >
            Forget keys on this device
          </Button>
        )}
        <p className="text-xs text-on-surface-variant">USMODE is for adults (18+) in a consenting relationship.</p>
      </Card>

      <RecoveryKitSheet open={kitOpen} onClose={() => setKitOpen(false)} />
    </main>
  );
}
