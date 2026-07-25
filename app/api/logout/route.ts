import { NextResponse } from "next/server";

import { DASHBOARD_SESSION_COOKIE } from "@/core/security/dashboard-session";

export async function POST() {
  const response = NextResponse.json({ success: true }, { status: 200 });

  response.cookies.set(DASHBOARD_SESSION_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  });

  return response;
}
