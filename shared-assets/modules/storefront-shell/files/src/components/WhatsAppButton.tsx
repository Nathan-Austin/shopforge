"use client";

import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";

export default function WhatsAppButton({ number }: { number: string }) {
  const pathname = usePathname();
  if (pathname.includes("/admin")) return null;
  return (
    <a
      href={`https://wa.me/${number}`}
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-8 right-8 z-50 flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl transition-all hover:scale-110 active:scale-95"
      aria-label="Chat on WhatsApp"
    >
      <MessageCircle size={48} />
    </a>
  );
}
