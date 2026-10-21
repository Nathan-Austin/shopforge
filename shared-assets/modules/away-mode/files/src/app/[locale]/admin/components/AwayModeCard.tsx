"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plane } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAwayModeReturnDate, revertAwayModeNow } from "../actions/awayMode";

interface AwayModeCardProps {
  locale: string;
  returnDate: string | null;
}

export default function AwayModeCard({ locale, returnDate }: AwayModeCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAction = setAwayModeReturnDate.bind(null, { locale });
  const revertAction = revertAwayModeNow.bind(null, { locale });

  async function handleSet(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const result = await setAction(formData);
    setLoading(false);
    if (result?.error) {
      setError(result.error);
    } else {
      router.refresh();
    }
  }

  async function handleRevert() {
    setLoading(true);
    setError(null);
    const result = await revertAction();
    setLoading(false);
    if (result?.error) {
      setError(result.error);
    } else {
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Plane className="h-5 w-5 text-brand-red" />
          Away Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {returnDate ? (
          <>
            <p className="text-sm text-text-muted">
              Low stock quantities set while you&apos;re away will be cleared and
              everything restored to <strong>In Stock</strong> automatically on{" "}
              <strong>{new Date(returnDate + "T00:00:00").toLocaleDateString(locale, {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}</strong>.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRevert}
              disabled={loading}
            >
              {loading ? "Restoring..." : "I'm back now — restore stock"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-text-muted">
              Set a return date before you hand off stock to someone covering
              sales. Anything that sells out while you&apos;re away will show as
              out of stock to customers — on your return date it&apos;s all
              automatically restored to In Stock, since you&apos;ll likely have
              more at home.
            </p>
            <form onSubmit={handleSet} className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="return_date" className="text-xs">
                  Back on
                </Label>
                <Input
                  id="return_date"
                  name="return_date"
                  type="date"
                  required
                  className="h-9"
                />
              </div>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Saving..." : "Set"}
              </Button>
            </form>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
