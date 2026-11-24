"use client";
/**
 * The room store. Loads rows from the backend, decrypts them on this device,
 * keeps them fresh from realtime changes, and turns partner activity into
 * notifications (owed kisses, low battery, end-of-day nudges).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aadFor, decryptJSON, decryptText, encryptJSON, encryptText, type Sealed } from "@/crypto/e2ee";
import { loadRoomKey } from "@/crypto/keystore";
import { friendlyError, type Backend } from "@/data/backend";
import { currentMode, getBackend, setMode, type Mode } from "@/data";
import { setDemoIdentity } from "@/data/demo/backend";
import { CHANGE_TABLES } from "@/data/tables";
import type {
  BroadcastEvent,
  ChangeTable,
  CycleRow,
  KissRow,
  KissStats,
  MemberRow,
  OwedRow,
  PostRow,
  ReactionRow,
  RevealRoundRow,
  RoomRow,
  RoomType,
  RoomUpdate,
  ScoreRow,
  TaskRow,
} from "@/data/types";
import { applySeed } from "@/theme/materialYou";
import { localNotify, sounds, vibrate } from "@/lib/device";
import { advanceHandshake, type HandshakeState } from "./pairing";
import { defaultConfig, sanitizeConfig, sanitizePayload, safeArtUrl, safeSpotifyUrl, type PostPayload, type RoomConfig, type TrackMeta } from "./config";
import { useToast } from "./toast";

/** "?as=A" / "?as=B" opens this tab as that demo partner (used by "Open Partner B window"). */
function consumeDemoParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const as = url.searchParams.get("as");
  if (as !== "A" && as !== "B") return;
  setMode("demo");
  setDemoIdentity(as);
  url.searchParams.delete("as");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export type Phase = "booting" | "signed_out" | "no_room" | "pairing" | "ready" | "error";

export interface TaskView extends TaskRow {
  title: string;
  /** Same as is_completed, in the shape the scoring engine expects. */
  isCompleted: boolean;
}
export interface PostView extends PostRow {
  payload: PostPayload;
  broken: boolean;
}
export interface OwedView extends OwedRow {
  title: string;
}
export interface KissView extends KissRow {
  note: string | null;
  taskTitle: string | null;
}
export interface CycleView extends CycleRow {
  dare: string | null;
}

export interface SpotifyView {
  jamUrl: string | null;
  track: TrackMeta | null;
  updatedBy: string | null;
}

interface Data {
  room: RoomRow | null;
  members: MemberRow[];
  config: RoomConfig;
  cycles: CycleView[];
  tasks: TaskView[];
  scores: ScoreRow[];
  unseenKisses: KissView[];
  kissStats: KissStats;
  owed: OwedView[];
  posts: Record<RoomType, PostView[]>;
  reactions: ReactionRow[];
  rounds: RevealRoundRow[];
  spotify: SpotifyView;
  vaultSealed: number;
}

const EMPTY: Data = {
  room: null,
  members: [],
  config: defaultConfig(),
  cycles: [],
  tasks: [],
  scores: [],
  unseenKisses: [],
  kissStats: { today: 0, all_time: 0 },
  owed: [],
  posts: { boast: [], confession: [], vault: [], jam: [] },
  reactions: [],
  rounds: [],
  spotify: { jamUrl: null, track: null, updatedBy: null },
  vaultSealed: 0,
};

export interface RoomCtx extends Data {
  backend: Backend;
  mode: Mode;
  phase: Phase;
  error: string | null;
  userId: string | null;
  roomId: string | null;
  key: CryptoKey | null;
  handshake: HandshakeState | null;
  me: MemberRow | null;
  partner: MemberRow | null;
  openCycle: CycleView | null;
  closedCycles: CycleView[];
  myTasks: TaskView[];
  partnerTasks: TaskView[];
  names: { me: string; partner: string; meAvatar: string; partnerAvatar: string };
  cozyMode: boolean;
  /** Re-run the boot sequence (after sign-in, pairing, demo switch). */
  reboot(): void;
  refresh(tables?: ChangeTable[]): Promise<void>;
  /** Encrypt a value for this room. `kind` becomes part of the AAD. */
  seal(kind: string, value: string | object): Promise<Sealed>;
  saveConfig(patch: Partial<RoomConfig>, extra?: RoomUpdate): Promise<void>;
  /** Run a write with a friendly error toast, then ping the partner to refresh. */
  run<T>(fn: () => Promise<T>, touched?: ChangeTable[]): Promise<T | undefined>;
  broadcast(e: BroadcastEvent): void;
  onBroadcast(cb: (e: BroadcastEvent) => void): () => void;
}

const Ctx = createContext<RoomCtx | null>(null);

export const aad = {
  config: (r: string) => aadFor(r, "config"),
  task: (r: string, user: string) => aadFor(r, `task.title:${user}`),
  post: (r: string, type: RoomType, author: string) => aadFor(r, `post:${type}:${author}`),
  kiss: (r: string, from: string) => aadFor(r, `kiss:${from}`),
  dare: (r: string, cycle: string) => aadFor(r, `dare:${cycle}`),
  jam: (r: string) => aadFor(r, "spotify.jam"),
  track: (r: string) => aadFor(r, "spotify.track"),
};

async function tryText(key: CryptoKey, s: Sealed, a: string): Promise<string | null> {
  try {
    return await decryptText(key, s, a);
  } catch {
    return null;
  }
}

const TABLE_SLICES: Record<ChangeTable, (keyof Data)[]> = {
  rooms: ["room", "config", "vaultSealed", "posts"],
  members: ["members"],
  daily_cycles: ["cycles", "tasks", "scores", "kissStats"],
  cycle_scores: ["scores"],
  tasks: ["tasks", "owed"],
  kisses: ["unseenKisses", "kissStats", "owed"],
  reveal_rounds: ["rounds", "posts"],
  room_posts: ["posts", "vaultSealed"],
  post_reactions: ["reactions"],
  spotify_sessions: ["spotify"],
};

export function RoomProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [bootId, setBootId] = useState(0);
  const [mode, setModeState] = useState<Mode>("live");
  const [backend, setBackend] = useState<Backend>(() => getBackend());
  const [phase, setPhase] = useState<Phase>("booting");
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [handshake, setHandshake] = useState<HandshakeState | null>(null);
  const [data, setData] = useState<Data>(EMPTY);
  const dataRef = useRef(data);
  dataRef.current = data;
  const broadcastListeners = useRef(new Set<(e: BroadcastEvent) => void>());

  const reboot = useCallback(() => setBootId((n) => n + 1), []);

  /* ------------------------------ boot ------------------------------- */
  useEffect(() => {
    let cancelled = false;
    consumeDemoParam();
    const b = getBackend();
    setBackend(b);
    setModeState(currentMode());
    setPhase("booting");
    setData(EMPTY);
    setKey(null);
    setRoomId(null);
    (async () => {
      try {
        const uid = await b.getUserId();
        if (cancelled) return;
        setUserId(uid);
        if (!uid) return setPhase("signed_out");
        const rid = await b.getMyRoomId();
        if (cancelled) return;
        if (!rid) return setPhase("no_room");
        setRoomId(rid);
        const [k, r] = await Promise.all([loadRoomKey(uid, rid), b.fetchRoom(rid)]);
        if (cancelled) return;
        // Ready only once the room is locked to two and this device holds the key.
        if (k && r?.is_locked) {
          setKey(k);
          setPhase("ready");
        } else {
          setPhase("pairing");
        }
      } catch (e) {
        if (!cancelled) {
          setError(friendlyError(e));
          setPhase("error");
        }
      }
    })();
    const off = b.onAuthChange(() => !cancelled && setBootId((n) => n + 1));
    return () => {
      cancelled = true;
      off();
    };
  }, [bootId]);

  /* ---------------------------- loaders ------------------------------ */
  const loadSlices = useCallback(
    async (slices: Set<keyof Data>) => {
      if (!backend || !roomId || !userId) return;
      const b = backend;
      const patch: Partial<Data> = {};
      const k = key;
      const jobs: Promise<void>[] = [];
      const cur = dataRef.current;

      if (slices.has("room") || slices.has("config")) {
        jobs.push(
          (async () => {
            const room = await b.fetchRoom(roomId);
            patch.room = room;
            if (room) applySeed(room.theme_seed_hex, cur.config.variant);
            if (room && k && room.encrypted_config && room.config_iv) {
              try {
                patch.config = sanitizeConfig(await decryptJSON(k, { ct: room.encrypted_config, iv: room.config_iv }, aad.config(roomId)));
                applySeed(room.theme_seed_hex, patch.config.variant);
              } catch {
                patch.config = cur.config;
              }
            }
          })(),
        );
      }
      const membersP = slices.has("members") || slices.has("owed") ? b.fetchMembers(roomId) : null;
      if (membersP) jobs.push(membersP.then((m) => void (patch.members = m)));
      // Cycles first (tasks/scores depend on the open cycle).
      let cyclesP: Promise<CycleView[]> | null = null;
      if (slices.has("cycles") || slices.has("tasks") || slices.has("scores")) {
        cyclesP = b.fetchCycles(roomId).then(async (rows) => {
          const out: CycleView[] = [];
          for (const c of rows) {
            const dare = k && c.dare_selected_encrypted && c.dare_iv ? await tryText(k, { ct: c.dare_selected_encrypted, iv: c.dare_iv }, aad.dare(roomId, c.id)) : null;
            out.push({ ...c, dare });
          }
          patch.cycles = out;
          return out;
        });
        jobs.push(cyclesP.then(() => undefined));
      }
      if (cyclesP && (slices.has("tasks") || slices.has("scores") || slices.has("cycles"))) {
        jobs.push(
          cyclesP.then(async (cycles) => {
            const open = cycles.find((c) => c.status !== "closed");
            if (!open) {
              patch.tasks = [];
              patch.scores = [];
              return;
            }
            const [tasks, scores] = await Promise.all([b.fetchTasks(roomId, open.id), b.fetchScores(roomId, open.id)]);
            patch.scores = scores;
            patch.tasks = await Promise.all(
              tasks.map(async (t) => ({ ...t, isCompleted: t.is_completed, title: (k && (await tryText(k, { ct: t.encrypted_title, iv: t.iv }, aad.task(roomId, t.user_id)))) || "🔒 Couldn't decrypt" })),
            );
          }),
        );
      }
      if (slices.has("owed")) {
        jobs.push(
          b.fetchOwed().then(async (rows) => {
            const members = membersP ? await membersP : cur.members;
            const partnerId = members.find((m) => m.user_id !== userId)?.user_id ?? "";
            patch.owed = await Promise.all(
              rows.map(async (o) => ({ ...o, title: (k && (await tryText(k, { ct: o.encrypted_title, iv: o.iv }, aad.task(roomId, partnerId)))) || "a task" })),
            );
          }),
        );
      }
      if (slices.has("unseenKisses")) {
        jobs.push(
          b.fetchUnseenKisses(userId).then(async (rows) => {
            const taskIds = rows.map((r) => r.trigger_task_id).filter((x): x is string => Boolean(x));
            const tasks = taskIds.length ? await b.fetchTasksByIds(taskIds) : [];
            patch.unseenKisses = await Promise.all(
              rows.map(async (r) => {
                const t = tasks.find((x) => x.id === r.trigger_task_id);
                return {
                  ...r,
                  note: k && r.encrypted_note && r.iv ? await tryText(k, { ct: r.encrypted_note, iv: r.iv }, aad.kiss(roomId, r.from_user_id)) : null,
                  taskTitle: k && t ? await tryText(k, { ct: t.encrypted_title, iv: t.iv }, aad.task(roomId, t.user_id)) : null,
                };
              }),
            );
          }),
        );
      }
      if (slices.has("kissStats")) jobs.push(b.fetchKissStats().then((s) => void (patch.kissStats = s)));
      if (slices.has("posts")) {
        jobs.push(
          (async () => {
            const types: RoomType[] = ["boast", "confession", "vault", "jam"];
            const all = await Promise.all(types.map((t) => b.fetchPosts(roomId, t)));
            const posts = { ...EMPTY.posts };
            for (let i = 0; i < types.length; i++) {
              posts[types[i]] = await Promise.all(
                all[i].map(async (p) => {
                  try {
                    if (!k) throw new Error("no key");
                    const payload = sanitizePayload(await decryptJSON(k, { ct: p.encrypted_payload, iv: p.iv }, aad.post(roomId, p.room_type, p.author_id)));
                    return { ...p, payload, broken: false };
                  } catch {
                    return { ...p, payload: {}, broken: true };
                  }
                }),
              );
            }
            patch.posts = posts;
          })(),
        );
      }
      if (slices.has("reactions")) jobs.push(b.fetchReactions(roomId).then((r) => void (patch.reactions = r)));
      if (slices.has("rounds")) jobs.push(b.fetchRounds(roomId).then((r) => void (patch.rounds = r)));
      if (slices.has("vaultSealed")) jobs.push(b.fetchVaultSealedCount().then((n) => void (patch.vaultSealed = n)));
      if (slices.has("spotify")) {
        jobs.push(
          b.fetchSpotify(roomId).then(async (s) => {
            let jamUrl: string | null = null;
            let track: TrackMeta | null = null;
            if (s && k) {
              if (s.jam_url_encrypted && s.jam_iv) jamUrl = safeSpotifyUrl((await tryText(k, { ct: s.jam_url_encrypted, iv: s.jam_iv }, aad.jam(roomId))) ?? "");
              if (s.current_track_encrypted && s.track_iv) {
                try {
                  const t = await decryptJSON<TrackMeta>(k, { ct: s.current_track_encrypted, iv: s.track_iv }, aad.track(roomId));
                  track = { ...t, albumArt: safeArtUrl(t.albumArt), uri: typeof t.uri === "string" && t.uri.startsWith("spotify:") ? t.uri : null };
                } catch {
                  track = null;
                }
              }
            }
            patch.spotify = { jamUrl, track, updatedBy: s?.updated_by ?? null };
          }),
        );
      }
      try {
        await Promise.all(jobs);
      } catch (e) {
        console.warn("refresh failed", friendlyError(e));
      }
      setData((d) => ({ ...d, ...patch }));
    },
    [backend, roomId, userId, key],
  );

  const pending = useRef(new Set<keyof Data>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(
    (tables?: ChangeTable[]) => {
      const list = tables ?? [...CHANGE_TABLES];
      for (const t of list) for (const s of TABLE_SLICES[t]) pending.current.add(s);
      return new Promise<void>((resolve) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
          const s = new Set(pending.current);
          pending.current.clear();
          await loadSlices(s);
          resolve();
        }, 40);
      });
    },
    [loadSlices],
  );

  /* ------------------ pairing handshake + first load ------------------ */
  useEffect(() => {
    if (!backend || !roomId || !userId) return;
    if (phase === "pairing") {
      let alive = true;
      const tick = async () => {
        try {
          const room = await backend.fetchRoom(roomId);
          const members = await backend.fetchMembers(roomId);
          if (!room) {
            if (alive) reboot();
            return;
          }
          setData((d) => ({ ...d, room, members }));
          const st = await advanceHandshake(backend, userId, room, members);
          if (!alive) return;
          setHandshake(st);
          const k = await loadRoomKey(userId, roomId);
          if (k && (st.step === "done" || st.step === "waiting_for_confirm")) {
            setKey(k);
            if (st.step === "done") setPhase("ready");
          }
        } catch (e) {
          if (alive) setHandshake({ step: "failed", reason: friendlyError(e) });
        }
      };
      void tick();
      const off = backend.subscribe(roomId, { onChange: () => void tick(), onBroadcast: () => {} });
      const poll = setInterval(tick, 4000);
      return () => {
        alive = false;
        off();
        clearInterval(poll);
      };
    }
  }, [backend, roomId, userId, phase, reboot]);

  // Creator with key but partner hasn't opened the envelope yet: still show the
  // room (they can start adding tasks) once the partner has joined.
  useEffect(() => {
    if (phase === "pairing" && key && handshake?.step === "waiting_for_confirm") setPhase("ready");
  }, [phase, key, handshake]);

  useEffect(() => {
    if (phase !== "ready" || !backend || !roomId) return;
    void refresh();
    const off = backend.subscribe(roomId, {
      onChange: (tables) => void refresh(tables),
      onBroadcast: (e) => {
        if (e.type === "refresh") void refresh(e.tables);
        if (e.type === "vault_drop") void refresh(["room_posts"]);
        if (e.type === "kiss_sent") void refresh(["kisses"]);
        for (const l of broadcastListeners.current) l(e);
      },
    });
    // Belt and braces for missed realtime events (e.g. mobile sleeping).
    const poll = setInterval(() => void refresh(), 30_000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [phase, backend, roomId, refresh]);

  // App reopen / focus / back from background: check unseen kisses right away.
  useEffect(() => {
    if (phase !== "ready") return;
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh(["kisses", "daily_cycles", "members", "room_posts"]);
    };
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [phase, refresh]);

  // Heartbeat: last_seen_at.
  useEffect(() => {
    if (phase !== "ready" || !backend || !userId) return;
    const beat = () => void backend.updateMyMember(userId, { last_seen_at: new Date().toISOString() }).catch(() => {});
    beat();
    const id = setInterval(beat, 60_000);
    return () => clearInterval(id);
  }, [phase, backend, userId]);

  /* ---------------------------- derived ------------------------------- */
  const me = data.members.find((m) => m.user_id === userId) ?? null;
  const partner = data.members.find((m) => m.user_id !== userId) ?? null;
  const openCycle = data.cycles.find((c) => c.status !== "closed") ?? null;
  const closedCycles = useMemo(() => data.cycles.filter((c) => c.status === "closed"), [data.cycles]);
  const myTasks = useMemo(() => data.tasks.filter((t) => t.user_id === userId), [data.tasks, userId]);
  const partnerTasks = useMemo(() => data.tasks.filter((t) => t.user_id !== userId), [data.tasks, userId]);
  const names = useMemo(
    () => ({
      // What I call my partner, and what my partner calls me.
      partner: (userId && data.config.petNames[userId]) || "Partner",
      me: (partner && data.config.petNames[partner.user_id]) || "You",
      // Defaults: the room's creator is the fox, the partner who joined is the bear.
      meAvatar: (userId && data.config.avatars[userId]) || (data.room?.created_by === userId ? "🦊" : "🐻"),
      partnerAvatar: (partner && data.config.avatars[partner.user_id]) || (data.room?.created_by === partner?.user_id ? "🦊" : "🐻"),
    }),
    [data.config, data.room?.created_by, userId, partner],
  );
  const cozyMode = Boolean(me && partner && Math.min(me.battery_level, partner.battery_level) <= 2);

  /* ------------------------ partner event toasts ----------------------- */
  const prev = useRef<{ partnerDone: Set<string>; battery: number | null; decomp: string | null; nudged: string | null; closed: number; daresSet: number } | null>(null);
  useEffect(() => {
    if (phase !== "ready" || !partner) return;
    const done = new Set(partnerTasks.filter((t) => t.is_completed).map((t) => t.id));
    const closed = closedCycles.length;
    const daresSet = closedCycles.filter((c) => c.dare).length;
    const p = prev.current;
    if (p) {
      for (const t of partnerTasks) {
        if (t.is_completed && !p.partnerDone.has(t.id)) {
          toast.show({ icon: "💋", tone: "love", text: `You owe ${names.partner} 1 kiss for finishing "${t.title}"!` }, 6000);
          vibrate([30, 40, 30]);
          sounds.pop();
          localNotify("USMODE", `You owe ${names.partner} a kiss 💋`);
        }
      }
      if (p.battery !== null && p.battery > 2 && partner.battery_level <= 2) {
        toast.show({ icon: "🪫", text: `${names.partner}'s battery is low. Tonight's hangout is now Cozy Mode: no pressure.` }, 7000);
      }
      if (p.decomp && partner.decompression_ends_at !== p.decomp && partner.status_code !== "decompressing") {
        toast.show({ icon: "🌙", text: `${names.partner} is recharged and ready.` });
        localNotify("USMODE", `${names.partner} is ready 💛`);
      }
      if (openCycle?.eod_nudged_at && openCycle.eod_nudged_at !== p.nudged && openCycle.eod_proposed_by === partner.user_id) {
        toast.show({ icon: "👉", text: `${names.partner} is nudging you to wrap up the day.` });
        vibrate(60);
      }
      if (closed > p.closed) {
        const last = closedCycles[0];
        const msg = !last.winner_user_id ? "Day locked: it's a draw." : last.winner_user_id === userId ? "Day locked. You won today! 👑" : `Day locked. ${names.partner} won today.`;
        toast.show({ icon: "🔒", text: msg }, 6000);
      }
      if (daresSet > p.daresSet) toast.show({ icon: "🎡", text: "The dare wheel has spoken. Check Backchodi." });
    }
    prev.current = {
      partnerDone: done,
      battery: partner.battery_level,
      decomp: partner.status_code === "decompressing" ? partner.decompression_ends_at : null,
      nudged: openCycle?.eod_nudged_at ?? null,
      closed,
      daresSet,
    };
  }, [phase, partner, partnerTasks, closedCycles, openCycle, names.partner, userId, toast]);

  // My own decompression timer ends → back to Free.
  useEffect(() => {
    if (!me || !backend || !userId || me.status_code !== "decompressing" || !me.decompression_ends_at) return;
    const ms = Date.parse(me.decompression_ends_at) - Date.now();
    const t = setTimeout(
      () => {
        void backend.updateMyMember(userId, { status_code: "free", decompression_ends_at: null }).then(() => refresh(["members"]));
        toast.show({ icon: "✨", text: "Decompression done. Your partner's been told you're ready." });
        sounds.chime();
      },
      Math.max(0, ms),
    );
    return () => clearTimeout(t);
  }, [me, backend, userId, refresh, toast]);

  /* ---------------------------- actions ------------------------------- */
  const seal = useCallback(
    async (kind: string, value: string | object): Promise<Sealed> => {
      if (!key) throw new Error("This device doesn't have the room key yet.");
      return typeof value === "string" ? encryptText(key, value, kind) : encryptJSON(key, value, kind);
    },
    [key],
  );

  const broadcast = useCallback(
    (e: BroadcastEvent) => {
      if (backend && roomId) void backend.broadcast(roomId, e).catch(() => {});
    },
    [backend, roomId],
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, touched?: ChangeTable[]): Promise<T | undefined> => {
      try {
        const out = await fn();
        if (touched?.length) {
          await refresh(touched);
          broadcast({ type: "refresh", tables: touched });
        }
        return out;
      } catch (e) {
        toast.show({ icon: "⚠️", tone: "error", text: friendlyError(e) });
        return undefined;
      }
    },
    [refresh, broadcast, toast],
  );

  const saveConfig = useCallback(
    async (patch: Partial<RoomConfig>, extra: RoomUpdate = {}) => {
      if (!backend || !roomId) return;
      const next = sanitizeConfig({ ...dataRef.current.config, ...patch });
      const sealed = await seal(aad.config(roomId), next);
      await run(() => backend.updateRoom(roomId, { encrypted_config: sealed.ct, config_iv: sealed.iv, ...extra }), ["rooms"]);
    },
    [backend, roomId, seal, run],
  );

  const onBroadcast = useCallback((cb: (e: BroadcastEvent) => void) => {
    broadcastListeners.current.add(cb);
    return () => {
      broadcastListeners.current.delete(cb);
    };
  }, []);

  const value: RoomCtx = {
        ...data,
        backend,
        mode,
        phase,
        error,
        userId,
        roomId,
        key,
        handshake,
        me,
        partner,
        openCycle,
        closedCycles,
        myTasks,
        partnerTasks,
        names,
        cozyMode,
        reboot,
        refresh,
        seal,
        saveConfig,
        run,
        broadcast,
        onBroadcast,
      };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoom(): RoomCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRoom outside RoomProvider");
  return c;
}
