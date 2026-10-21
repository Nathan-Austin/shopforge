import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

// Classic Outlook (Windows desktop) renders HTML email via Word's engine, which
// can't display WebP — all product images are stored as WebP (client-side canvas
// upload in ImageUploader.tsx). This re-encodes to JPEG on the fly so emails render
// in every mail client, not just WebP-capable ones (Gmail, Apple Mail, new Outlook).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ALLOWED_HOST = supabaseUrl ? new URL(supabaseUrl).hostname : null;

export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src");
  if (!src) {
    return NextResponse.json({ error: "Missing src" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return NextResponse.json({ error: "Invalid src" }, { status: 400 });
  }

  if (!ALLOWED_HOST || url.hostname !== ALLOWED_HOST || !url.pathname.startsWith("/storage/v1/object/public/")) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  }

  const upstream = await fetch(url.toString());
  if (!upstream.ok) {
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }

  const input = Buffer.from(await upstream.arrayBuffer());
  const jpeg = await sharp(input)
    .resize(100, 100, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();

  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
