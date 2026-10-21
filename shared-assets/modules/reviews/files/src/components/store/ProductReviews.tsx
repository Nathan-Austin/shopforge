"use client";

import { useState, useEffect } from "react";
import { Star, CheckCircle2, User } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";
import { grantReviewDiscountIfEligible } from "@/app/[locale]/actions/reviewReward";
import { submitReview } from "@/app/[locale]/actions/submitReview";
import { useFormGuard } from "@/components/security/useFormGuard";

interface Review {
  id: string;
  rating: number;
  title: string | null;
  content: string;
  customer_name: string;
  is_verified: boolean;
  created_at: string;
}

interface ProductReviewsProps {
  productId: string;
  locale: string;
}

const PAGE_SIZE = 5;

function anonymizeName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;
  const [first, ...rest] = parts;
  const starred = rest.map((p) => (p.length <= 2 ? p : p[0] + "***")).join(" ");
  return `${first} ${starred}`;
}

export default function ProductReviews({
  productId,
  locale,
}: ProductReviewsProps) {
  const t = useTranslations("ProductPage");

  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Auth
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [hasPurchased, setHasPurchased] = useState<boolean | null>(null); // null = still checking

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [hoverRating, setHoverRating] = useState(0);
  const [formRating, setFormRating] = useState(0);
  const [formContent, setFormContent] = useState("");
  const [formName, setFormName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [rewarded, setRewarded] = useState(false);
  const { honeypotValue, renderedAt, honeypotFieldProps } = useFormGuard();

  useEffect(() => {
    async function init() {
      // Fetch reviews
      const { data } = await supabase
        .from("reviews")
        .select("id, rating, title, content, customer_name, is_verified, created_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false });

      if (data) setReviews(data);
      setIsLoading(false);

      // Fetch current user + profile for pre-filling name
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email ?? null);

        const [profileRes, purchasedRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("first_name, last_name")
            .eq("id", user.id)
            .maybeSingle(),
          supabase.rpc("has_purchased_product", { p_product_id: productId }),
        ]);

        if (profileRes.data) {
          const name = [profileRes.data.first_name, profileRes.data.last_name]
            .filter(Boolean)
            .join(" ");
          setUserName(name || user.email?.split("@")[0] || "");
          setFormName(name || user.email?.split("@")[0] || "");
        }

        setHasPurchased(purchasedRes.data === true);
      } else {
        setHasPurchased(false);
      }
    }

    init();
  }, [productId]);

  const averageRating =
    reviews.length > 0
      ? reviews.reduce((acc, rev) => acc + rev.rating, 0) / reviews.length
      : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (formRating === 0) {
      setSubmitError(t("errorRatingRequired") || "Please select a star rating.");
      return;
    }
    if (!formContent.trim()) {
      setSubmitError(t("errorContentRequired") || "Please write your review.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    const result = await submitReview({
      productId,
      rating: formRating,
      content: formContent.trim(),
      customerName: formName.trim(),
      honeypot: honeypotValue,
      renderedAt,
    });

    if (!result.review) {
      setSubmitError(result.error || t("errorSubmit") || "Something went wrong. Please try again.");
      setIsSubmitting(false);
      return;
    }

    // Prepend the new review to the list
    setReviews((prev) => [result.review!, ...prev]);
    setSubmitSuccess(true);
    setShowForm(false);
    setFormRating(0);
    setFormContent("");
    setIsSubmitting(false);

    // Best-effort: grant a discount code if this review earns one. Never
    // let a failure here affect the already-successful review submission.
    try {
      const { rewarded } = await grantReviewDiscountIfEligible({ productId });
      setRewarded(rewarded);
    } catch {
      // ignore — review was already saved successfully
    }
  }

  if (isLoading) {
    return (
      <div className="animate-pulse h-40 bg-zinc-50 rounded-2xl border border-zinc-100 mt-12" />
    );
  }

  const visibleReviews = showAll ? reviews : reviews.slice(0, PAGE_SIZE);

  return (
    <section id="reviews" className="mt-16 border-t border-zinc-100 pt-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {t("reviewsTitle") || "Customer Reviews"}
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center text-brand-red">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  size={20}
                  fill={i < Math.round(averageRating) ? "currentColor" : "none"}
                  className={i < Math.round(averageRating) ? "" : "text-zinc-200"}
                />
              ))}
            </div>
            <p className="text-sm font-medium text-zinc-600">
              {reviews.length}{" "}
              {reviews.length === 1
                ? t("reviewCount") || "review"
                : t("reviewsCount") || "reviews"}
            </p>
          </div>
        </div>

        {!submitSuccess && hasPurchased !== null && (
          !userEmail ? (
            <a
              href="/en/auth/sign-in"
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold uppercase tracking-widest bg-brand-black text-white hover:bg-brand-red transition-all"
            >
              {t("signInToReview") || "Sign in to Review"}
            </a>
          ) : !hasPurchased ? (
            <div className="text-right">
              <span className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold uppercase tracking-widest bg-zinc-200 text-zinc-400 cursor-not-allowed">
                {t("writeReview") || "Write a Review"}
              </span>
              <p className="mt-1 text-xs text-zinc-400">
                {t("purchaseRequired") || "Purchase this product to leave a review"}
              </p>
            </div>
          ) : (
            <button
              className="inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-bold uppercase tracking-widest bg-brand-black text-white hover:bg-brand-red transition-all"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm
                ? t("cancelReview") || "Cancel"
                : t("writeReview") || "Write a Review"}
            </button>
          )
        )}
      </div>

      {submitSuccess && (
        <div className="mb-8 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-green-700">
          <CheckCircle2 size={18} />
          <span className="text-sm font-medium">
            {rewarded
              ? t("reviewSubmittedRewarded") ||
                "Thank you! Your review has been submitted — check your email for a 10% discount code."
              : t("reviewSubmitted") || "Thank you! Your review has been submitted."}
          </span>
        </div>
      )}

      {/* Review form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-10 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 space-y-5"
        >
          <input {...honeypotFieldProps} />
          <h3 className="font-bold text-zinc-900">
            {t("writeReview") || "Write a Review"}
          </h3>

          {/* Star picker */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-2">
              {t("yourRating") || "Your Rating"}
            </label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setFormRating(star)}
                  className="text-orange-400 transition-transform hover:scale-110"
                >
                  <Star
                    size={28}
                    fill={(hoverRating || formRating) >= star ? "currentColor" : "none"}
                    className={(hoverRating || formRating) >= star ? "" : "text-zinc-300"}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              {t("yourName") || "Your Name"}
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder={t("namePlaceholder") || "Your name"}
              className="w-full rounded-lg border border-zinc-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>

          {/* Review content */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">
              {t("yourReview") || "Your Review"}
            </label>
            <textarea
              rows={4}
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder={t("reviewPlaceholder") || "Tell us what you think..."}
              className="w-full rounded-lg border border-zinc-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
            />
          </div>

          {submitError && (
            <p className="text-sm text-red-600">{submitError}</p>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl px-6 py-2.5 text-sm font-bold uppercase tracking-widest bg-brand-red text-white hover:bg-brand-red/90 transition-all disabled:opacity-50"
            >
              {isSubmitting
                ? t("submitting") || "Submitting..."
                : t("submitReview") || "Submit Review"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setSubmitError(""); }}
              className="rounded-xl px-6 py-2.5 text-sm font-bold uppercase tracking-widest border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-all"
            >
              {t("cancel") || "Cancel"}
            </button>
          </div>
        </form>
      )}

      {reviews.length === 0 ? (
        <div className="text-center py-12 bg-zinc-50 rounded-2xl border border-dashed border-zinc-200">
          <p className="text-zinc-500 italic">
            {t("noReviews") || "No reviews yet. Be the first to share your experience!"}
          </p>
        </div>
      ) : (
        <div className="grid gap-6">
          {visibleReviews.map((review) => (
            <div
              key={review.id}
              className="p-6 bg-white rounded-2xl border border-zinc-100 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400">
                    <User size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-900">
                        {anonymizeName(review.customer_name)}
                      </span>
                      {review.is_verified && (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 size={10} />
                          {t("verifiedPurchase") || "Verified"}
                        </span>
                      )}
                    </div>
                    <div className="flex text-brand-red mt-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          size={14}
                          fill={i < review.rating ? "currentColor" : "none"}
                          className={i < review.rating ? "" : "text-zinc-200"}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <time className="text-xs text-zinc-400">
                  {new Date(review.created_at).toLocaleDateString(locale, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </time>
              </div>

              {review.title && (
                <h3 className="font-bold text-zinc-900 mb-2">{review.title}</h3>
              )}
              <p className="text-zinc-600 text-sm leading-relaxed">
                {review.content}
              </p>
            </div>
          ))}

          {reviews.length > PAGE_SIZE && (
            <button
              onClick={() => setShowAll((prev) => !prev)}
              className="mt-2 text-sm font-semibold text-orange-600 hover:text-orange-700 transition-colors"
            >
              {showAll
                ? t("showLess") || "Show less"
                : `${t("showMore") || "Show all"} ${reviews.length} ${t("reviewsCount") || "reviews"}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
