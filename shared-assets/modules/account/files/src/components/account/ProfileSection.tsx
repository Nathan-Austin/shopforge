"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProfileForm from "@/components/account/ProfileForm";

interface ProfileSectionProps {
  locale: string;
  email: string;
  role: string;
  initialValues: {
    firstName: string;
    lastName: string;
    phone: string;
    dateOfBirth: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
}

export default function ProfileSection({
  locale,
  email,
  role,
  initialValues,
}: ProfileSectionProps) {
  const t = useTranslations("Account.profile");
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card>
      <CardHeader
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setIsOpen((v) => !v);
        }}
        className="cursor-pointer select-none flex flex-row items-center justify-between"
      >
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <p className="mt-1 text-sm text-zinc-500">{email}</p>
        </div>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-8">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                {t("email")}
              </p>
              <p className="text-zinc-900 font-medium">{email}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                {t("role")}
              </p>
              <Badge variant="secondary" className="mt-1 capitalize">
                {role}
              </Badge>
            </div>
          </div>
          <ProfileForm locale={locale} initialValues={initialValues} />
        </CardContent>
      )}
    </Card>
  );
}
