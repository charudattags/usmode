"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { allTimeWins, weeklyTally, winStreak, type ClosedCycleSummary } from "@/engine/eod";
import { backchodiWindow, formatCountdown } from "@/engine/time";
import { DEFAULT_DARES } from "@/state/config";
import { aad, useRoom, type PostView } from "@/state/RoomProvider";
import { useNow } from "@/state/useNow";
import { Composer } from "../media/Composer";
import { PostBody, timeAgo } from "../rooms/PostCard";
import { PageHeader, SettingsLink } from "../shell/TabShell";
import { Avatar, Button, Card, IconButton, SectionTitle, Shape, Sheet, TextField, springs } from "../ui/primitives";
import { DareWheel } from "./DareWheel";

export function BackchodiScreen() {
  const room = useRoom();
  const now = useNow(1000);
  const r = room.room;
  const win = r && now ? backchodiWindow(new Date(now), r.backchodi_start_time.slice(0, 5), r.backchodi_tz, r.backchodi_minutes) : null;

  // When the window opens, sealed drops become readable: refetch at that moment.
  useEffect(() => {
    if (!win || win.open) return;
    const ms = win.opensAt.getTime() - Date.now();
    if (ms > 2 ** 31 - 1) return;
    const t = setTimeout(() => void room.refresh(["room_posts"]), ms + 500);
    return () => clearTimeout(t);
  }, [win?.opensAt.getTime(), win?.open, room]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Backchodi" subtitle={room.cozyMode ? "🛋️ Cozy Mode tonight: low-key and no pressure" : "The 2-hour hangout hub"} actions={<SettingsLink />} />

      {win && (
        <motion.div layout className={`relative overflow-hidden rounded-[28px] p-5 ${win.open ? "bg-primary text-on-primary" : "bg-surface-container-high"}`}>
          {win.open && <span className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-on-primary/10" style={{ animation: "breathe 3s ease-in-out infinite" }} />}
          <p className="text-xs font-bold uppercase tracking-[0.25em] opacity-80">{win.open ? "Live now" : "Next hangout"}</p>
          <p className="tabular mt-1 text-4xl font-bold">{win.open ? formatCountdown(win.closesAt.getTime() - now) : formatCountdown(win.opensAt.getTime() - now)}</p>
          <p className="text-sm opacity-80">
            {win.open ? "left in tonight's window" : `until ${win.opensAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} your time`}
          </p>
        </motion.div>
      )}

      <Vault windowOpen={!!win?.open} opensAt={win?.opensAt ?? null} now={now} />
      <Verdict />
    </>
  );
}

/* --------------------------------- vault --------------------------------- */

function Vault({ windowOpen, opensAt, now }: { windowOpen: boolean; opensAt: Date | null; now: number }) {
  const room = useRoom();
  const mineReq = room.me?.vault_unlock_requested_at;
  const theirReq = room.partner?.vault_unlock_requested_at;
  const recent = (iso: string | null | undefined) => !!iso && now - Date.parse(iso) < 12 * 3600_000;
  const drops = room.posts.vault;
  const mine = drops.filter((p) => p.author_id === room.userId);
  const theirsOpen = drops.filter((p) => p.author_id !== room.userId);

  async function requestUnlock() {
    const unlocked = await room.run(() => room.backend.requestVaultUnlock(), ["members", "rooms", "room_posts"]);
    if (unlocked) room.broadcast({ type: "refresh", tables: ["room_posts", "rooms"] });
  }

  return (
    <>
      <SectionTitle>The vault</SectionTitle>
      <Card className="elev-1 space-y-4">
        <p className="text-sm text-on-surface-variant">Drop reels, links, gossip and voice notes during the day. They stay sealed for {room.names.partner} until the hangout starts.</p>
        <Composer roomType="vault" placeholder="Drop something for later…" sendLabel="Seal" />

        {/* Partner's sealed drops: count only, the server won't send the rows yet */}
        <AnimatePresence>
          {room.vaultSealed > 0 && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-4 rounded-[24px] bg-tertiary-container p-4 text-on-tertiary-container">
              <div className="relative h-14 w-16">
                {Array.from({ length: Math.min(3, room.vaultSealed) }, (_, i) => (
                  <motion.span key={i} className="absolute text-4xl" style={{ left: i * 8, top: -i * 4 }} animate={{ rotate: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 2 + i * 0.3 }}>
                    ✉️
                  </motion.span>
                ))}
              </div>
              <div className="flex-1">
                <p className="font-semibold">
                  {room.vaultSealed} sealed drop{room.vaultSealed > 1 ? "s" : ""} from {room.names.partner}
                </p>
                {opensAt && !windowOpen && <p className="tabular text-sm opacity-80">Opens in {formatCountdown(opensAt.getTime() - now)}</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mutual early unlock */}
        {!windowOpen && (room.vaultSealed > 0 || mine.some((p) => p.unlocks_at && Date.parse(p.unlocks_at) > now)) && (
          <div className="flex flex-wrap items-center gap-3 rounded-[24px] bg-surface-container p-3">
            <span className="text-2xl">🔓</span>
            <p className="min-w-0 flex-1 text-sm">
              {recent(mineReq) ? `You asked to open early. Waiting for ${room.names.partner}…` : recent(theirReq) ? `${room.names.partner} wants to open the vault early!` : "Both of you can agree to open early."}
            </p>
            {recent(mineReq) ? (
              <Button size="sm" variant="text" onClick={() => room.run(() => room.backend.cancelVaultUnlock(), ["members"])}>
                Cancel
              </Button>
            ) : (
              <Button size="sm" variant={recent(theirReq) ? "filled" : "tonal"} onClick={requestUnlock}>
                {recent(theirReq) ? "Unlock now" : "Unlock early"}
              </Button>
            )}
          </div>
        )}

        {theirsOpen.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">From {room.names.partner}</p>
            {theirsOpen.map((p) => (
              <VaultItem key={p.id} p={p} now={now} />
            ))}
          </div>
        )}
        {mine.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Your drops</p>
            {mine.map((p) => (
              <VaultItem key={p.id} p={p} now={now} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function VaultItem({ p, now }: { p: PostView; now: number }) {
  const room = useRoom();
  const mine = p.author_id === room.userId;
  const sealed = mine && p.unlocks_at && Date.parse(p.unlocks_at) > now && !(room.room?.vault_early_unlock_at && Date.parse(p.created_at) <= Date.parse(room.room.vault_early_unlock_at));
  return (
    <motion.div layout initial={{ opacity: 0, rotateX: 60 }} animate={{ opacity: 1, rotateX: 0 }} transition={springs.soft} className="rounded-[20px] bg-surface-container p-3">
      <div className="mb-1 flex items-center justify-between text-xs text-on-surface-variant">
        <span>
          {timeAgo(p.created_at)}
          {sealed && p.unlocks_at && ` · 🔒 sealed for ${room.names.partner} · opens in ${formatCountdown(Date.parse(p.unlocks_at) - now)}`}
        </span>
        {mine && <IconButton icon="trash" label="Delete drop" size={30} onClick={() => room.run(() => room.backend.deletePost(p.id), ["room_posts"])} />}
      </div>
      <PostBody p={p} />
      {p.payload.text && <Links text={p.payload.text} />}
    </motion.div>
  );
}

/** Only http(s) links become clickable, opened without a referrer. */
function Links({ text }: { text: string }) {
  const urls = Array.from(new Set(text.match(/https?:\/\/[^\s<>"']+/g) ?? [])).slice(0, 3);
  if (!urls.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {urls.map((u) => {
        let host = u;
        try {
          host = new URL(u).hostname;
        } catch {
          return null;
        }
        return (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="rounded-full bg-secondary-container px-3 py-1 text-xs font-semibold text-on-secondary-container">
            🔗 {host}
          </a>
        );
      })}
    </div>
  );
}

/* -------------------------------- verdict -------------------------------- */

function Verdict() {
  const room = useRoom();
  const [editDares, setEditDares] = useState(false);
  const closed = room.closedCycles;
  const last = closed[0];
  const me = room.userId ?? "";
  const partner = room.partner?.user_id ?? "";
  const summaries: ClosedCycleSummary[] = closed.map((c) => ({ cycleNumber: c.cycle_number, closedAt: c.closed_at ?? c.started_at, winnerUserId: c.winner_user_id, loserUserId: c.loser_user_id }));
  const now = useNow(60_000);
  const tally = now ? weeklyTally(summaries, new Date(now), [me, partner]) : null;
  const nameOf = (id: string | null) => (id === me ? "You" : room.names.partner);
  const avatarOf = (id: string | null) => (id === me ? room.names.meAvatar : room.names.partnerAvatar);

  async function saveDare(dare: string) {
    if (!last || !room.roomId) return;
    const sealed = await room.seal(aad.dare(room.roomId, last.id), dare);
    await room.run(() => room.backend.setDare(last.id, sealed), ["daily_cycles"]);
  }

  return (
    <>
      <SectionTitle
        action={
          <Button size="sm" variant="text" icon="pencil" onClick={() => setEditDares(true)}>
            Dares
          </Button>
        }
      >
        Daily verdict
      </SectionTitle>
      <Card className="elev-2 space-y-5">
        {!last ? (
          <p className="text-sm text-on-surface-variant">No finished days yet. Close a day together in the Arena and the verdict lands here.</p>
        ) : last.winner_user_id ? (
          <div className="flex items-center justify-around gap-2 text-center">
            <div className="flex flex-col items-center gap-2">
              <Shape kind="burst" spin className="h-24 w-24 text-tertiary">
                <span className="text-4xl">{avatarOf(last.winner_user_id)}</span>
              </Shape>
              <span className="text-2xl">👑</span>
              <p className="font-bold">{nameOf(last.winner_user_id)}</p>
              <p className="text-xs uppercase tracking-widest text-on-surface-variant">Winner · Day {last.cycle_number}</p>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Shape kind="clover" className="h-20 w-20 text-surface-container-highest">
                <span className="text-3xl">{avatarOf(last.loser_user_id)}</span>
              </Shape>
              <span className="text-2xl">🫠</span>
              <p className="font-bold">{nameOf(last.loser_user_id)}</p>
              <p className="text-xs uppercase tracking-widest text-on-surface-variant">Owes a dare</p>
            </div>
          </div>
        ) : (
          <p className="text-center">Day {last.cycle_number} was a draw. Nobody reached 100 first, so no dare. 🤝</p>
        )}

        {tally && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="This week" value={`${tally.wins[me] ?? 0}–${tally.wins[partner] ?? 0}`} sub="you – them" />
            <Stat label="Your streak" value={String(winStreak(summaries, me))} sub="wins in a row" />
            <Stat label="All time" value={`${allTimeWins(summaries, me)}–${allTimeWins(summaries, partner)}`} sub={`${summaries.length} days`} />
          </div>
        )}

        {last?.loser_user_id && (
          <div className="border-t border-outline-variant pt-5">
            {last.dare ? (
              <div className="space-y-3 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-on-surface-variant">The dare</p>
                <p className="display text-2xl font-black">{last.dare}</p>
                {last.dare_completed_at ? (
                  <p className="text-sm font-semibold text-primary">✅ Paid in full</p>
                ) : (
                  <Button variant="tonal" icon="check" onClick={() => room.run(() => room.backend.completeDare(last.id), ["daily_cycles"])}>
                    Mark dare done
                  </Button>
                )}
              </div>
            ) : last.loser_user_id === me ? (
              <div className="space-y-2 text-center">
                <p className="font-semibold">You lost Day {last.cycle_number}. Spin for your dare.</p>
                <DareWheel dares={room.config.dares} canSpin onResult={saveDare} />
              </div>
            ) : (
              <div className="space-y-2 text-center">
                <p className="font-semibold">Waiting for {room.names.partner} to spin the dare wheel…</p>
                <DareWheel dares={room.config.dares} canSpin={false} onResult={async () => {}} />
              </div>
            )}
          </div>
        )}
      </Card>

      {closed.length > 1 && (
        <>
          <SectionTitle>History</SectionTitle>
          <div className="space-y-2">
            {closed.slice(1, 15).map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-2xl bg-surface-container-low px-4 py-2 text-sm">
                <span className="tabular w-14 text-on-surface-variant">Day {c.cycle_number}</span>
                {c.winner_user_id ? (
                  <>
                    <Avatar emoji={avatarOf(c.winner_user_id)} size={24} />
                    <span className="flex-1">{nameOf(c.winner_user_id)} won</span>
                  </>
                ) : (
                  <span className="flex-1">Draw</span>
                )}
                {c.dare && <span className="max-w-[40%] truncate text-xs text-on-surface-variant">😈 {c.dare}</span>}
              </div>
            ))}
          </div>
        </>
      )}
      <DaresSheet open={editDares} onClose={() => setEditDares(false)} />
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl bg-surface-container p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">{label}</p>
      <p className="tabular text-2xl font-bold">{value}</p>
      <p className="text-[11px] text-on-surface-variant">{sub}</p>
    </div>
  );
}

function DaresSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const room = useRoom();
  const [list, setList] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (open) setList(room.config.dares);
  }, [open, room.config.dares]);
  return (
    <Sheet open={open} onClose={onClose} title="Dare wheel">
      <div className="space-y-3">
        <p className="text-sm text-on-surface-variant">2 to 12 dares. Encrypted, shared by both of you.</p>
        {list.map((d, i) => (
          <div key={i} className="flex items-center gap-2 rounded-2xl bg-surface-container px-4 py-2">
            <span className="flex-1 text-sm">{d}</span>
            <IconButton icon="close" label="Remove dare" size={32} disabled={list.length <= 2} onClick={() => setList(list.filter((_, j) => j !== i))} />
          </div>
        ))}
        {list.length < 12 && (
          <div className="flex gap-2">
            <TextField
              className="flex-1"
              label="New dare"
              value={draft}
              maxLength={120}
              onChange={setDraft}
              onEnter={() => {
                if (draft.trim()) {
                  setList([...list, draft.trim()]);
                  setDraft("");
                }
              }}
            />
            <IconButton
              icon="plus"
              label="Add dare"
              variant="filled"
              size={56}
              disabled={!draft.trim()}
              onClick={() => {
                setList([...list, draft.trim()]);
                setDraft("");
              }}
            />
          </div>
        )}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={async () => {
              await room.saveConfig({ dares: list });
              onClose();
            }}
          >
            Save
          </Button>
          <Button variant="text" onClick={() => setList(DEFAULT_DARES)}>
            Reset
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
