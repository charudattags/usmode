"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { formatPoints, hasReached100, isOvertake, MAX_TASKS_PER_DAY, scoreTenths, weighTasks } from "@/engine/scoring";
import { friendlyError } from "@/data/backend";
import { compressImage, uploadEncrypted } from "@/lib/media";
import { sounds, vibrate } from "@/lib/device";
import { aad, useRoom, type TaskView } from "@/state/RoomProvider";
import { useToast } from "@/state/toast";
import { useFx } from "../animations/FxProvider";
import { EncryptedImage } from "../media/MediaView";
import { PageHeader, SettingsLink } from "../shell/TabShell";
import { Icon } from "../ui/Icon";
import { Avatar, Button, Card, IconButton, SectionTitle, Shape, springs } from "../ui/primitives";

export function ArenaScreen() {
  const room = useRoom();
  const fx = useFx();
  const mine = weighTasks(room.myTasks);
  const theirs = weighTasks(room.partnerTasks);
  const myScore = scoreTenths(room.myTasks);
  const theirScore = scoreTenths(room.partnerTasks);
  const myReached = room.scores.find((s) => s.user_id === room.userId)?.reached_100_at ?? null;
  const theirReached = room.scores.find((s) => s.user_id === room.partner?.user_id)?.reached_100_at ?? null;
  const leader = myReached && (!theirReached || myReached < theirReached) ? "me" : theirReached ? "them" : null;

  // OVERTAKE! when I pass my partner.
  const prev = useRef<{ m: number; t: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    if (p && isOvertake(p.m, p.t, myScore, theirScore) && theirScore > 0) fx.overtake();
    prev.current = { m: myScore, t: theirScore };
  }, [myScore, theirScore, fx]);

  const c = room.openCycle;
  return (
    <>
      <PageHeader title="Arena" subtitle={c ? `Day ${c.cycle_number} · first to 100 wins` : ""} actions={<SettingsLink />} />
      <RaceBar myScore={myScore} theirScore={theirScore} leader={leader} />

      <SectionTitle
        action={
          <span className="tabular text-sm font-semibold text-primary">
            {formatPoints(myScore)}/100
          </span>
        }
      >
        My tasks
      </SectionTitle>
      <MyTasks tasks={mine} reached={hasReached100(room.myTasks)} />

      <SectionTitle
        action={
          <span className="tabular text-sm font-semibold text-tertiary">
            {formatPoints(theirScore)}/100
          </span>
        }
      >
        {room.names.partner}&apos;s tasks
      </SectionTitle>
      <Card className="elev-1 space-y-2">
        {theirs.length === 0 && <p className="text-sm text-on-surface-variant">No tasks yet. They&apos;re plotting.</p>}
        {theirs.map((t) => (
          <PartnerTask key={t.id} t={t} />
        ))}
      </Card>

      <SectionTitle>End of day</SectionTitle>
      <Card className="elev-1">
        {c?.status === "eod_pending" ? (
          <p className="text-sm">{c.eod_proposed_by === room.userId ? `Waiting for ${room.names.partner} to confirm.` : `${room.names.partner} proposed wrapping up. Use the banner above.`}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-on-surface-variant">Days never reset at midnight. When you&apos;re both done, lock the scoreboard together and tomorrow&apos;s race starts fresh.</p>
            {c?.eod_declined_by && c.eod_declined_by !== room.userId && <p className="text-sm font-medium text-tertiary">{room.names.partner} said not yet. Give them a bit.</p>}
            <Button icon="lock" variant="tonal" onClick={() => room.run(() => room.backend.proposeEod(), ["daily_cycles"])} disabled={!room.partner}>
              Propose end of day
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

function RaceBar({ myScore, theirScore, leader }: { myScore: number; theirScore: number; leader: "me" | "them" | null }) {
  const room = useRoom();
  const lane = (score: number, avatar: string, name: string, color: "primary" | "tertiary", crowned: boolean) => (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-semibold">{name}</span>
        <span className="tabular font-bold">{formatPoints(score)}</span>
      </div>
      <div className="relative h-10 rounded-full bg-surface-container-highest">
        <motion.div
          className={`absolute inset-y-0 left-0 rounded-full ${color === "primary" ? "plasma" : "bg-tertiary"}`}
          style={{ boxShadow: `0 0 24px var(--md-sys-color-${color})` }}
          initial={false}
          animate={{ width: `${Math.max(8, score / 10)}%` }}
          transition={{ type: "spring", stiffness: 140, damping: 18 }}
        />
        <motion.div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" initial={false} animate={{ left: `${Math.min(96, Math.max(4, score / 10))}%` }} transition={{ type: "spring", stiffness: 140, damping: 18 }}>
          <span className="relative block">
            <Avatar emoji={avatar} size={36} />
            {crowned && <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-lg">👑</span>}
          </span>
        </motion.div>
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-on-surface-variant">100</span>
      </div>
    </div>
  );
  return (
    <Card className="elev-2 space-y-4">
      {lane(myScore, room.names.meAvatar, "You", "primary", leader === "me")}
      {lane(theirScore, room.names.partnerAvatar, room.names.partner, "tertiary", leader === "them")}
      {leader && (
        <p className="text-center text-sm font-semibold">
          {leader === "me" ? "👑 You're today's provisional winner" : `👑 ${room.names.partner} hit 100 first (provisional)`}
        </p>
      )}
    </Card>
  );
}

function MyTasks({ tasks, reached }: { tasks: (TaskView & { weightTenths: number })[]; reached: boolean }) {
  const room = useRoom();
  const toast = useToast();
  const fx = useFx();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const c = room.openCycle;

  async function add() {
    const t = title.trim();
    if (!t || !c || !room.roomId || !room.userId) return;
    if (tasks.length >= MAX_TASKS_PER_DAY) return toast.show({ tone: "error", icon: "⚠️", text: `At most ${MAX_TASKS_PER_DAY} tasks a day.` });
    setBusy(true);
    const sealed = await room.seal(aad.task(room.roomId, room.userId), t.slice(0, 140));
    const ok = await room.run(() => room.backend.addTask(room.roomId!, c.id, room.userId!, sealed), ["tasks", "cycle_scores"]);
    if (ok) setTitle("");
    setBusy(false);
  }

  async function complete(t: TaskView & { weightTenths: number }, el: HTMLElement | null, photo?: File) {
    let path: string | null = null;
    if (photo && room.key && room.roomId && room.userId) {
      try {
        const { bytes } = await compressImage(photo);
        path = await uploadEncrypted(room.backend, room.key, room.roomId, room.userId, bytes);
      } catch (e) {
        toast.show({ tone: "error", icon: "⚠️", text: `Photo proof failed: ${friendlyError(e)}` });
        return;
      }
    }
    const rect = el?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top : window.innerHeight / 2;
    // Fire the celebration immediately; the write follows.
    fx.burst(x / window.innerWidth, y / window.innerHeight, { angle: 70, spread: 55, count: 70 });
    fx.pill(`+${formatPoints(t.weightTenths)} PTS`, x, y - 10);
    fx.shake();
    vibrate(25);
    sounds.pop();
    const done = await room.run(() => room.backend.completeTask(t.id, path), ["tasks", "cycle_scores"]);
    if (done && tasks.filter((x) => !x.is_completed).length === 1) {
      setTimeout(() => {
        fx.burst(0.5, 0.4, { spread: 160, count: 200 });
        fx.hearts();
        sounds.chime();
        toast.show({ icon: "💯", text: "100/100! Your partner owes you a kiss for every task." });
      }, 400);
    }
  }

  return (
    <Card className="elev-1">
      <div className="mb-3 h-3 overflow-hidden rounded-full bg-surface-container-highest">
        <motion.div className="h-full rounded-full bg-primary" initial={false} animate={{ width: `${scoreTenths(tasks) / 10}%` }} transition={{ type: "spring", stiffness: 120, damping: 14 }} style={{ boxShadow: "0 0 16px var(--md-sys-color-primary)" }} />
      </div>
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {tasks.map((t) => (
            <MyTask key={t.id} t={t} onComplete={complete} />
          ))}
        </AnimatePresence>
      </ul>
      {tasks.length === 0 && <p className="py-2 text-sm text-on-surface-variant">Add today&apos;s tasks. Each one is worth 100 ÷ your task count.</p>}
      {reached && <p className="mt-3 text-center text-sm font-semibold text-primary">💯 You&apos;re at 100. Adding a task drops you below and resets your finish time.</p>}
      <div className="mt-3 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a task…"
          maxLength={140}
          className="h-12 min-w-0 flex-1 rounded-full border border-outline bg-transparent px-5 outline-none focus:border-2 focus:border-primary"
          aria-label="New task"
        />
        <IconButton icon="plus" label="Add task" variant="filled" size={48} onClick={add} disabled={busy || !title.trim()} />
      </div>
    </Card>
  );
}

function MyTask({ t, onComplete }: { t: TaskView & { weightTenths: number }; onComplete: (t: TaskView & { weightTenths: number }, el: HTMLElement | null, photo?: File) => Promise<void> }) {
  const room = useRoom();
  const box = useRef<HTMLButtonElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(t.title);
  const [popped, setPopped] = useState(false);

  async function rename() {
    setEditing(false);
    const v = text.trim();
    if (!v || v === t.title || !room.roomId || !room.userId) return;
    const sealed = await room.seal(aad.task(room.roomId, room.userId), v.slice(0, 140));
    await room.run(() => room.backend.renameTask(t.id, sealed), ["tasks"]);
  }

  return (
    <motion.li layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 60 }} transition={springs.soft} className="flex items-center gap-3 rounded-2xl bg-surface-container px-3 py-2">
      <motion.button
        ref={box}
        aria-label={t.is_completed ? "Completed" : `Complete ${t.title}`}
        disabled={t.is_completed}
        onClick={() => {
          setPopped(true);
          void onComplete(t, box.current);
        }}
        animate={popped || t.is_completed ? { scale: [1, 0.55, 1.25, 1] } : { scale: 1 }}
        transition={{ duration: 0.45, times: [0, 0.3, 0.7, 1] }}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border-2 ${t.is_completed ? "border-primary bg-primary text-on-primary" : "border-outline"}`}
      >
        {t.is_completed && <Icon name="check" size={20} />}
      </motion.button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && rename()} maxLength={140} className="w-full bg-transparent outline-none" aria-label="Rename task" />
        ) : (
          <button className={`block w-full truncate text-left ${t.is_completed ? "text-on-surface-variant line-through" : ""}`} onClick={() => !t.is_completed && setEditing(true)} disabled={t.is_completed}>
            {t.title}
          </button>
        )}
        {t.encrypted_proof_path && <EncryptedImage path={t.encrypted_proof_path} alt="Proof photo" className="mt-2 h-20 w-28 rounded-xl" />}
      </div>
      <span className="tabular shrink-0 text-xs font-bold text-on-surface-variant">{formatPoints(t.weightTenths)}</span>
      {!t.is_completed && (
        <>
          <IconButton icon="camera" label="Complete with photo proof" size={34} onClick={() => file.current?.click()} />
          <input
            ref={file}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setPopped(true);
                void onComplete(t, box.current, f);
              }
            }}
          />
          <IconButton icon="trash" label="Delete task" size={34} onClick={() => room.run(() => room.backend.deleteTask(t.id), ["tasks", "cycle_scores"])} />
        </>
      )}
    </motion.li>
  );
}

function PartnerTask({ t }: { t: TaskView & { weightTenths: number } }) {
  const [show, setShow] = useState(false);
  return (
    <div className="rounded-2xl bg-surface-container px-3 py-2">
      <div className="flex items-center gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${t.is_completed ? "border-tertiary bg-tertiary text-on-tertiary" : "border-outline-variant"}`}>
          {t.is_completed && <Icon name="check" size={18} />}
        </span>
        <span className={`min-w-0 flex-1 truncate ${t.is_completed ? "text-on-surface-variant line-through" : ""}`}>{t.title}</span>
        {t.encrypted_proof_path && (
          <button className="text-xs font-semibold text-primary" onClick={() => setShow((s) => !s)}>
            {show ? "Hide proof" : "📸 Proof"}
          </button>
        )}
        <span className="tabular text-xs font-bold text-on-surface-variant">{formatPoints(t.weightTenths)}</span>
      </div>
      {show && t.encrypted_proof_path && <EncryptedImage path={t.encrypted_proof_path} alt="Partner's proof photo" className="mt-2 aspect-[4/3] w-full rounded-xl" />}
    </div>
  );
}

export function CrownBadge({ label }: { label: string }) {
  return (
    <Shape kind="burst" className="h-16 w-16 text-tertiary">
      <span className="text-center text-[10px] font-black uppercase text-on-tertiary">{label}</span>
    </Shape>
  );
}
