import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function makeSlug(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "agent"}-${suffix}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "general").trim().toLowerCase();
    const endpointUrl = String(body.endpointUrl ?? "").trim();
    const description = String(body.description ?? "").trim();

    if (!name || !endpointUrl) {
      return NextResponse.json(
        { error: "Agent name and endpoint URL are required." },
        { status: 400 }
      );
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(endpointUrl);
    } catch {
      return NextResponse.json({ error: "Enter a valid agent endpoint URL." }, { status: 400 });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: "Agent endpoint must use HTTP or HTTPS." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase server environment variables");
      return NextResponse.json({ error: "Server configuration is incomplete." }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .from("agents")
      .insert({
        name,
        slug: makeSlug(name),
        description: description || null,
        category: category || "general",
        endpoint_url: parsedUrl.toString(),
        is_public: true,
      })
      .select("id,name,slug,category,endpoint_url,created_at")
      .single();

    if (error) {
      console.error("Supabase agent insert failed", error);
      return NextResponse.json({ error: "Could not save this agent." }, { status: 500 });
    }

    return NextResponse.json({ agent: data }, { status: 201 });
  } catch (error) {
    console.error("Agent submission failed", error);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
