import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    success: false,
    code: "AUTHOR_ACTIVATION_REPLACED",
    error: "Use the secure, single-use account-establishment invitation from your welcome package.",
  }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
