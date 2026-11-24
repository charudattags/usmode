"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { formatPairingCode, openRecoveryKit, parsePairingFragment, type RecoveryKit } from "@/crypto/e2ee";
import { getOrCreateDeviceIdentity, saveRoomKey } from "@/crypto/keystore";
import { setMode } from "@/data";
import { currentDemoIdentity, resetDemoServer, setDemoIdentity } from "@/data/demo/backend";
import { friendlyError } from "@/data/backend";
import { env, supabaseConfigured } from "@/lib/env";
import { formatCountdown } from "@/engine/time";
import { createRoomAndInvite, currentInvite, joinRoom, refreshInvite, type Invite } from "@/state/pairing";
import { useRoom } from "@/state/RoomProvider";
import { useNow } from "@/state/useNow";
import { useToast } from "@/state/toast";
import { AmbientBackground } from "../animations/AmbientBackground";
import { Icon } from "../ui/Icon";
import { Button, Card, Shape, TextField, springs } from "../ui/primitives";

const PENDING_JOIN = "usmode-pending-join";

export function savePendingJoin(code: string, secret: string | null) {
  sessionStorage.setItem(PENDING_JOIN, JSON.stringify({ code, secret }));
}
function takePendingJoin(): { code: string; secret: string | null } | null {
  const raw = sessionStorage.getItem(PENDING_JOIN);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_JOIN);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <AmbientBackground mood="vibe" seed="#d0436e" />
      {children}
    </main>
  );
}

function Brand() {
  return (
    <div className="mb-8 text-center">
      <motion.div initial={{ scale: 0.4, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={springs.bouncy} className="mx-auto mb-4 w-fit">
        <Shape kind="clover" spin className="h-24 w-24 text-primary-container">
          <span className="text-4xl">💞</span>
        </Shape>
      </motion.div>
      <h1 className="display text-5xl font-black tracking-tight">USMODE</h1>
      <p className="mt-2 text-on-surface-variant">A private room for exactly two. End-to-end encrypted.</p>
    </div>
  );
}

export function Splash() {
  return (
    <Frame>
      <div className="flex flex-col items-center gap-4">
        <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
          <Shape kind="clover" className="h-20 w-20 text-primary-container">
            <span className="text-3xl">💞</span>
          </Shape>
        </motion.div>
        <p className="text-sm text-on-surface-variant">Unlocking your room…</p>
      </div>
    </Frame>
  );
}

export function Gate() {
  const room = useRoom();
  const router = useRouter();
  useEffect(() => {
    if (room.phase === "ready") router.replace("/vibe");
  }, [room.phase, router]);
  switch (room.phase) {
    case "booting":
    case "ready":
      return <Splash />;
    case "signed_out":
      return <Welcome />;
    case "no_room":
      return <PairStart />;
    case "pairing":
      return <Pairing />;
    case "error":
      return (
        <Frame>
          <Card className="text-center">
            <p className="mb-4">{room.error}</p>
            <Button onClick={room.reboot}>Try again</Button>
          </Card>
        </Frame>
      );
  }
}

/* ------------------------------ sign in ------------------------------- */

function Welcome() {
  const room = useRoom();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = supabaseConfigured() && room.mode === "live";

  async function send() {
    setBusy(true);
    try {
      await room.backend.sendOtp(email.trim());
      setSent(true);
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
    setBusy(false);
  }
  async function verify() {
    setBusy(true);
    try {
      await room.backend.verifyOtp(email.trim(), code.trim());
      room.reboot();
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
    setBusy(false);
  }
  function demo(as: "A" | "B") {
    setMode("demo");
    setDemoIdentity(as);
    room.reboot();
  }

  return (
    <Frame>
      <Brand />
      {live && (
        <Card className="glass mb-4 space-y-3">
          <h2 className="display text-xl font-bold">Sign in</h2>
          {!sent ? (
            <>
              <TextField label="Email" type="email" inputMode="email" value={email} onChange={setEmail} onEnter={send} />
              <Button className="w-full" onClick={send} disabled={busy || !/^\S+@\S+\.\S+$/.test(email)}>
                Email me a code
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-on-surface-variant">We sent a 6-digit code to {email}.</p>
              <TextField label="Code" inputMode="numeric" mono value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 8))} onEnter={verify} />
              <Button className="w-full" onClick={verify} disabled={busy || code.length < 6}>
                Sign in
              </Button>
              <button className="w-full text-sm text-primary" onClick={() => setSent(false)}>
                Use a different email
              </button>
            </>
          )}
          <p className="text-xs text-on-surface-variant">You must be 18 or older. Your email is only used to sign in.</p>
        </Card>
      )}
      {env.demoEnabled && (
        <Card className="glass space-y-3">
          <h2 className="display text-xl font-bold">{live ? "Or try the two-tab demo" : "Two-tab demo"}</h2>
          <p className="text-sm text-on-surface-variant">
            {live
              ? "Everything runs locally in this browser. Open Partner A here and Partner B in a second window to watch them sync."
              : "No backend is configured, so USMODE runs on a local demo server in this browser. Open Partner A here and Partner B in a second window."}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="tonal" onClick={() => demo("A")}>
              I&apos;m Partner A
            </Button>
            <Button variant="tonal" onClick={() => demo("B")}>
              I&apos;m Partner B
            </Button>
          </div>
          <Button variant="text" icon="share" className="w-full" onClick={() => window.open("/?as=B", "_blank", "noopener")}>
            Open a Partner B window
          </Button>
        </Card>
      )}
    </Frame>
  );
}

/* ---------------------------- create / join ---------------------------- */

function PairStart() {
  const room = useRoom();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "create" | "join">(null);
  const [scanning, setScanning] = useState(false);
  const auto = useRef(false);

  async function join(rawCode: string, secret: string | null) {
    if (!room.userId) return;
    setBusy("join");
    try {
      await joinRoom(room.backend, room.userId, rawCode, secret);
      room.reboot();
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
    setBusy(null);
  }

  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    const p = takePendingJoin();
    if (p) void join(p.code, p.secret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    if (!room.userId) return;
    setBusy("create");
    try {
      await createRoomAndInvite(room.backend, room.userId);
      room.reboot();
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
    setBusy(null);
  }

  function fromInput(v: string) {
    // Accept a pasted invite link as well as a bare code.
    const hash = v.includes("#") ? v.slice(v.indexOf("#")) : "";
    const link = hash ? parsePairingFragment(hash) : null;
    if (link) return join(link.code, link.qrSecret);
    return join(v, null);
  }

  return (
    <Frame>
      <Brand />
      {room.mode === "demo" && <DemoBadge />}
      <Card className="glass mb-4 space-y-3">
        <h2 className="display text-xl font-bold">Start your room</h2>
        <p className="text-sm text-on-surface-variant">You get a pairing code and QR for your partner. Once they join, the room locks to the two of you.</p>
        <Button className="w-full" size="lg" icon="plus" onClick={create} disabled={!!busy}>
          {busy === "create" ? "Generating keys…" : "Create our room"}
        </Button>
      </Card>
      <Card className="glass space-y-3">
        <h2 className="display text-xl font-bold">Join with a code</h2>
        <TextField label="Pairing code or invite link" mono value={code} onChange={setCode} placeholder="K9X4-M2QP" onEnter={() => fromInput(code)} />
        <div className="flex gap-2">
          <Button className="flex-1" variant="tonal" onClick={() => fromInput(code)} disabled={!!busy || code.trim().length < 8}>
            {busy === "join" ? "Checking…" : "Join"}
          </Button>
          <Button variant="outlined" icon="camera" onClick={() => setScanning(true)}>
            Scan
          </Button>
        </div>
      </Card>
      <SignOutLink />
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            void fromInput(text);
          }}
        />
      )}
    </Frame>
  );
}

function SignOutLink() {
  const room = useRoom();
  return (
    <button className="mx-auto mt-6 text-sm text-on-surface-variant underline-offset-4 hover:underline" onClick={async () => { await room.backend.signOut(); room.reboot(); }}>
      {room.mode === "demo" ? `Switch partner (you're ${currentDemoIdentity() ?? "?"})` : "Sign out"}
    </button>
  );
}

function DemoBadge() {
  return (
    <div className="mb-4 flex items-center justify-center gap-2 text-xs font-semibold text-tertiary">
      <span className="rounded-full bg-tertiary-container px-3 py-1 text-on-tertiary-container">DEMO • Partner {currentDemoIdentity()}</span>
      <button className="underline" onClick={async () => { if (confirm("Wipe the local demo server for both partners?")) { await resetDemoServer(); location.reload(); } }}>
        reset
      </button>
    </div>
  );
}

/** In-app QR scanning where BarcodeDetector exists; the phone camera app works everywhere else. */
function QrScanner({ onClose, onResult }: { onClose: () => void; onResult: (s: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState("Point the camera at your partner's QR code.");
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let alive = true;
    (async () => {
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      if (!BD) {
        setMsg("This browser can't scan in-app. Open your phone's camera app and point it at the QR, or type the code.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!alive || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new BD({ formats: ["qr_code"] });
        const loop = async () => {
          if (!alive || !video.current) return;
          try {
            const codes = await det.detect(video.current);
            if (codes[0]?.rawValue) return onResult(codes[0].rawValue);
          } catch {
            /* frame not ready */
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        setMsg("Camera permission was denied. You can still type the code.");
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-white">
      <video ref={video} className="aspect-square w-full max-w-xs rounded-[28px] bg-black object-cover" muted playsInline />
      <p className="max-w-xs text-center text-sm">{msg}</p>
      <Button variant="tonal" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

/* ------------------------------ pairing ------------------------------- */

function Pairing() {
  const room = useRoom();
  const st = room.handshake;
  const isCreator = room.room?.created_by === room.userId;
  return (
    <Frame>
      {room.mode === "demo" && <DemoBadge />}
      <AnimatePresence mode="wait">
        {!st || (isCreator && st.step === "waiting_for_partner") ? (
          <motion.div key="invite" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            {isCreator ? <InviteCard /> : <Waiting text="Connecting…" />}
          </motion.div>
        ) : st.step === "failed" ? (
          <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="glass space-y-4">
              <h2 className="display text-xl font-bold">Handshake problem</h2>
              <p className="text-sm">{st.reason}</p>
              <RestoreKit />
            </Card>
          </motion.div>
        ) : (
          <motion.div key="wait" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Waiting
              text={
                st.step === "waiting_for_key"
                  ? "Joined! Waiting for your partner's device to seal the room key for you. Keep both apps open for a moment."
                  : st.step === "delivering"
                    ? "Sealing the room key for your partner…"
                    : "Partner joined. Finishing the key exchange…"
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
      <SignOutLink />
    </Frame>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <Card className="glass flex flex-col items-center gap-4 text-center">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }}>
        <Shape kind="burst" className="h-16 w-16 text-primary-container">
          <Icon name="key" />
        </Shape>
      </motion.div>
      <p>{text}</p>
      <p className="text-xs text-on-surface-variant">ECDH P-256 + AES-256-GCM. The server never sees the key.</p>
    </Card>
  );
}

function InviteCard() {
  const room = useRoom();
  const toast = useToast();
  const now = useNow(1000);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [qr, setQr] = useState<string>("");

  useEffect(() => {
    if (!room.room || !room.userId) return;
    let alive = true;
    void currentInvite(room.backend, room.userId, room.room).then((i) => alive && setInvite(i));
    return () => {
      alive = false;
    };
  }, [room.room, room.userId, room.backend]);

  useEffect(() => {
    if (!invite) return;
    const style = getComputedStyle(document.documentElement);
    void QRCode.toDataURL(invite.link, {
      margin: 1,
      width: 480,
      errorCorrectionLevel: "M",
      color: { dark: style.getPropertyValue("--md-sys-color-on-surface").trim() || "#000000", light: "#00000000" },
    }).then(setQr);
  }, [invite]);

  if (!invite) return <Waiting text="Preparing your invite…" />;
  const left = Date.parse(invite.expiresAt) - now;

  async function refresh() {
    if (!room.userId || !room.roomId) return;
    setInvite(await refreshInvite(room.backend, room.userId, room.roomId));
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join me on USMODE", text: "Our private room. Tap to join:", url: invite!.link });
        return;
      } catch {
        /* cancelled */
      }
    }
    await navigator.clipboard.writeText(invite!.link);
    toast.show({ icon: "🔗", text: "Invite link copied. It carries a one-time secret, so send it privately." });
  }

  return (
    <Card className="glass space-y-5 text-center">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Pairing code</p>
        <motion.button
          className="tabular mt-2 text-5xl font-bold tracking-[0.12em]"
          whileTap={{ scale: 0.95 }}
          onClick={async () => {
            await navigator.clipboard.writeText(formatPairingCode(invite.code));
            toast.show({ icon: "📋", text: "Code copied" });
          }}
          aria-label="Copy pairing code"
        >
          {formatPairingCode(invite.code)}
        </motion.button>
        <p className="mt-1 text-xs text-on-surface-variant">{left > 0 ? `Expires in ${formatCountdown(left)}` : "Expired"}</p>
      </div>
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code with your invite link" className="mx-auto aspect-square w-56 rounded-2xl bg-surface-container-highest p-3" />
      )}
      <p className="text-sm text-on-surface-variant">Scanning the QR is strongest: its link carries an extra secret that never touches the server.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="tonal" icon="share" onClick={share}>
          Share link
        </Button>
        <Button variant="outlined" icon="refresh" onClick={refresh}>
          New code
        </Button>
        {room.mode === "demo" && (
          <Button variant="filled" icon="share" onClick={() => window.open(invite.link.replace("/pair#", "/pair?as=B#"), "_blank", "noopener")}>
            Open Partner B window
          </Button>
        )}
      </div>
      <button
        className="text-sm text-error"
        onClick={async () => {
          if (!confirm("Cancel this room? The code stops working.")) return;
          await room.run(() => room.backend.cancelRoom());
          room.reboot();
        }}
      >
        Cancel room
      </button>
    </Card>
  );
}

/** Restore the room key on a new device from an exported recovery kit. */
export function RestoreKit() {
  const room = useRoom();
  const toast = useToast();
  const [kit, setKit] = useState<RecoveryKit | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  async function restore() {
    if (!kit || !room.userId || !room.roomId) return;
    if (kit.roomId !== room.roomId) return toast.show({ tone: "error", icon: "⚠️", text: "That kit is for a different room." });
    setBusy(true);
    try {
      const raw = await openRecoveryKit(kit, pass);
      await saveRoomKey(room.userId, room.roomId, raw);
      const identity = await getOrCreateDeviceIdentity(room.userId);
      await room.backend.updateMyMember(room.userId, { public_key_jwk: identity.publicJwk });
      toast.show({ icon: "🔓", text: "Room key restored on this device. Your safety number changed; compare it with your partner." });
      room.reboot();
    } catch (e) {
      toast.show({ tone: "error", icon: "⚠️", text: friendlyError(e) });
    }
    setBusy(false);
  }
  return (
    <div className="space-y-3 text-left">
      <p className="text-sm font-semibold">Restore from recovery kit</p>
      <input
        type="file"
        accept="application/json,.json"
        className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-secondary-container file:px-4 file:py-2 file:font-semibold file:text-on-secondary-container"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            setKit(JSON.parse(await f.text()));
          } catch {
            toast.show({ tone: "error", icon: "⚠️", text: "That file isn't a recovery kit." });
          }
        }}
      />
      <TextField label="Kit passphrase" type="password" value={pass} onChange={setPass} onEnter={restore} />
      <Button className="w-full" onClick={restore} disabled={!kit || pass.length < 10 || busy}>
        {busy ? "Deriving key (600k rounds)…" : "Restore"}
      </Button>
    </div>
  );
}
