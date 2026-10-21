"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { addToCart } from "@/app/[locale]/cart/actions";
import { Loader2, Check, ShoppingCart } from "lucide-react";
import { useRouter } from "next/navigation";

interface AddToCartButtonProps {
  productId: string;
  variantId?: string;
  disabled?: boolean;
  outOfStock?: boolean;
  label: string;
  outOfStockLabel?: string;
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  redirectTo?: string;
}

export default function AddToCartButton({
  productId,
  variantId,
  disabled,
  outOfStock = false,
  label,
  outOfStockLabel = "Out of Stock",
  variant = "default",
  size = "default",
  className,
  redirectTo,
}: AddToCartButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const router = useRouter();

  async function handleAddToCart() {
    setIsPending(true);
    try {
      await addToCart(productId, 1, undefined, undefined, variantId);
      window.dispatchEvent(new Event("cart:updated"));
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        setIsSuccess(true);
        setTimeout(() => setIsSuccess(false), 2000);
      }
    } catch (error) {
      console.error("Failed to add to cart:", error);
    } finally {
      setIsPending(false);
    }
  }

  if (outOfStock) {
    return (
      <Button
        disabled
        variant="secondary"
        size={size}
        className={`cursor-not-allowed opacity-60 ${className ?? ""}`}
      >
        {outOfStockLabel}
      </Button>
    );
  }

  return (
    <Button
      onClick={handleAddToCart}
      disabled={disabled || isPending}
      variant={isSuccess ? "outline" : variant}
      size={size}
      className={className}
    >
      {isPending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : isSuccess ? (
        <Check className="mr-2 h-4 w-4 text-green-600" />
      ) : (
        <ShoppingCart className="mr-2 h-4 w-4" />
      )}
      {isSuccess ? "Added!" : label}
    </Button>
  );
}
