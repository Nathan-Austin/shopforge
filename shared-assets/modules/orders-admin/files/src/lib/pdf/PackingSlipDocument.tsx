import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import { formatPrice } from "@/lib/format";

export interface PackingSlipItem {
  name: string;
  quantity: number;
  priceCents: number;
  selectedSize?: string | null;
  selectedColor?: string | null;
  imageUrl?: string | null;
}

export interface PackingSlipOrder {
  id: string;
  orderNumber?: number | null;
  customerEmail: string;
  shippingName: string;
  shippingStreet: string;
  shippingCity: string;
  shippingPostalCode: string;
  shippingCountry: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  currency: string;
  voucherCode?: string | null;
  orderedAt?: string;
  items: PackingSlipItem[];
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#222" },
  logo: { height: 36, width: 120, marginBottom: 20, objectFit: "contain", alignSelf: "flex-start" },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 4, color: "#d32f2f" },
  meta: { fontSize: 10, color: "#444", marginBottom: 2 },
  section: { marginTop: 18 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
    borderBottom: "1px solid #ccc",
    paddingBottom: 4,
  },
  addressText: { fontSize: 10, lineHeight: 1.5 },
  table: { marginTop: 6 },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottom: "1px solid #eee",
  },
  colProduct: { flex: 3, flexDirection: "row", alignItems: "center" },
  itemImage: {
    width: 28,
    height: 28,
    marginRight: 8,
    objectFit: "contain",
    borderRadius: 3,
  },
  colQty: { flex: 1, textAlign: "center" },
  colPrice: { flex: 1, textAlign: "right" },
  headerText: { fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#666" },
  totals: { marginTop: 16, alignSelf: "flex-end", width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { color: "#555" },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    marginTop: 6,
    borderTop: "1px solid #222",
  },
  grandTotalLabel: { fontSize: 12, fontWeight: 700 },
  grandTotalValue: { fontSize: 12, fontWeight: 700 },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#999",
    textAlign: "center",
  },
});

export function PackingSlipDocument({ order }: { order: PackingSlipOrder }) {
  const orderRef = order.orderNumber ?? order.id.slice(0, 8).toUpperCase();

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Image
          src="https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/assets/email/logo.jpg"
          style={styles.logo}
        />

        <Text style={styles.title}>Packing Slip</Text>
        <Text style={styles.meta}>Order #{orderRef}</Text>
        {order.orderedAt && <Text style={styles.meta}>Ordered: {order.orderedAt}</Text>}
        <Text style={styles.meta}>Customer: {order.customerEmail}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ship To</Text>
          <Text style={styles.addressText}>{order.shippingName}</Text>
          <Text style={styles.addressText}>{order.shippingStreet}</Text>
          <Text style={styles.addressText}>
            {order.shippingPostalCode} {order.shippingCity}
          </Text>
          <Text style={styles.addressText}>{order.shippingCountry}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items</Text>
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.colProduct, styles.headerText]}>Product</Text>
              <Text style={[styles.colQty, styles.headerText]}>Qty</Text>
              <Text style={[styles.colPrice, styles.headerText]}>Price</Text>
            </View>
            {order.items.map((item, i) => (
              <View style={styles.tableRow} key={i}>
                <View style={styles.colProduct}>
                  {item.imageUrl && <Image src={item.imageUrl} style={styles.itemImage} />}
                  <View>
                    <Text>{item.name}</Text>
                    {(item.selectedSize || item.selectedColor) && (
                      <Text style={{ fontSize: 8, color: "#888", marginTop: 2 }}>
                        {[item.selectedSize, item.selectedColor].filter(Boolean).join(" · ")}
                      </Text>
                    )}
                  </View>
                </View>
                <Text style={styles.colQty}>{item.quantity}</Text>
                <Text style={styles.colPrice}>
                  {formatPrice(item.priceCents * item.quantity, order.currency)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text>{formatPrice(order.subtotalCents, order.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Shipping</Text>
            <Text>{formatPrice(order.shippingCents, order.currency)}</Text>
          </View>
          {order.voucherCode && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Voucher</Text>
              <Text>{order.voucherCode}</Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>
              {formatPrice(order.totalCents, order.currency)}
            </Text>
          </View>
        </View>

        <Text style={styles.footer}>Your Store · www.example.com</Text>
      </Page>
    </Document>
  );
}
