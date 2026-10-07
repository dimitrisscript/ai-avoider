import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = req.headers.get("x-hive-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Missing x-hive-key" }, { status: 400 });
    }
    const res = await fetch(
      "https://api.thehive.ai/api/v3/hive/ai-generated-image-and-video-detection",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: body.input }),
      }
    );
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bad request" },
      { status: 400 }
    );
  }
}
