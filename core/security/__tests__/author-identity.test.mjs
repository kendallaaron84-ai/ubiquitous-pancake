import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  ensurePrimaryAuthorIdentity,
  loadAuthorIdentityRegistry,
  registerPenName,
  requireAuthorizedAuthorIdentity,
} from "../author-identity.ts"

class Snapshot {
  constructor(ref, value) { this.ref = ref; this.id = ref.id; this.value = value }
  get exists() { return this.value !== undefined }
  data() { return this.value }
}

class Ref {
  constructor(db, path) { this.db = db; this.path = path; this.id = path.split("/").at(-1) }
  collection(name) { return new Collection(this.db, `${this.path}/${name}`) }
  async get() { return new Snapshot(this, this.db.rows.get(this.path)) }
}

class Collection {
  constructor(db, path) { this.db = db; this.path = path }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`) }
  async get() {
    const prefix = `${this.path}/`
    const docs = [...this.db.rows.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, value]) => new Snapshot(new Ref(this.db, path), value))
    return { docs }
  }
}

class FakeDb {
  constructor(seed = {}) { this.rows = new Map(Object.entries(seed)) }
  collection(name) { return new Collection(this, name) }
  async runTransaction(callback) {
    return callback({
      get: async (ref) => ref.get(),
      create: (ref, value) => {
        if (this.rows.has(ref.path)) throw new Error("already exists")
        this.rows.set(ref.path, value)
      },
      set: (ref, value, options) => {
        const current = this.rows.get(ref.path) || {}
        this.rows.set(ref.path, options?.merge ? { ...current, ...value } : value)
      },
      update: (ref, value) => {
        if (!this.rows.has(ref.path)) throw new Error("missing")
        this.rows.set(ref.path, { ...this.rows.get(ref.path), ...value })
      },
    })
  }
}

const studioKey = "KOBA-AUDIO-TEST"
const email = "author@example.com"

function database() {
  return new FakeDb({
    [`plugin_licenses/${studioKey}`]: {
      status: "active",
      authorEmail: email,
      authorName: "Author Name",
    },
  })
}

test("seeds one deterministic primary identity for an active individual license", async () => {
  const db = database()
  const identity = await ensurePrimaryAuthorIdentity(db, studioKey, email)
  assert.equal(identity.id, "primary")
  assert.equal(identity.displayName, "Author Name")
  assert.equal(db.rows.get(`plugin_licenses/${studioKey}`).maxAuthorIdentities, 2)
  assert.equal(db.rows.get(`plugin_licenses/${studioKey}/author_identities/primary`).type, "primary")
})

test("loads the canonical primary identity repeatedly without creating duplicates", async () => {
  const db = database()
  const first = await loadAuthorIdentityRegistry(db, studioKey, email)
  const second = await loadAuthorIdentityRegistry(db, studioKey, email)

  assert.deepEqual(first.identities.map(({ id, displayName, type }) => ({ id, displayName, type })), [
    { id: "primary", displayName: "Author Name", type: "primary" },
  ])
  assert.deepEqual(second.identities, first.identities)
  assert.equal(
    [...db.rows.keys()].filter((path) => path === `plugin_licenses/${studioKey}/author_identities/primary`).length,
    1
  )
})

test("requires rights attestation before registering a pen name", async () => {
  await assert.rejects(
    registerPenName(database(), { studioKey, authorEmail: email, displayName: "A. Writer", rightsAttested: false }),
    (error) => error.code === "RIGHTS_ATTESTATION_REQUIRED"
  )
})

test("allows one pen name and rejects a third identity slot", async () => {
  const db = database()
  const identity = await registerPenName(db, { studioKey, authorEmail: email, displayName: "A. Writer", rightsAttested: true })
  assert.deepEqual(identity, {
    id: "pen-name",
    displayName: "A. Writer",
    normalizedName: "a. writer",
    type: "pen_name",
    status: "active",
  })
  await assert.rejects(
    registerPenName(db, { studioKey, authorEmail: email, displayName: "Another Name", rightsAttested: true }),
    (error) => error.code === "AUTHOR_IDENTITY_LIMIT_REACHED"
  )
})

test("authenticated MVP authors can use author identities while unrelated APIs remain restricted", async () => {
  const middleware = await readFile(new URL("../../../middleware.ts", import.meta.url), "utf8")
  const allowlistStart = middleware.indexOf("const MVP_API_EXACT_PATHS")
  const allowlistEnd = middleware.indexOf(");", allowlistStart)
  const allowlist = middleware.slice(allowlistStart, allowlistEnd)

  assert.ok(allowlistStart >= 0 && allowlistEnd > allowlistStart)
  assert.match(allowlist, /"\/api\/author-identities"/)
  assert.doesNotMatch(allowlist, /"\/api\/admin\/authors"/)
  assert.doesNotMatch(middleware, /MVP workspace|This API is not available/)
  assert.match(middleware, /This feature is not available for your account\./)
})

test("rejects identity IDs outside the primary and pen-name registry", async () => {
  await assert.rejects(
    requireAuthorizedAuthorIdentity(database(), studioKey, email, "publisher-author-3"),
    (error) => error.code === "AUTHOR_IDENTITY_NOT_AUTHORIZED"
  )
})
