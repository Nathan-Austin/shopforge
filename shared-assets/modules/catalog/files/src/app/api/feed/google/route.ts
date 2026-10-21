import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";
  // Optional Google product taxonomy ID or path, e.g. "Food, Beverages & Tobacco > Food Items".
  // Left out of the feed when unset; Google then infers a category.
  const googleCategory = process.env.GOOGLE_PRODUCT_CATEGORY?.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const { data: products, error } = await supabase
    .from("products")
    .select(
      `
      id,
      name,
      description,
      slug,
      price_cents,
      currency,
      image_url,
      in_stock,
      is_active,
      brand:brands(name),
      category:categories!category_id(name)
    `,
    )
    .eq("is_active", true)
    .eq("is_archived", false);

  if (error) {
    return new NextResponse("Error fetching products", { status: 500 });
  }

  const xmlItems = products
    ?.map((product: any) => {
      const availability = product.in_stock ? "in_stock" : "out_of_stock";
      const price = (product.price_cents / 100).toFixed(2);
      const productUrl = `${baseUrl}/en/shop/${product.slug}`; // Defaulting to English for now
      const description =
        product.description || `Buy ${product.name} at Your Store`;

      // Clean description from XML-breaking characters
      const cleanDescription = description
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

      const cleanName = product.name
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

      return `
    <item>
      <g:id>${product.id}</g:id>
      <g:title>${cleanName}</g:title>
      <g:description>${cleanDescription}</g:description>
      <g:link>${productUrl}</g:link>
      <g:image_link>${product.image_url || ""}</g:image_link>
      <g:condition>new</g:condition>
      <g:availability>${availability}</g:availability>
      <g:price>${price} ${product.currency}</g:price>
      <g:brand>${product.brand?.name || "Your Store"}</g:brand>
${googleCategory ? `      <g:google_product_category>${googleCategory}</g:google_product_category>\n` : ""}      <g:product_type>${product.category?.name || "Products"}</g:product_type>
      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
    })
    .join("");

  const xmlFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Your Store Product Feed</title>
    <link>${baseUrl}</link>
    <description>Products from Your Store</description>
    ${xmlItems}
  </channel>
</rss>`;

  return new NextResponse(xmlFeed, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "s-maxage=3600, stale-while-revalidate",
    },
  });
}
