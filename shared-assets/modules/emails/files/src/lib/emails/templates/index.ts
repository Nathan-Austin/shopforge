/**
 * Simple HTML templates for transactional emails
 */

import { formatPrice } from "@/lib/format";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

// Product images are stored as WebP, which classic Outlook (Windows desktop) can't
// render in HTML emails. Route through /api/email-image to re-encode as JPEG.
function emailSafeImageUrl(url: string): string {
  return `${SITE_URL}/api/email-image?src=${encodeURIComponent(url)}`;
}

interface OrderItem {
  name: string;
  quantity: number;
  priceCents: number;
  imageUrl?: string;
}

interface OrderDetails {
  id: string;
  orderNumber?: number;
  customerEmail: string;
  shippingName: string;
  shippingStreet: string;
  shippingCity: string;
  shippingPostalCode: string;
  shippingCountry: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  items: OrderItem[];
  paymentMethod?: string;
  orderedAt?: string;
  packingSlipUrl?: string;
}

/**
 * Packing Slip for Seller (Sales Team)
 */
export function getPackingSlipHtml(order: OrderDetails): string {
  const itemsList = order.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${item.imageUrl ? `<img src="${emailSafeImageUrl(item.imageUrl)}" width="50" height="50" style="object-fit: contain; border: 1px solid #eee; border-radius: 4px; flex-shrink: 0;" />` : `<div style="width: 50px; height: 50px; background: #f5f5f5; border: 1px solid #eee; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🌶️</div>`}
          <span>${item.name}</span>
        </div>
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${formatPrice(item.priceCents * item.quantity)}</td>
    </tr>
  `,
    )
    .join("");

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <div style="margin-bottom: 24px;">
        <img src="https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/assets/email/logo.jpg" alt="Your Store" style="height: 60px; width: auto;" />
      </div>
      <h1 style="color: #d32f2f;">New Order: Packing Slip</h1>
      <p>Order: <strong>#${order.orderNumber ?? order.id.slice(0, 8).toUpperCase()}</strong></p>
      ${order.orderedAt ? `<p>Order Date: <strong>${order.orderedAt}</strong></p>` : ""}
      <p>Customer: ${order.shippingName} (${order.customerEmail})</p>
      ${order.paymentMethod ? `<p>Payment: <strong>${order.paymentMethod}</strong></p>` : ""}

      ${
        order.packingSlipUrl
          ? `<div style="margin: 24px 0;">
        <a href="${order.packingSlipUrl}" style="background: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
          Download Packing Slip PDF
        </a>
      </div>`
          : ""
      }

      <h3>Shipping Address:</h3>
      <p>
        ${order.shippingName}<br>
        ${order.shippingStreet}<br>
        ${order.shippingPostalCode} ${order.shippingCity}<br>
        ${order.shippingCountry}
      </p>

      <h3>Order Items:</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f8f8f8;">
            <th style="padding: 10px; text-align: left;">Product</th>
            <th style="padding: 10px; text-align: center;">Qty</th>
            <th style="padding: 10px; text-align: right;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsList}
        </tbody>
      </table>

      <div style="margin-top: 20px; text-align: right;">
        <p>Subtotal: ${formatPrice(order.subtotalCents)}</p>
        <p>Shipping: ${formatPrice(order.shippingCents)}</p>
        <p style="font-weight: bold; font-size: 1.2em;">Total: ${formatPrice(order.totalCents)}</p>
      </div>
    </div>
  `;
}

/**
 * Order Confirmation for Purchaser
 */
export function getOrderConfirmationHtml(order: OrderDetails): string {
  const itemsList = order.items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
        <div style="font-weight: bold; color: #000;">${item.name}</div>
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; text-align: center; color: #666;">
        &times;${item.quantity}
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; text-align: right; font-weight: bold;">
        ${formatPrice(item.priceCents * item.quantity)}
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6; padding: 20px;">
      <div style="margin-bottom: 40px;">
        <img src="https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/assets/email/logo.jpg" alt="Your Store" style="height: 60px; width: auto;" />
      </div>

      <h1 style="font-size: 2.5em; font-weight: 800; color: #000; margin-bottom: 20px; letter-spacing: -1px;">
        Thank you for your order
      </h1>
      
      <p style="font-size: 1.1em; color: #555; margin-bottom: 30px;">
        Hi ${order.shippingName.split(" ")[0]},<br><br>
        Just to let you know &mdash; we've received your order, and it is now being processed.
      </p>

      <div style="margin-bottom: 40px;">
        <h2 style="font-size: 1.5em; font-weight: bold; color: #000; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px;">
          Order summary
        </h2>
        <p style="color: #666; margin-bottom: 20px;">Order #${order.orderNumber ?? order.id.slice(0, 8).toUpperCase()}</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <thead>
            <tr style="text-align: left; color: #999; font-size: 0.8em; text-transform: uppercase; letter-spacing: 1px;">
              <th style="padding-bottom: 10px;">Product</th>
              <th style="padding-bottom: 10px; text-align: center;">Quantity</th>
              <th style="padding-bottom: 10px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsList}
          </tbody>
        </table>

        <div style="width: 100%; max-width: 300px; margin-left: auto;">
          <div style="display: flex; justify-content: space-between; padding: 5px 0; color: #666;">
            <span>Subtotal:</span>
            <span>${formatPrice(order.subtotalCents)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 5px 0; color: #666;">
            <span>Shipping:</span>
            <span>${formatPrice(order.shippingCents)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 15px 0; border-top: 2px solid #000; margin-top: 10px; font-size: 1.3em; font-weight: bold; color: #000;">
            <span>Total:</span>
            <span>${formatPrice(order.totalCents)}</span>
          </div>
        </div>
      </div>

      ${
        order.paymentMethod
          ? `
      <div style="margin-bottom: 40px; text-align: right;">
        <span style="color: #999; font-size: 0.9em;">Payment method:</span>
        <span style="font-weight: bold; margin-left: 10px;">${order.paymentMethod}</span>
      </div>
      `
          : ""
      }

      <div style="display: grid; grid-template-cols: 1fr 1fr; gap: 40px; margin-bottom: 40px;">
        <div style="width: 45%; display: inline-block; vertical-align: top;">
          <h3 style="font-size: 0.9em; text-transform: uppercase; color: #999; margin-bottom: 15px;">Billing address</h3>
          <p style="font-size: 0.9em; color: #555; margin: 0;">
            ${order.shippingName}<br>
            ${order.shippingStreet}<br>
            ${order.shippingPostalCode} ${order.shippingCity}<br>
            ${order.customerEmail}
          </p>
        </div>
        <div style="width: 45%; display: inline-block; vertical-align: top;">
          <h3 style="font-size: 0.9em; text-transform: uppercase; color: #999; margin-bottom: 15px;">Shipping address</h3>
          <p style="font-size: 0.9em; color: #555; margin: 0;">
            ${order.shippingName}<br>
            ${order.shippingStreet}<br>
            ${order.shippingPostalCode} ${order.shippingCity}
          </p>
        </div>
      </div>

      <div style="text-align: center; border-top: 1px solid #eee; padding-top: 40px; margin-top: 40px;">
        <p style="font-weight: bold; margin-bottom: 5px;">Thankyou for choosing example.com!</p>
        <p style="font-size: 0.9em; color: #666; margin-bottom: 25px;">
          You will shortly receive your shipping information from the carrier of your choice<br>
          (please check your spam folder)
        </p>
        
        <p style="font-size: 0.9em; color: #666; margin-bottom: 20px;">
          Don't forget to follow us on Instagram<br>
          <a href="https://www.instagram.com/example.com" style="color: #000; font-weight: bold; text-decoration: none;">#example.com</a>
        </p>

        <a href="https://www.example.com" style="color: #666; font-size: 0.8em; text-decoration: none;">www.example.com</a>
      </div>
    </div>
  `;
}

/**
 * Low Stock Notification for Seller
 */
export function getLowStockEmailHtml(
  productName: string,
  currentStock: number,
): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h1 style="color: #d32f2f;">⚠️ Low Stock Alert</h1>
      <p>The following product is running low on stock:</p>
      
      <div style="background: #fff3f3; padding: 20px; border-radius: 8px; border: 1px solid #ffcdd2; margin: 20px 0;">
        <h2 style="margin: 0 0 10px 0;">${productName}</h2>
        <p style="font-size: 1.2em; margin: 0;">Current Stock: <strong style="color: #d32f2f;">${currentStock}</strong></p>
      </div>

      <p>Time to restock before it sells out!</p>
      
      <div style="margin-top: 30px;">
        <a href="https://example.com/admin/products" style="background: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Manage Inventory
        </a>
      </div>
    </div>
  `;
}

/**
 * Shipping Confirmation for Purchaser
 */
export function getShippingConfirmationHtml(params: {
  firstName: string;
  orderNumber: number | null;
  orderId: string;
  items: OrderItem[];
  totalCents: number;
  currency: string;
  shippingName: string;
  shippingStreet: string;
  shippingPostalCode: string;
  shippingCity: string;
  shippingCountry: string;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingUrl: string | null;
}): string {
  const {
    firstName,
    orderNumber,
    orderId,
    items,
    totalCents,
    currency,
    shippingName,
    shippingStreet,
    shippingPostalCode,
    shippingCity,
    shippingCountry,
    trackingNumber,
    trackingCarrier,
    trackingUrl,
  } = params;

  const orderRef = orderNumber
    ? String(orderNumber).padStart(4, "0")
    : orderId.slice(0, 8).toUpperCase();

  const carrierLabel =
    trackingCarrier === "postnl" ? "PostNL"
    : trackingCarrier === "bpost" ? "bpost"
    : trackingCarrier === "dhl" ? "DHL"
    : trackingCarrier === "dpd" ? "DPD"
    : trackingCarrier ?? "your carrier";

  const itemsList = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #000; font-weight: bold;">
        ${item.name}
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; text-align: center; color: #666;">
        &times;${item.quantity}
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; text-align: right; font-weight: bold;">
        ${formatPrice(item.priceCents * item.quantity, currency)}
      </td>
    </tr>
  `
    )
    .join("");

  const trackingSection = trackingNumber
    ? `
    <div style="background: #f0fdf4; border: 2px solid #86efac; border-radius: 12px; padding: 24px; margin: 32px 0; text-align: center;">
      <p style="font-size: 0.8em; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #166534; margin: 0 0 6px 0;">
        Tracking Information
      </p>
      <p style="font-size: 1em; color: #555; margin: 0 0 4px 0;">Carrier: <strong>${carrierLabel}</strong></p>
      <p style="font-family: monospace; font-size: 1.3em; font-weight: bold; color: #000; margin: 8px 0;">
        ${trackingNumber}
      </p>
      ${
        trackingUrl
          ? `<div style="margin-top: 16px;">
              <a href="${trackingUrl}" style="background: #000; color: #fff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 0.95em; display: inline-block;">
                Track My Order &rarr;
              </a>
            </div>`
          : ""
      }
    </div>`
    : `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin: 32px 0; text-align: center;">
      <p style="color: #6b7280; margin: 0;">
        Tracking information will be sent separately by your carrier — please check your spam folder if you don't see it.
      </p>
    </div>`;

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6; padding: 20px;">
      <div style="margin-bottom: 40px;">
        <img src="https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/assets/email/logo.jpg" alt="Your Store" style="height: 60px; width: auto;" />
      </div>

      <h1 style="font-size: 2.5em; font-weight: 800; color: #000; margin-bottom: 20px; letter-spacing: -1px;">
        Your order is on its way! 🌶️
      </h1>

      <p style="font-size: 1.1em; color: #555; margin-bottom: 8px;">
        Hi ${firstName},
      </p>
      <p style="font-size: 1.1em; color: #555; margin-bottom: 30px;">
        Great news &mdash; your order <strong>#${orderRef}</strong> has been dispatched and is heading your way!
      </p>

      ${trackingSection}

      <div style="margin-bottom: 40px;">
        <h2 style="font-size: 1.2em; font-weight: bold; color: #000; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 16px;">
          What's in your box
        </h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <thead>
            <tr style="text-align: left; color: #999; font-size: 0.8em; text-transform: uppercase; letter-spacing: 1px;">
              <th style="padding-bottom: 8px;">Product</th>
              <th style="padding-bottom: 8px; text-align: center;">Qty</th>
              <th style="padding-bottom: 8px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsList}</tbody>
        </table>
        <div style="text-align: right; font-size: 1.1em; font-weight: bold; padding-top: 8px; border-top: 2px solid #000;">
          Total: ${formatPrice(totalCents, currency)}
        </div>
      </div>

      <div style="margin-bottom: 40px;">
        <h3 style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 10px;">Shipping to</h3>
        <p style="color: #555; font-size: 0.95em; margin: 0; line-height: 1.8;">
          ${shippingName}<br>
          ${shippingStreet}<br>
          ${shippingPostalCode} ${shippingCity}<br>
          <strong>${shippingCountry}</strong>
        </p>
      </div>

      <div style="background: #fff8f0; border-radius: 8px; padding: 20px; margin-bottom: 40px; font-size: 0.9em; color: #555;">
        <strong>Any questions?</strong> Message us directly on WhatsApp or reply to this email &mdash; we are always happy to help!
      </div>

      <div style="text-align: center; border-top: 1px solid #eee; padding-top: 40px;">
        <p style="font-weight: bold; margin-bottom: 5px;">Thank you for choosing Your Store!</p>
        <p style="font-size: 0.9em; color: #666; margin-bottom: 20px;">
          Don't forget to follow us on Instagram<br>
          <a href="https://www.instagram.com/example.com" style="color: #000; font-weight: bold; text-decoration: none;">#example.com</a>
        </p>
        <a href="https://www.example.com" style="color: #666; font-size: 0.8em; text-decoration: none;">www.example.com</a>
      </div>
    </div>
  `;
}

/**
 * Refund Confirmation for Purchaser
 */
export function getRefundConfirmationHtml(params: {
  firstName: string;
  orderNumber: number | null;
  orderId: string;
  amountCents: number;
  currency: string;
  isFullRefund: boolean;
  refundedItems?: { name: string; quantity: number }[];
}): string {
  const { firstName, orderNumber, orderId, amountCents, currency, isFullRefund, refundedItems } = params;

  const orderRef = orderNumber
    ? String(orderNumber).padStart(4, "0")
    : orderId.slice(0, 8).toUpperCase();

  const itemsList = refundedItems?.length
    ? `
    <div style="margin-bottom: 32px;">
      <h3 style="font-size: 0.85em; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 10px;">Refunded items</h3>
      <ul style="color: #555; font-size: 0.95em; margin: 0; padding-left: 18px; line-height: 1.8;">
        ${refundedItems.map((item) => `<li>${item.name} &times;${item.quantity}</li>`).join("")}
      </ul>
    </div>`
    : "";

  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6; padding: 20px;">
      <div style="margin-bottom: 40px;">
        <img src="https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/assets/email/logo.jpg" alt="Your Store" style="height: 60px; width: auto;" />
      </div>

      <h1 style="font-size: 2.2em; font-weight: 800; color: #000; margin-bottom: 20px; letter-spacing: -1px;">
        Your refund has been processed
      </h1>

      <p style="font-size: 1.1em; color: #555; margin-bottom: 8px;">
        Hi ${firstName},
      </p>
      <p style="font-size: 1.1em; color: #555; margin-bottom: 30px;">
        We've refunded <strong>${formatPrice(amountCents, currency)}</strong> for your order <strong>#${orderRef}</strong>${isFullRefund ? " in full" : ""}. It should appear back on your original payment method within 5-10 business days, depending on your bank.
      </p>

      ${itemsList}

      <div style="background: #fff8f0; border-radius: 8px; padding: 20px; margin-bottom: 40px; font-size: 0.9em; color: #555;">
        <strong>Any questions?</strong> Message us directly on WhatsApp or reply to this email &mdash; we are always happy to help!
      </div>

      <div style="text-align: center; border-top: 1px solid #eee; padding-top: 40px;">
        <p style="font-weight: bold; margin-bottom: 5px;">Thank you for choosing Your Store!</p>
        <p style="font-size: 0.9em; color: #666; margin-bottom: 20px;">
          Don't forget to follow us on Instagram<br>
          <a href="https://www.instagram.com/example.com" style="color: #000; font-weight: bold; text-decoration: none;">#example.com</a>
        </p>
        <a href="https://www.example.com" style="color: #666; font-size: 0.8em; text-decoration: none;">www.example.com</a>
      </div>
    </div>
  `;
}

/**
 * Newsletter Double Opt-In Verification
 */
export function getNewsletterVerificationHtml(confirmUrl: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; text-align: center;">
      <h1 style="color: #000;">Confirm your subscription</h1>
      <p>Thanks for signing up for the Your Store newsletter!</p>
      <p>Please click the button below to confirm your email and receive your <strong>10% discount code</strong>.</p>
      
      <div style="margin: 40px 0;">
        <a href="${confirmUrl}" style="background: #d32f2f; color: #fff; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 1.1em;">
          Confirm My Email
        </a>
      </div>

      <p style="font-size: 0.8em; color: #999;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;
}

/**
 * Newsletter Welcome Email with Voucher
 */
export function getNewsletterWelcomeHtml(voucherCode: string | null): string {
  const voucherBlock = voucherCode
    ? `
      <p>Your email has been confirmed. As promised, here is your spicy discount:</p>
      <div style="background: #f9f9f9; border: 2px dashed #d32f2f; padding: 30px; margin: 30px 0; border-radius: 12px;">
        <p style="text-transform: uppercase; font-size: 0.9em; letter-spacing: 1px; margin-bottom: 10px; color: #666;">Use this code at checkout:</p>
        <span style="font-family: monospace; font-size: 2.5em; font-bold; color: #d32f2f; letter-spacing: 2px;">${voucherCode}</span>
        <p style="margin-top: 15px; font-size: 1.1em; font-weight: bold;">10% OFF YOUR NEXT ORDER</p>
      </div>`
    : `<p>Your email has been confirmed. You're now subscribed to our newsletter!</p>`;

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; text-align: center;">
      <h1 style="color: #000;">Welcome to the family! 🌶️</h1>
      ${voucherBlock}

      <p>Get ready for recipes, new arrivals, and limited edition drops.</p>

      <div style="margin-top: 40px;">
        <a href="https://example.com/shop" style="background: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Start Shopping
        </a>
      </div>

      <p style="margin-top: 60px; font-size: 0.8em; color: #999;">
        Your Store
      </p>
    </div>
  `;
}

/**
 * Post-Purchase Review Reminder — nudges the customer to review what they
 * bought; the discount code itself is sent separately once they actually
 * submit a review (see getReviewRewardHtml).
 */
export function getReviewReminderHtml(params: {
  customerName: string;
  products: { name: string; imageUrl: string | null }[];
  reviewUrl: string;
}): string {
  const { customerName, products, reviewUrl } = params;

  const productsList = products
    .map(
      (product) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">
        <div style="display: flex; align-items: center; gap: 10px;">
          ${product.imageUrl ? `<img src="${product.imageUrl}" width="50" height="50" style="object-fit: contain; border: 1px solid #eee; border-radius: 4px; flex-shrink: 0;" />` : `<div style="width: 50px; height: 50px; background: #f5f5f5; border: 1px solid #eee; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 20px;">🌶️</div>`}
          <span>${product.name}</span>
        </div>
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; text-align: center;">
      <div style="margin-bottom: 24px;">
        <img src="https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/assets/email/logo.jpg" alt="Your Store" style="height: 60px; width: auto;" />
      </div>

      <h1 style="color: #000;">How was the heat, ${customerName}? 🌶️</h1>
      <p>You picked up these a little while ago — we'd love to hear what you thought:</p>

      <table style="width: 100%; border-collapse: collapse; text-align: left; margin: 20px 0;">
        <tbody>
          ${productsList}
        </tbody>
      </table>

      <div style="margin: 30px 0;">
        <a href="${reviewUrl}" style="background: #000; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Leave a Review
        </a>
      </div>

      <div style="background: #fff8f0; border-radius: 8px; padding: 20px; margin: 30px 0; font-size: 0.95em; color: #555;">
        <strong>Leave a review and we'll send you a 10% discount code</strong> for your next order — as a thank you for sharing your feedback.
      </div>

      <p style="margin-top: 60px; font-size: 0.8em; color: #999;">
        Your Store
      </p>
    </div>
  `;
}

/**
 * Post-Review Reward — sent right after a customer submits a review on a
 * product they bought, containing their single-use 10% discount code.
 */
export function getReviewRewardHtml(params: {
  customerName: string;
  voucherCode: string;
}): string {
  const { customerName, voucherCode } = params;

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333; text-align: center;">
      <div style="margin-bottom: 24px;">
        <img src="https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/assets/email/logo.jpg" alt="Your Store" style="height: 60px; width: auto;" />
      </div>

      <h1 style="color: #000;">Thanks for the review, ${customerName}! 🌶️</h1>
      <p>We really appreciate you taking the time to share your thoughts. As promised, here is your discount code:</p>

      <div style="background: #f9f9f9; border: 2px dashed #d32f2f; padding: 30px; margin: 30px 0; border-radius: 12px;">
        <p style="text-transform: uppercase; font-size: 0.9em; letter-spacing: 1px; margin-bottom: 10px; color: #666;">Use this code at checkout:</p>
        <span style="font-family: monospace; font-size: 2.5em; font-weight: bold; color: #d32f2f; letter-spacing: 2px;">${voucherCode}</span>
        <p style="margin-top: 15px; font-size: 1.1em; font-weight: bold;">10% OFF YOUR NEXT ORDER</p>
      </div>

      <div style="margin-top: 40px;">
        <a href="https://example.com/shop" style="background: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">
          Start Shopping
        </a>
      </div>

      <p style="margin-top: 60px; font-size: 0.8em; color: #999;">
        Your Store
      </p>
    </div>
  `;
}
