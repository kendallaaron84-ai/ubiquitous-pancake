import { getFirebaseAdminServices } from "../core/firebase-admin.ts";
import { inventoryReaderMediaStorage, summarizeReaderMediaStorage } from "../core/security/reader-media-storage-inventory.ts";

try {
  const snapshot = await getFirebaseAdminServices().db.collection("products").get();
  const items = inventoryReaderMediaStorage(snapshot.docs.map((document) => ({ id: document.id, data: document.data() })));
  const report = { generatedAt: new Date().toISOString(), mode: "read_only", summary: summarizeReaderMediaStorage(items), items };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  process.stderr.write(`Reader media inventory could not authenticate to Firestore (code ${code}). No data was changed.\n`);
  process.exitCode = 1;
}
