import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  persistPluginWebsiteMetadata,
  persistVerifiedPluginWebsite,
} from "../plugin-site-grant-persistence.ts";
import { listNexusWebsiteConnections } from "../../nexus/website-connections.ts";

const studioKey = "KOBA-AUDIO-E63DC9CA";
const authorId = "author-1";
const actorEmail = "kendall.aaron@koba-i.com";
const projectId = "author-jubilee-command-center";
const licensePath = `plugin_licenses/${studioKey}`;
const rootConnectionPath = `connections/${studioKey}`;

class FakeDocumentReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
    this.id = path.split("/").at(-1);
  }
  collection(name) {
    return new FakeCollectionReference(this.database, `${this.path}/${name}`);
  }
  async get() {
    return snapshot(this, this.database.documents.get(this.path));
  }
}

class FakeCollectionReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }
  doc(id) {
    return new FakeDocumentReference(this.database, `${this.path}/${id}`);
  }
  async get() {
    const prefix = `${this.path}/`;
    return {
      docs: [...this.database.documents.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
        .map(([path, data]) => snapshot(new FakeDocumentReference(this.database, path), data)),
    };
  }
}

class FakeFirestore {
  constructor(initial = {}, failPaths = []) {
    this.documents = new Map(Object.entries(initial));
    this.failPaths = new Set(failPaths);
  }
  collection(name) {
    return new FakeCollectionReference(this, name);
  }
  async runTransaction(callback) {
    const operations = [];
    const transaction = {
      get: async (reference) => {
        if (reference instanceof FakeCollectionReference) {
          const prefix = `${reference.path}/`;
          const docs = [...this.documents.entries()]
            .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
            .map(([path, data]) => snapshot(new FakeDocumentReference(this, path), data));
          return { docs };
        }
        return snapshot(reference, this.documents.get(reference.path));
      },
      set: (reference, data, options) => operations.push({ kind: "set", reference, data, options }),
      update: (reference, data) => operations.push({ kind: "update", reference, data }),
      create: (reference, data) => operations.push({ kind: "create", reference, data }),
    };
    const result = await callback(transaction);
    for (const operation of operations) {
      if (this.failPaths.has(operation.reference.path)) {
        throw new Error(`Injected write failure: ${operation.reference.path}`);
      }
      if (operation.kind === "create" && this.documents.has(operation.reference.path)) {
        throw new Error(`Document already exists: ${operation.reference.path}`);
      }
      if (operation.kind === "update" && !this.documents.has(operation.reference.path)) {
        throw new Error(`Document does not exist: ${operation.reference.path}`);
      }
    }
    const next = new Map(this.documents);
    for (const operation of operations) {
      const current = next.get(operation.reference.path) || {};
      const value = operation.kind === "set" && !operation.options?.merge
        ? operation.data
        : { ...current, ...operation.data };
      next.set(operation.reference.path, value);
    }
    this.documents = next;
    return result;
  }
  get(path) {
    return this.documents.get(path);
  }
  auditEvents() {
    const prefix = `${licensePath}/site_authorization_audit/`;
    return [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([, data]) => data);
  }
}

function snapshot(reference, data) {
  return {
    id: reference.id,
    ref: reference,
    exists: data !== undefined,
    data: () => data,
  };
}

function activeLicense(overrides = {}) {
  return {
    studioKey,
    authorId,
    authorEmail: actorEmail,
    firebaseProjectId: projectId,
    status: "active",
    ...overrides,
  };
}

function connection(id, origin, role, overrides = {}) {
  return {
    studioKey,
    authorId,
    websiteConnectionId: id,
    displayName: id,
    targetWpOrigin: origin,
    wpUsername: "wordpress-author",
    secretCredentialRef: `projects/400566266819/secrets/WP_CREDS_${studioKey}_${id}/versions/latest`,
    contentRole: role,
    defaultUniverseId: null,
    status: "active",
    verificationStatus: "verified",
    verifiedAt: "2026-08-06T12:00:00.000Z",
    createdAt: "2026-08-06T12:00:00.000Z",
    updatedAt: "2026-08-06T12:00:00.000Z",
    ...overrides,
  };
}

function verifiedInput(overrides = {}) {
  return {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    wordpressOrigin: "https://audio.koba-i.com",
    wordpressUsername: "wordpress-author",
    secretCredentialRef: `projects/400566266819/secrets/WP_CREDS_${studioKey}/versions/latest`,
    contentRole: "business_brand",
    displayName: "KOBA-I Audio",
    defaultUniverseId: null,
    ...overrides,
  };
}

let auditSequence = 0;

function options() {
  return {
    now: "2026-08-06T13:00:00.000Z",
    auditId: () => `audit-${++auditSequence}`,
  };
}

test("first site authorization atomically writes the connection, grant, and audit", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  const result = await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  assert.equal(database.get(rootConnectionPath).targetWpOrigin, "https://audio.koba-i.com");
  assert.equal(database.get(licensePath).authorizedSites.length, 1);
  assert.equal(result.grant.websiteConnectionId, "primary");
  assert.equal(database.auditEvents()[0].action, "site_authorization");
});

test("a second specialized site preserves and authorizes the first site", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  const result = await persistVerifiedPluginWebsite(database, verifiedInput({
    websiteConnectionId: "site-duncan",
    wordpressOrigin: "https://duncan-hunter.koba-i.com",
    contentRole: "story_world",
    displayName: "Duncan Hunter",
  }), options());
  assert.deepEqual(
    result.authorizedSites.filter((site) => site.status === "active").map((site) => site.origin).sort(),
    ["https://audio.koba-i.com", "https://duncan-hunter.koba-i.com"]
  );
});

test("repeated verification updates one exact grant and creates no duplicate audit", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  const auditCount = database.auditEvents().length;
  const result = await persistVerifiedPluginWebsite(database, verifiedInput({
    wordpressOrigin: "https://AUDIO.KOBA-I.COM/path",
  }), options());
  assert.equal(result.authorizedSites.length, 1);
  assert.equal(database.auditEvents().length, auditCount);
});

test("verification failure occurs before persistence and writes nothing", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  const before = JSON.stringify([...database.documents]);
  const route = await readFile(new URL("../../../app/api/connections/verify/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("verifyAndProvisionWordPressConnection") < route.indexOf("persistVerifiedPluginWebsite"));
  await assert.rejects(async () => {
    throw new Error("simulated WordPress verification failure");
  });
  assert.equal(JSON.stringify([...database.documents]), before);
});

test("connection write failure rolls back the license mutation", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() }, [rootConnectionPath]);
  await assert.rejects(() => persistVerifiedPluginWebsite(database, verifiedInput(), options()), /Injected write failure/);
  assert.equal(database.get(rootConnectionPath), undefined);
  assert.equal(database.get(licensePath).authorizedSites, undefined);
});

test("license write failure rolls back the connection mutation", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() }, [licensePath]);
  await assert.rejects(() => persistVerifiedPluginWebsite(database, verifiedInput(), options()), /Injected write failure/);
  assert.equal(database.get(rootConnectionPath), undefined);
  assert.equal(database.get(licensePath).authorizedSites, undefined);
});

test("a third verified site returns PLUGIN_SITE_LIMIT_REACHED", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  await persistVerifiedPluginWebsite(database, verifiedInput({
    websiteConnectionId: "site-duncan",
    wordpressOrigin: "https://duncan-hunter.koba-i.com",
    contentRole: "story_world",
  }), options());
  await assert.rejects(
    () => persistVerifiedPluginWebsite(database, verifiedInput({
      websiteConnectionId: "site-third",
      wordpressOrigin: "https://third.example.com",
      contentRole: "story_world",
    }), options()),
    (error) => error.status === 409 && error.code === "PLUGIN_SITE_LIMIT_REACHED"
  );
  assert.equal(database.get(licensePath).authorizedSites.length, 2);
});

test("a conflicting role change returns a stable 409 and rolls back", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  await persistVerifiedPluginWebsite(database, verifiedInput({
    websiteConnectionId: "site-duncan",
    wordpressOrigin: "https://duncan-hunter.koba-i.com",
    contentRole: "story_world",
  }), options());
  await assert.rejects(
    () => persistPluginWebsiteMetadata(database, {
      studioKey,
      authorId,
      actorEmail,
      firebaseProjectId: projectId,
      websiteConnectionId: "site-duncan",
      contentRole: "business_brand",
    }, options()),
    (error) => error.status === 409 && error.code === "PLUGIN_SITE_NOT_AUTHORIZED"
  );
  assert.equal(database.get(`${rootConnectionPath}/websites/site-duncan`).contentRole, "story_world");
});

test("legacy audio migration preserves associatedWebsite evidence and appends migration history", async () => {
  const legacyOrigin = "https://audio.koba-i.com";
  const database = new FakeFirestore({
    [licensePath]: activeLicense({ associatedWebsite: legacyOrigin }),
    [rootConnectionPath]: connection("primary", legacyOrigin, "business_brand"),
  });
  const result = await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  assert.equal(result.authorizedSites.length, 1);
  assert.equal(database.get(licensePath).associatedWebsite, legacyOrigin);
  assert.equal(database.auditEvents()[0].action, "legacy_migration");
});

test("disabling a site preserves a revoked grant and writes an append-only revocation event", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  const result = await persistPluginWebsiteMetadata(database, {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    status: "disabled",
  }, options());
  assert.equal(result.grant, null);
  assert.equal(result.authorizedSites[0].status, "revoked");
  assert.equal(database.auditEvents().at(-1).action, "revocation");
});

test("a valid role change writes an append-only role-change event", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput({ contentRole: "both" }), options());
  const result = await persistPluginWebsiteMetadata(database, {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    contentRole: "business_brand",
  }, options());
  assert.equal(result.grant.role, "business_brand");
  assert.equal(database.auditEvents().at(-1).action, "role_change");
});

test("replacement preserves the revoked grant and appends a replacement audit", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  await persistPluginWebsiteMetadata(database, {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    status: "disabled",
  }, options());
  const result = await persistVerifiedPluginWebsite(database, verifiedInput({
    websiteConnectionId: "site-replacement",
    wordpressOrigin: "https://replacement.example.com",
    contentRole: "business_brand",
  }), options());
  assert.equal(result.authorizedSites.some((site) => site.status === "revoked" && site.origin === "https://audio.koba-i.com"), true);
  assert.equal(result.authorizedSites.some((site) => site.status === "active" && site.origin === "https://replacement.example.com"), true);
  assert.equal(database.auditEvents().some((event) => event.action === "replacement"), true);
});

function productionLegacyAudio(overrides = {}) {
  return {
    studioKey,
    targetWpOrigin: "https://audio.koba-i.com",
    wpUsername: "kendall.aaron",
    secretCredentialRef: `projects/400566266819/secrets/WP_CREDS_${studioKey}/versions/latest`,
    status: "active",
    verificationStatus: "verified",
    verifiedAt: "2026-07-27T20:15:12.625Z",
    registeredBy: actorEmail,
    ...overrides,
  };
}

test("legacy primary connection renders with stable primary ID and reconciliation state", async () => {
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [rootConnectionPath]: productionLegacyAudio(),
  });
  const websites = await listNexusWebsiteConnections(database, studioKey, authorId);
  assert.equal(websites.length, 1);
  assert.equal(websites[0].websiteConnectionId, "primary");
  assert.equal(websites[0].persistenceStatus, "legacy_reconcilable");
});

test("rendered legacy Audio role reconciles and changes to business_brand atomically", async () => {
  const secretCredentialRef = `projects/400566266819/secrets/WP_CREDS_${studioKey}/versions/latest`;
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [rootConnectionPath]: productionLegacyAudio({ secretCredentialRef }),
  });
  const result = await persistPluginWebsiteMetadata(database, {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    expectedOrigin: "https://audio.koba-i.com",
    contentRole: "business_brand",
  }, options());
  assert.equal(result.reconciledLegacyConnection, true);
  assert.equal(result.grant.role, "business_brand");
  assert.equal(database.get(rootConnectionPath).authorId, authorId);
  assert.equal(database.get(rootConnectionPath).websiteConnectionId, "primary");
  assert.equal(database.get(rootConnectionPath).secretCredentialRef, secretCredentialRef);
});

test("Duncan remains visible after Audio legacy reconciliation", async () => {
  const duncanPath = `${rootConnectionPath}/websites/site_duncan`;
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [rootConnectionPath]: productionLegacyAudio(),
    [duncanPath]: connection(
      "site_duncan",
      "https://duncan-hunter.koba-i.com",
      "story_world"
    ),
  });
  await persistPluginWebsiteMetadata(database, {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    expectedOrigin: "https://audio.koba-i.com",
    contentRole: "business_brand",
  }, options());
  const websites = await listNexusWebsiteConnections(database, studioKey, authorId);
  assert.deepEqual(
    websites.map((website) => [website.wordpressOrigin, website.contentRole]),
    [
      ["https://audio.koba-i.com", "business_brand"],
      ["https://duncan-hunter.koba-i.com", "story_world"],
    ]
  );
});

test("a modern website document with a missing redundant ID is backfilled from its authoritative document ID", async () => {
  const duncanPath = `${rootConnectionPath}/websites/site_duncan`;
  const duncan = connection(
    "site_duncan",
    "https://duncan-hunter.koba-i.com",
    "story_world"
  );
  delete duncan.websiteConnectionId;
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [duncanPath]: duncan,
  });

  const rendered = await listNexusWebsiteConnections(database, studioKey, authorId);
  assert.equal(rendered[0].websiteConnectionId, "site_duncan");
  assert.equal(rendered[0].persistenceStatus, "legacy_reconcilable");

  const result = await persistPluginWebsiteMetadata(database, {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "site_duncan",
    expectedOrigin: "https://duncan-hunter.koba-i.com",
    contentRole: "story_world",
  }, options());
  assert.equal(result.reconciledLegacyConnection, true);
  assert.equal(database.get(duncanPath).websiteConnectionId, "site_duncan");
});

test("repeated legacy reconciliation is idempotent and creates no duplicate grant", async () => {
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [rootConnectionPath]: productionLegacyAudio(),
  });
  const input = {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    expectedOrigin: "https://audio.koba-i.com",
    contentRole: "business_brand",
  };
  await persistPluginWebsiteMetadata(database, input, options());
  const result = await persistPluginWebsiteMetadata(database, input, options());
  assert.equal(result.reconciledLegacyConnection, false);
  assert.equal(result.authorizedSites.filter((site) => site.status === "active").length, 1);
});

test("origin and connection ID mismatch fails closed with a stable code", async () => {
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [rootConnectionPath]: productionLegacyAudio(),
  });
  await assert.rejects(
    () => persistPluginWebsiteMetadata(database, {
      studioKey,
      authorId,
      actorEmail,
      firebaseProjectId: projectId,
      websiteConnectionId: "site_duncan",
      expectedOrigin: "https://audio.koba-i.com",
      contentRole: "story_world",
    }, options()),
    (error) => error.status === 409 && error.code === "WEBSITE_CONNECTION_ID_MISMATCH"
  );
});

test("missing legacy evidence does not fabricate a website connection", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await assert.rejects(
    () => persistPluginWebsiteMetadata(database, {
      studioKey,
      authorId,
      actorEmail,
      firebaseProjectId: projectId,
      websiteConnectionId: "site_missing",
      expectedOrigin: "https://missing.example.com",
      contentRole: "story_world",
    }, options()),
    (error) => error.status === 404 && error.code === "WEBSITE_CONNECTION_NOT_FOUND"
  );
  assert.equal(database.get(`${rootConnectionPath}/websites/site_missing`), undefined);
  assert.equal(database.get(licensePath).authorizedSites, undefined);
});

test("failed role update changes neither connection nor license grant", async () => {
  const database = new FakeFirestore({ [licensePath]: activeLicense() });
  await persistVerifiedPluginWebsite(database, verifiedInput(), options());
  await persistVerifiedPluginWebsite(database, verifiedInput({
    websiteConnectionId: "site_duncan",
    wordpressOrigin: "https://duncan-hunter.koba-i.com",
    contentRole: "story_world",
  }), options());
  const beforeConnection = structuredClone(database.get(rootConnectionPath));
  const beforeLicense = structuredClone(database.get(licensePath));
  await assert.rejects(
    () => persistPluginWebsiteMetadata(database, {
      studioKey,
      authorId,
      actorEmail,
      firebaseProjectId: projectId,
      websiteConnectionId: "primary",
      expectedOrigin: "https://audio.koba-i.com",
      contentRole: "story_world",
    }, options()),
    (error) => error.status === 409
  );
  assert.deepEqual(database.get(rootConnectionPath), beforeConnection);
  assert.deepEqual(database.get(licensePath), beforeLicense);
});

test("existing one-site both configuration remains valid after reconciliation", async () => {
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [rootConnectionPath]: productionLegacyAudio({ contentRole: "both" }),
  });
  const result = await persistPluginWebsiteMetadata(database, {
    studioKey,
    authorId,
    actorEmail,
    firebaseProjectId: projectId,
    websiteConnectionId: "primary",
    expectedOrigin: "https://audio.koba-i.com",
    displayName: "KOBA-I Audio",
  }, options());
  assert.equal(result.grant.role, "both");
  assert.equal(result.authorizedSites.length, 1);
});

test("stored ownership mismatch returns WEBSITE_CONNECTION_OWNERSHIP_MISMATCH", async () => {
  const database = new FakeFirestore({
    [licensePath]: activeLicense(),
    [rootConnectionPath]: productionLegacyAudio({ authorId: "different-author" }),
  });
  await assert.rejects(
    () => persistPluginWebsiteMetadata(database, {
      studioKey,
      authorId,
      actorEmail,
      firebaseProjectId: projectId,
      websiteConnectionId: "primary",
      expectedOrigin: "https://audio.koba-i.com",
      contentRole: "business_brand",
    }, options()),
    (error) => error.status === 409 && error.code === "WEBSITE_CONNECTION_OWNERSHIP_MISMATCH"
  );
});

test("authorized grant without a connection requires explicit legacy migration", async () => {
  const database = new FakeFirestore({
    [licensePath]: activeLicense({
      authorizedSites: [{
        websiteConnectionId: "site_duncan",
        origin: "https://duncan-hunter.koba-i.com",
        role: "story_world",
        status: "active",
      }],
    }),
  });
  await assert.rejects(
    () => persistPluginWebsiteMetadata(database, {
      studioKey,
      authorId,
      actorEmail,
      firebaseProjectId: projectId,
      websiteConnectionId: "site_duncan",
      expectedOrigin: "https://duncan-hunter.koba-i.com",
      contentRole: "story_world",
    }, options()),
    (error) => error.status === 409 && error.code === "WEBSITE_CONNECTION_LEGACY_MIGRATION_REQUIRED"
  );
});
