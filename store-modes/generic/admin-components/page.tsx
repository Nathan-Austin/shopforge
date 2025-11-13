import { getTranslations } from 'next-intl/server';
import { requireShopOwner } from './lib/auth';

export default async function AdminDashboard({ params: { locale } }: { params: { locale: string } }) {
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });

  const [{ count: productCount }, { count: brandCount }, { count: categoryCount }] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('brands').select('id', { count: 'exact', head: true }),
    supabase.from('categories').select('id', { count: 'exact', head: true })
  ]);

  const cards = [
    { label: t('stats.products'), value: productCount ?? 0 },
    { label: t('stats.brands'), value: brandCount ?? 0 },
    { label: t('stats.categories'), value: categoryCount ?? 0 }
  ];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <p className="text-sm text-text-muted">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-foreground">{card.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-foreground mb-2">{t('dashboardWelcomeHeading')}</h2>
        <p className="text-text-muted">{t('dashboardWelcomeCopy')}</p>
      </section>
    </div>
  );
}
