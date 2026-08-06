import type { Firestore } from "firebase-admin/firestore";

export async function resolveStrategySourceVersions(db: Firestore, ids: Array<string | null>): Promise<Record<string, number>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const snapshots = await Promise.all(unique.map((id) => db.collection("nexus_strategy_guides").doc(id).get()));
  return Object.fromEntries(snapshots.map((snapshot) => {
    const data = snapshot.data() || {};
    return [snapshot.id, data.status === "active" && Number.isInteger(data.activeVersion) ? Number(data.activeVersion) : 0];
  }));
}
