import { getTranslations } from 'next-intl/server';
import { requireShopOwner } from './lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Package, Tag, Briefcase } from 'lucide-react';

export default async function AdminDashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { supabase } = await requireShopOwner(locale);
  const t = await getTranslations({ locale, namespace: 'Admin' });

  const [{ count: productCount }, { count: brandCount }, { count: categoryCount }] = await Promise.all([
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('brands').select('id', { count: 'exact', head: true }),
    supabase.from('categories').select('id', { count: 'exact', head: true })
  ]);

  const cards = [
    { 
      label: t('stats.products'), 
      value: productCount ?? 0, 
      icon: Package, 
      color: 'text-blue-600' 
    },
    { 
      label: t('stats.brands'), 
      value: brandCount ?? 0, 
      icon: Briefcase, 
      color: 'text-purple-600' 
    },
    { 
      label: t('stats.categories'), 
      value: categoryCount ?? 0, 
      icon: Tag, 
      color: 'text-green-600' 
    }
  ];

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t('dashboardWelcomeHeading')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t('dashboardWelcomeCopy')}</p>
        </CardContent>
      </Card>
    </div>
  );
}