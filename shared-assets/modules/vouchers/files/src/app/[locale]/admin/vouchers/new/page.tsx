import VoucherForm from "../../components/VoucherForm";

export default async function NewVoucherPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="py-6">
      <VoucherForm locale={locale} />
    </div>
  );
}
