import mailchimp from "@mailchimp/mailchimp_marketing";
import crypto from "crypto";

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: process.env.MAILCHIMP_SERVER_PREFIX, // e.g. us1
});

const AUDIENCE_ID = process.env.MAILCHIMP_AUDIENCE_ID;

export async function subscribeUser({
  email,
  firstName,
  lastName,
  tags = [],
}: {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
}) {
  if (!AUDIENCE_ID) {
    console.warn("[Mailchimp] Audience ID not configured");
    return { success: false, error: "Not configured" };
  }

  try {
    const subscriberHash = crypto
      .createHash("md5")
      .update(email.toLowerCase())
      .digest("hex");

    await mailchimp.lists.setListMember(AUDIENCE_ID, subscriberHash, {
      email_address: email,
      status_if_new: "subscribed",
      merge_fields: {
        FNAME: firstName || "",
        LNAME: lastName || "",
      },
    });

    if (tags.length > 0) {
      await mailchimp.lists.updateListMemberTags(AUDIENCE_ID, subscriberHash, {
        tags: tags.map((tag) => ({ name: tag, status: "active" })),
      });
    }

    return { success: true };
  } catch (error) {
    console.error("[Mailchimp] Subscription failed:", error);
    return { success: false, error };
  }
}

export async function addOrderToMailchimp(orderData: any) {
  // Mailchimp E-commerce API could be used here for more advanced segments
  // For now, we just tag them as 'customer'
  return subscribeUser({
    email: orderData.customerEmail,
    firstName: orderData.shippingName.split(" ")[0],
    tags: ["customer", "purchaser"],
  });
}

/**
 * List recent campaigns
 */
export async function listCampaigns(count = 10) {
  try {
    const response = await (mailchimp as any).campaigns.list({
      count,
      sort_field: "create_time",
      sort_dir: "DESC",
    });
    return { success: true, campaigns: response.campaigns };
  } catch (error) {
    console.error("[Mailchimp] List campaigns failed:", error);
    return { success: false, error };
  }
}

/**
 * Create a new campaign
 */
export async function createCampaign({
  subject,
  previewText,
  title,
  fromName,
  replyTo,
}: {
  subject: string;
  previewText?: string;
  title: string;
  fromName: string;
  replyTo: string;
}) {
  if (!AUDIENCE_ID)
    return { success: false, error: "Audience ID not configured" };

  try {
    const campaign = await (mailchimp as any).campaigns.create({
      type: "regular",
      recipients: {
        list_id: AUDIENCE_ID,
      },
      settings: {
        subject_line: subject,
        preview_text: previewText || "",
        title: title,
        from_name: fromName,
        reply_to: replyTo,
      },
    });

    return { success: true, campaign };
  } catch (error) {
    console.error("[Mailchimp] Create campaign failed:", error);
    return { success: false, error };
  }
}

/**
 * Set campaign content
 */
export async function setCampaignContent(campaignId: string, html: string) {
  try {
    await (mailchimp as any).campaigns.setContent(campaignId, {
      html: html,
    });
    return { success: true };
  } catch (error) {
    console.error("[Mailchimp] Set content failed:", error);
    return { success: false, error };
  }
}
