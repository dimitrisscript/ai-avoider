import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-illuminarty-key");
    if (!apiKey) {
      return NextResponse.json({ error: "Missing x-illuminarty-key" }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Missing image file" }, { status: 400 });
    }

    const forwarded = new FormData();
    forwarded.append("image", file);

    const res = await fetch("https://api.illuminarty.ai/v0/is_ai", {
      method: "POST",
      headers: {
        Authorization: `ApiKey-v1 ${apiKey}`,
      },
      body: forwarded,
    });

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
