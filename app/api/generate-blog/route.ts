import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title } = body;

    if (!title) {
      return NextResponse.json({ error: "Missing required parameter: title" }, { status: 400 });
    }

    console.log(`📡 Next.js Proxy: Tunnelling payload directly to Python service...`);

    // 🔑 FIRE AND FORGET: We initiate the trace but DO NOT wait for it to finish
    fetch("https://fh-a276cdb8f595fd04---ssrcontentengineprod-m6cijkcmmq-uc.a.run.app/api/generate-blog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), 
    }).catch(err => console.error("Python background tunnel fault:", err));

    // 🔑 RETURN INSTANTLY: The UI gets success immediately, avoiding the 60-second timeout crash
    return NextResponse.json({
      status: "success",
      message: "Pipeline successfully initialized in background framework."
    });

  } catch (error: any) {
    console.error("❌ Next.js Proxy Crash:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}