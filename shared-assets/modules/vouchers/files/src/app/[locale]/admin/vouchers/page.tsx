import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Ticket,
  Plus,
  ExternalLink,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { toggleVoucherActive } from "../actions/toggleVoucherActive";

export default async function VouchersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("Admin");
  const supabase = await createClient();

  const { data: vouchers } = await supabase
    .from("vouchers")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Vouchers & Promo Codes
          </h1>
          <p className="text-sm text-zinc-500">
            Manage your Stripe-linked discount codes.
          </p>
        </div>
        <Button asChild className="bg-black text-white hover:bg-zinc-800">
          <Link href={`/${locale}/admin/vouchers/new`}>
            <Plus className="mr-2 h-4 w-4" />
            Create New Voucher
          </Link>
        </Button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b">
              <th className="px-6 py-4 font-bold">Name & Code</th>
              <th className="px-6 py-4 font-bold">Discount</th>
              <th className="px-6 py-4 font-bold">Usage</th>
              <th className="px-6 py-4 font-bold">Status</th>
              <th className="px-6 py-4 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {vouchers?.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-12 text-center text-zinc-500"
                >
                  <Ticket className="mx-auto h-12 w-12 text-zinc-200 mb-4" />
                  <p>
                    No vouchers found. Create your first one to get started!
                  </p>
                </td>
              </tr>
            ) : (
              vouchers?.map((voucher) => (
                <tr
                  key={voucher.id}
                  className="hover:bg-zinc-50/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="font-bold text-zinc-900">
                      {voucher.name}
                    </div>
                    <code className="text-xs bg-zinc-100 px-1.5 py-0.5 rounded font-mono text-red-600">
                      {voucher.code}
                    </code>
                  </td>
                  <td className="px-6 py-4">
                    {voucher.discount_type === "percentage"
                      ? `${voucher.amount}% OFF`
                      : `${formatPrice(voucher.amount)} OFF`}
                    <div className="text-[10px] text-zinc-400 uppercase">
                      {voucher.duration}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium">
                      {voucher.redemptions_count} /{" "}
                      {voucher.max_redemptions || "∞"}
                    </div>
                    {voucher.first_time_only && (
                      <div className="text-[10px] text-blue-600 font-bold uppercase">
                        1st order only
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {voucher.is_active ? (
                      <span className="inline-flex items-center gap-1 text-green-600 font-bold text-xs uppercase">
                        <CheckCircle2 size={12} /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-zinc-400 font-bold text-xs uppercase">
                        <XCircle size={12} /> Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          await toggleVoucherActive({ locale }, formData);
                        }}
                      >
                        <input type="hidden" name="voucher_id" value={voucher.id} />
                        <input
                          type="hidden"
                          name="next_active"
                          value={(!voucher.is_active).toString()}
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                        >
                          {voucher.is_active ? "Deactivate" : "Activate"}
                        </Button>
                      </form>
                      <Button variant="ghost" size="sm" asChild>
                        <a
                          href={`https://dashboard.stripe.com/coupons/${voucher.stripe_coupon_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs flex items-center gap-1"
                        >
                          View in Stripe <ExternalLink size={12} />
                        </a>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
