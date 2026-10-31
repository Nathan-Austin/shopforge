# Roadmap

Planned work for shopforge, roughly in order.

## 1. Storefront and orders

- [ ] Cart and add-to-cart
- [ ] Product detail page
- [ ] Orders tables and Stripe webhook, so paid checkouts are recorded
- [ ] Order confirmation email
- [ ] Admin orders view

## 2. Admin and store settings

- [ ] Categories and brands admin
- [ ] Store settings (currency, shipping zones) in the database, replacing the
      hardcoded `src/lib/shipping/config.ts`
- [ ] Theme tokens instead of hardcoded colours

## 3. Languages

- [ ] Full `de`, `tr` and `ar` translations

## 4. Generator

- [ ] Node CLI replacing the heredocs in the shell scripts
- [ ] Docker self-hosting path alongside Vercel
- [ ] Payment adapters: Stripe, Mollie, PayPal

## 5. CI

- [ ] CI that generates a store and builds it
