import { FieldValue } from "firebase-admin/firestore"

export const INDIVIDUAL_AUTHOR_IDENTITY_LIMIT = 2
export const PRIMARY_AUTHOR_IDENTITY_ID = "primary"
export const PEN_NAME_IDENTITY_ID = "pen-name"

export type AuthorIdentityType = "primary" | "pen_name"

export interface AuthorIdentity {
  id: string
  displayName: string
  normalizedName: string
  type: AuthorIdentityType
  status: "active"
}

export class AuthorIdentityError extends Error {
  readonly status: number
  readonly code: string
  readonly publicMessage: string

  constructor(
    status: number,
    code: string,
    publicMessage: string
  ) {
    super(publicMessage)
    this.status = status
    this.code = code
    this.publicMessage = publicMessage
  }
}

export async function loadAuthorIdentityRegistry(
  database: FirebaseFirestore.Firestore,
  studioKey: string,
  authorEmail: string
): Promise<{ maxAuthorIdentities: number; identities: AuthorIdentity[] }> {
  await ensurePrimaryAuthorIdentity(database, studioKey, authorEmail)
  const snapshot = await database
    .collection("plugin_licenses")
    .doc(studioKey)
    .collection("author_identities")
    .get()

  const identities = snapshot.docs
    .map((document) => toAuthorIdentity(document.id, document.data()))
    .filter((identity): identity is AuthorIdentity => identity !== null)
    .sort((left, right) => left.type === "primary" ? -1 : right.type === "primary" ? 1 : 0)

  return { maxAuthorIdentities: INDIVIDUAL_AUTHOR_IDENTITY_LIMIT, identities }
}

export async function ensurePrimaryAuthorIdentity(
  database: FirebaseFirestore.Firestore,
  studioKeyInput: string,
  authorEmailInput: string
): Promise<AuthorIdentity> {
  const studioKey = clean(studioKeyInput)
  const authorEmail = clean(authorEmailInput).toLowerCase()
  if (!studioKey || !authorEmail) {
    throw new AuthorIdentityError(403, "AUTHOR_WORKSPACE_REQUIRED", "An active author workspace is required.")
  }

  const licenseRef = database.collection("plugin_licenses").doc(studioKey)
  const identityRef = licenseRef.collection("author_identities").doc(PRIMARY_AUTHOR_IDENTITY_ID)

  return database.runTransaction(async (transaction) => {
    const [licenseSnapshot, identitySnapshot] = await Promise.all([
      transaction.get(licenseRef),
      transaction.get(identityRef),
    ])
    if (!licenseSnapshot.exists) {
      throw new AuthorIdentityError(404, "LICENSE_NOT_FOUND", "Your active author license was not found.")
    }

    const license = licenseSnapshot.data() || {}
    if (
      clean(license.status).toLowerCase() !== "active" ||
      clean(license.authorEmail).toLowerCase() !== authorEmail
    ) {
      throw new AuthorIdentityError(403, "LICENSE_SCOPE_MISMATCH", "This author license does not belong to your workspace.")
    }

    const displayName = normalizeDisplayName(license.authorName)
    if (!displayName) {
      throw new AuthorIdentityError(409, "PRIMARY_NAME_REQUIRED", "Add your author name before managing publishing identities.")
    }

    const existingIdentity = identitySnapshot.exists
      ? toAuthorIdentity(identitySnapshot.id, identitySnapshot.data() || {})
      : null
    if (!existingIdentity) {
      transaction.create(identityRef, {
        identityId: PRIMARY_AUTHOR_IDENTITY_ID,
        displayName,
        normalizedName: normalizeIdentityName(displayName),
        type: "primary",
        status: "active",
        source: "license_provisioning",
        rightsAttestation: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    transaction.set(licenseRef, {
      licenseClass: "individual_author",
      maxAuthorIdentities: INDIVIDUAL_AUTHOR_IDENTITY_LIMIT,
      primaryAuthorIdentityId: PRIMARY_AUTHOR_IDENTITY_ID,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return existingIdentity || {
      id: PRIMARY_AUTHOR_IDENTITY_ID,
      displayName,
      normalizedName: normalizeIdentityName(displayName),
      type: "primary",
      status: "active",
    }
  })
}

export async function registerPenName(
  database: FirebaseFirestore.Firestore,
  input: {
    studioKey: string
    authorEmail: string
    displayName: string
    rightsAttested: boolean
  }
): Promise<AuthorIdentity> {
  if (!input.rightsAttested) {
    throw new AuthorIdentityError(
      400,
      "RIGHTS_ATTESTATION_REQUIRED",
      "Confirm that you own or control the publishing rights for this pen name."
    )
  }

  const displayName = normalizeDisplayName(input.displayName)
  if (displayName.length < 2 || displayName.length > 120) {
    throw new AuthorIdentityError(400, "INVALID_AUTHOR_NAME", "Enter a valid pen name between 2 and 120 characters.")
  }

  const primary = await ensurePrimaryAuthorIdentity(database, input.studioKey, input.authorEmail)
  if (normalizeIdentityName(displayName) === primary.normalizedName) {
    throw new AuthorIdentityError(409, "DUPLICATE_AUTHOR_NAME", "Your pen name must be different from your primary author name.")
  }

  const licenseRef = database.collection("plugin_licenses").doc(clean(input.studioKey))
  const penNameRef = licenseRef.collection("author_identities").doc(PEN_NAME_IDENTITY_ID)
  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(penNameRef)
    if (snapshot.exists && snapshot.data()?.status === "active") {
      throw new AuthorIdentityError(
        403,
        "AUTHOR_IDENTITY_LIMIT_REACHED",
        "Your individual author license already includes one primary name and one pen name. Contact KOBA-I if your publishing needs have changed."
      )
    }

    const identity: AuthorIdentity = {
      id: PEN_NAME_IDENTITY_ID,
      displayName,
      normalizedName: normalizeIdentityName(displayName),
      type: "pen_name",
      status: "active",
    }
    transaction.set(penNameRef, {
      identityId: identity.id,
      displayName: identity.displayName,
      normalizedName: identity.normalizedName,
      type: identity.type,
      status: identity.status,
      rightsAttestation: true,
      rightsAttestedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(licenseRef, {
      licenseClass: "individual_author",
      maxAuthorIdentities: INDIVIDUAL_AUTHOR_IDENTITY_LIMIT,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return identity
  })
}

export async function requireAuthorizedAuthorIdentity(
  database: FirebaseFirestore.Firestore,
  studioKey: string,
  authorEmail: string,
  identityIdInput: string
): Promise<AuthorIdentity> {
  await ensurePrimaryAuthorIdentity(database, studioKey, authorEmail)
  const identityId = clean(identityIdInput)
  if (identityId !== PRIMARY_AUTHOR_IDENTITY_ID && identityId !== PEN_NAME_IDENTITY_ID) {
    throw new AuthorIdentityError(403, "AUTHOR_IDENTITY_NOT_AUTHORIZED", "Select an author name registered to this workspace.")
  }

  const snapshot = await database
    .collection("plugin_licenses")
    .doc(clean(studioKey))
    .collection("author_identities")
    .doc(identityId)
    .get()
  const identity = snapshot.exists ? toAuthorIdentity(snapshot.id, snapshot.data() || {}) : null
  if (!identity) {
    throw new AuthorIdentityError(403, "AUTHOR_IDENTITY_NOT_AUTHORIZED", "Select an author name registered to this workspace.")
  }
  return identity
}

export function normalizeDisplayName(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    : ""
}

function normalizeIdentityName(value: unknown): string {
  return normalizeDisplayName(value).normalize("NFKC").toLocaleLowerCase("en-US")
}

function toAuthorIdentity(id: string, data: FirebaseFirestore.DocumentData): AuthorIdentity | null {
  const displayName = normalizeDisplayName(data.displayName)
  const type = data.type
  if (!displayName || data.status !== "active" || (type !== "primary" && type !== "pen_name")) return null
  return {
    id,
    displayName,
    normalizedName: normalizeIdentityName(data.normalizedName || displayName),
    type,
    status: "active",
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
