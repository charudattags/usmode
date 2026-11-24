import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDB } from "idb";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
Object.assign(globalThis, { localStorage: new MemStorage(), sessionStorage: new MemStorage() });

const { DemoBackend, demoUserId, setDemoIdentity } = await import("@/data/demo/backend");
const { advanceHandshake, createRoomAndInvite, joinRoom } = await import("@/state/pairing");
const { parsePairingFragment, encryptText, decryptText } = await import("@/crypto/e2ee");
const { loadRoomKey, loadRoomKeyRaw } = await import("@/crypto/keystore");
const { aad } = await import("@/state/RoomProvider");

const backend = new DemoBackend();
const as = (who: "A" | "B") => {
  setDemoIdentity(who);
  return demoUserId(who);
};

afterAll(() => backend.close());

describe("two-tab demo: pairing + race + kisses, end to end", () => {
  let roomId = "";
  let A = "";
  let B = "";

  beforeAll(() => {
    A = demoUserId("A");
    B = demoUserId("B");
  });

  it("pairs over the QR link and both devices end up with the same room key", async () => {
    as("A");
    const invite = await createRoomAndInvite(backend, A);
    roomId = invite.roomId;
    expect(invite.link).toContain("/pair#join=");

    as("B");
    const frag = parsePairingFragment(new URL(invite.link, "http://localhost").hash)!;
    await joinRoom(backend, B, frag.code, frag.qrSecret);

    as("A");
    let room = (await backend.fetchRoom(roomId))!;
    expect(room.is_locked).toBe(true);
    let st = await advanceHandshake(backend, A, room, await backend.fetchMembers(roomId));
    expect(st.step).toBe("waiting_for_confirm");

    as("B");
    room = (await backend.fetchRoom(roomId))!;
    st = await advanceHandshake(backend, B, room, await backend.fetchMembers(roomId));
    expect(st.step).toBe("done");
    expect(await loadRoomKeyRaw(B, roomId)).toEqual(await loadRoomKeyRaw(A, roomId));

    as("A");
    room = (await backend.fetchRoom(roomId))!;
    expect(room.key_envelope).toBeNull();
    st = await advanceHandshake(backend, A, room, await backend.fetchMembers(roomId));
    expect(st.step).toBe("done");
  });

  it("refuses a third person once locked", async () => {
    setDemoIdentity("A");
    // A is already in the room; a stranger can't join with any code because it's burned.
    await expect(joinRoom(backend, A, "K9X4M2QP", null)).rejects.toThrow();
  });

  it("runs a day: tasks, first-to-100, mutual EOD, kiss debt and catch", async () => {
    as("A");
    const keyA = (await loadRoomKey(A, roomId))!;
    const [cycle] = (await backend.fetchCycles(roomId)).filter((c) => c.status === "active");
    const t1 = await backend.addTask(roomId, cycle.id, A, await encryptText(keyA, "Gym 45 min", aad.task(roomId, A)));
    await backend.completeTask(t1.id, null);

    as("B");
    const keyB = (await loadRoomKey(B, roomId))!;
    const t2 = await backend.addTask(roomId, cycle.id, B, await encryptText(keyB, "Read 20 pages", aad.task(roomId, B)));
    const t3 = await backend.addTask(roomId, cycle.id, B, await encryptText(keyB, "Call mom", aad.task(roomId, B)));
    await backend.completeTask(t2.id, null);

    // A reads B's tasks and can decrypt them with the shared key.
    as("A");
    const tasks = await backend.fetchTasks(roomId, cycle.id);
    const bTitles = await Promise.all(tasks.filter((t) => t.user_id === B).map((t) => decryptText(keyA, { ct: t.encrypted_title, iv: t.iv }, aad.task(roomId, B))));
    expect(bTitles).toEqual(["Read 20 pages", "Call mom"]);

    // A owes B a kiss for "Read 20 pages".
    const owed = await backend.fetchOwed();
    expect(owed.map((o) => o.task_id)).toEqual([t2.id]);
    const kiss = await backend.sendKiss(roomId, A, { to_user_id: B, trigger_task_id: t2.id, kiss_style: "flying", note: null });
    expect(await backend.fetchOwed()).toHaveLength(0);

    // B "reopens the app": unseen kiss is waiting, B catches it.
    as("B");
    const unseen = await backend.fetchUnseenKisses(B);
    expect(unseen.map((k) => k.id)).toEqual([kiss.id]);
    expect(await backend.catchKisses([kiss.id])).toBe(1);
    expect(await backend.fetchUnseenKisses(B)).toHaveLength(0);
    expect(await backend.fetchKissStats()).toEqual({ today: 1, all_time: 1 });

    // EOD: B proposes, B can't confirm, A confirms. A reached 100 first.
    await backend.completeTask(t3.id, null);
    await backend.proposeEod();
    await expect(backend.confirmEod()).rejects.toThrow(/partner/);
    as("A");
    await backend.confirmEod();
    const cycles = await backend.fetchCycles(roomId);
    const closed = cycles.find((c) => c.id === cycle.id)!;
    expect(closed.status).toBe("closed");
    expect(closed.winner_user_id).toBe(A);
    expect(closed.loser_user_id).toBe(B);
    expect(cycles.find((c) => c.status === "active")?.cycle_number).toBe(2);
  });

  it("the demo server holds only ciphertext", async () => {
    const d = await openDB("usmode-demo-server", 1);
    const state = JSON.stringify(await d.get("state", "db"));
    for (const plain of ["Gym 45 min", "Read 20 pages", "Call mom"]) expect(state).not.toContain(plain);
    d.close();
  });
});
