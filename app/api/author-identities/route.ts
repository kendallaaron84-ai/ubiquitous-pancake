import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { adminDb } from "@/core/firebase-admin"
import {
  AuthorIdentityError,
  loadAuthorIdentityRegistry,
  registerPenName,
} from "@/core/security/author-identity"
import {
  DASHBOARD_SESSION_COOKIE,
  resolveDashboardSessionSecret,
  verifyDashboardSession,
} from "@/core/security/dashboard-session"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface PenNameRequest {
  displayName?: unknown
  rightsAttested?: unknown
}

export async function GET() {
  try {
    const session = await requireSession()
    const studioKey = session.studioKey?.trim() || ""
    const registry = await loadAuthorIdentityRegistry(adminDb, studioKey, session.email)
    return NextResponse.json({ success: true, ...registry })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as PenNameRequest | null
    const identity = await registerPenName(adminDb, {
      studioKey: session.studioKey?.trim() || "",
      authorEmail: session.email,
      displayName: typeof body?.displayName === "string" ? body.displayName : "",
      rightsAttested: body?.rightsAttested === true,
    })
    return NextResponse.json({ success: true, identity }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

async function requireSession() {
  const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value
  if (!token) throw new AuthorIdentityError(401, "AUTHENTICATION_REQUIRED", "Sign in to manage your author names.")
  return verifyDashboardSession(token, resolveDashboardSessionSecret()).catch(() => {
    throw new AuthorIdentityError(401, "INVALID_SESSION", "Your dashboard session expired. Sign in again.")
  })
}

function errorResponse(error: unknown) {
  if (error instanceof AuthorIdentityError) {
    return NextResponse.json(
      { success: false, code: error.code, error: error.publicMessage },
      { status: error.status }
    )
  }
  console.error("Author identity request failed:", error)
  return NextResponse.json(
    { success: false, error: "Your author names could not be loaded." },
    { status: 500 }
  )
}
