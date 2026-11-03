/**
 * Mode-specific section of the product page.
 *
 * The product page is the same file in every store mode and renders this
 * component between the price and the description. The chilli mode uses it
 * for the heat meter and chilli types; a generic shop has nothing extra to
 * show, so it renders nothing. Keep the props in step with the chilli one.
 */

export interface ProductExtrasProps {
  locale: string;
  productId: string;
  heatLevel?: number | null;
  scovilleShu?: number | null;
}

export default async function ProductExtras(props: ProductExtrasProps) {
  void props;
  return null;
}
