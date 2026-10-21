"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getClientIp } from "@/lib/security/ip";
import { checkRateLimit } from "@/lib/security/rateLimit";
import { isSameOrigin } from "@/lib/security/origin";
import { logRejection } from "@/lib/security/log";

const ROUTE = "cart";

async function guardMutation(action: string) {
  const ip = await getClientIp();

  if (!(await isSameOrigin())) {
    logRejection({ route: `${ROUTE}.${action}`, ip, reason: "bad_origin" });
    throw new Error("Invalid request origin");
  }

  const allowed = await checkRateLimit({
    key: `${ROUTE}:ip:${ip}`,
    windowSeconds: 3600,
    maxHits: 120,
  });
  if (!allowed) {
    logRejection({ route: `${ROUTE}.${action}`, ip, reason: "rate_limited" });
    throw new Error("Too many requests. Please try again later.");
  }
}

const AddToCartSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  size: z.string().trim().max(50).optional(),
  color: z.string().trim().max(50).optional(),
  variantId: z.string().uuid().optional(),
});

export async function addToCart(
  productId: string,
  quantity: number = 1,
  size?: string,
  color?: string,
  variantId?: string,
) {
  await guardMutation("addToCart");

  const parsed = AddToCartSchema.parse({
    productId,
    quantity,
    size,
    color,
    variantId,
  });

  const supabase = createAdminClient();
  const cookieStore = await cookies();

  let cartSessionId = cookieStore.get("cart_session_id")?.value;

  if (!cartSessionId) {
    cartSessionId = crypto.randomUUID();
    cookieStore.set("cart_session_id", cartSessionId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  // Check if identical item already exists in cart (same product + same variant)
  let query = supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_session_id", cartSessionId)
    .eq("product_id", parsed.productId);

  if (parsed.variantId) {
    query = query.eq("variant_id", parsed.variantId);
  } else {
    query = query.is("variant_id", null);
  }

  const { data: existingItem } = await query.maybeSingle();

  if (existingItem) {
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: existingItem.quantity + parsed.quantity })
      .eq("id", existingItem.id);

    if (error) throw error;
  } else {
    const { error } = await supabase.from("cart_items").insert({
      cart_session_id: cartSessionId,
      product_id: parsed.productId,
      quantity: parsed.quantity,
      selected_size: parsed.size,
      selected_color: parsed.color,
      variant_id: parsed.variantId ?? null,
    });

    if (error) throw error;
  }

  revalidatePath("/cart");
}

const ItemIdSchema = z.string().uuid();

export async function removeFromCart(itemId: string) {
  await guardMutation("removeFromCart");

  const parsedItemId = ItemIdSchema.parse(itemId);

  const supabase = createAdminClient();
  const cartSessionId = (await cookies()).get("cart_session_id")?.value;
  if (!cartSessionId) return;

  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("id", parsedItemId)
    .eq("cart_session_id", cartSessionId);

  if (error) throw error;
  revalidatePath("/cart");
}

const UpdateQuantitySchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().int().max(99),
});

export async function updateCartQuantity(itemId: string, quantity: number) {
  const parsed = UpdateQuantitySchema.parse({ itemId, quantity });

  if (parsed.quantity <= 0) {
    return removeFromCart(parsed.itemId);
  }

  await guardMutation("updateCartQuantity");

  const supabase = createAdminClient();
  const cartSessionId = (await cookies()).get("cart_session_id")?.value;
  if (!cartSessionId) return;

  const { error } = await supabase
    .from("cart_items")
    .update({ quantity: parsed.quantity })
    .eq("id", parsed.itemId)
    .eq("cart_session_id", cartSessionId);

  if (error) throw error;
  revalidatePath("/cart");
}
