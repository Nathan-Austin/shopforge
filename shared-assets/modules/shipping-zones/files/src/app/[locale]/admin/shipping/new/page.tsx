import { requireShopOwner } from "../../lib/auth";
import ShippingZoneForm from "../../components/ShippingZoneForm";
import { createShippingZone } from "../../actions/createShippingZone";

export default async function NewShippingZonePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireShopOwner(locale);

  const createAction = createShippingZone.bind(null, { locale });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">New shipping zone</h2>
        <p className="text-sm text-text-muted">
          Add a carrier, assign countries, and set weight-based rates.
        </p>
      </div>

      <ShippingZoneForm
        onSubmit={createAction}
        successRedirectPath={`/${locale}/admin/shipping`}
      />
    </div>
  );
}
