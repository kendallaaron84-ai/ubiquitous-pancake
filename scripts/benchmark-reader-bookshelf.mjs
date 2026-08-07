import { sha256Id } from "../core/security/reader-contracts/index.ts";
import { loadReaderBookshelfPageData } from "../core/security/reader-bookshelf-loader.ts";
import { createMemoryDb } from "../core/security/__tests__/reader-platform-test-harness.mjs";

const SIZES = [0, 1, 10, 25, 50];
const SESSION_ID = "a".repeat(64);
const SESSION_TOKEN = "reader_session_benchmark_token_1234567890";
const COOKIE = { sessionId: SESSION_ID, token: SESSION_TOKEN };

const PROFILES = {
  cold: {
    documentGet: 40,
    documentWrite: 35,
    queryGet: 50,
    batchGet: 60,
  },
  warm: {
    documentGet: 10,
    documentWrite: 8,
    queryGet: 14,
    batchGet: 18,
  },
};

function seedFor(publicationCount) {
  const seed = {
    "reader_profiles/benchmark_reader": {
      accountStatus: "active",
      email: "benchmark@example.com",
      emailNormalized: "benchmark@example.com",
      emailVerified: true,
      displayName: "Benchmark Reader",
    },
    [`reader_sessions/${SESSION_ID}`]: {
      readerUid: "benchmark_reader",
      status: "active",
      tokenDigest: sha256Id("reader-session-token", SESSION_TOKEN),
      expiresAt: { toDate: () => new Date("2099-01-01T00:00:00.000Z") },
    },
  };
  for (let index = 1; index <= publicationCount; index += 1) {
    const assetId = `abk_benchmark_${String(index).padStart(2, "0")}`;
    seed[`reader_entitlements/entitlement_${index}`] = {
      readerUid: "benchmark_reader",
      tenantId: "benchmark_studio",
      assetId,
      status: "active",
    };
    seed[`products/${assetId}`] = {
      title: `Benchmark Book ${index}`,
      authorName: "Benchmark Author",
      studioKey: "benchmark_studio",
      type: "audiobook",
      status: "published",
      wordpressDeployment: {
        status: "deployed",
        publicationUrl: `https://author.example/books/${assetId}/`,
      },
    };
  }
  return seed;
}

function roundedAverage(values) {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

async function measure(profileName, publicationCount) {
  const samples = [];
  const sampleCount = profileName === "cold" ? 1 : 5;
  for (let index = 0; index < sampleCount; index += 1) {
    const db = createMemoryDb(seedFor(publicationCount), {
      latencyMs: PROFILES[profileName],
    });
    const result = await loadReaderBookshelfPageData(db, COOKIE);
    samples.push({ result, metrics: db.metrics });
  }
  const first = samples[0];
  return {
    request: profileName,
    publications: publicationCount,
    sessionValidationMs: roundedAverage(
      samples.map(({ result }) => result.timings.sessionValidationMs)
    ),
    entitlementQueryMs: roundedAverage(
      samples.map(({ result }) => result.timings.entitlementQueryMs)
    ),
    productMetadataJoinMs: roundedAverage(
      samples.map(({ result }) => result.timings.productMetadataJoinMs)
    ),
    totalServerRenderMs: roundedAverage(
      samples.map(({ result }) => result.timings.totalServerRenderMs)
    ),
    metadataBatchRpcCount: first.metrics.batchGets,
    metadataDocuments: first.metrics.batchDocuments,
    returnedPublications: first.result.publications.length,
  };
}

const results = [];
for (const request of ["cold", "warm"]) {
  for (const size of SIZES) {
    results.push(await measure(request, size));
  }
}

console.log(JSON.stringify({
  methodology: {
    kind: "controlled local service benchmark with simulated Firestore latency",
    coldLatencyMs: PROFILES.cold,
    warmLatencyMs: PROFILES.warm,
    warmSamplesPerSize: 5,
    note: "Total server render measures authenticated server data loading and safe-projection preparation; it excludes network transfer and browser hydration.",
  },
  results,
}, null, 2));
