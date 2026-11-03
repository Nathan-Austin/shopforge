import { getTranslations } from 'next-intl/server';

import {
  formatHeat,
  heatFraction,
  heatScale,
  heatWord
} from '@/lib/products/heat';
import { many } from '@/lib/supabase/relations';
import { createClient } from '@/lib/supabase/server';
import Chip from './Chip';
import type { ChilliType } from './types';

/**
 * Mode-specific section of the product page: the heat meter, Scoville
 * rating and the chilli types that go into the product. The product page
 * itself is the same file in every store mode; the generic mode's version
 * of this component renders nothing.
 */
export interface ProductExtrasProps {
  locale: string;
  productId: string;
  heatLevel?: number | null;
  scovilleShu?: number | null;
}

interface ChilliTypeRow {
  id: string;
  name: string;
  slug: string;
  heat_level: number | null;
}

async function loadChilliTypes(productId: string): Promise<ChilliType[]> {
  const supabase = await createClient();
  // The join table and chilli_types are both world-readable, unlike
  // products, so the anon client can read them directly.
  const { data } = await supabase
    .from('products_chilli_types')
    .select('chilli_types ( id, name, slug, heat_level )')
    .eq('product_id', productId);

  return (data ?? [])
    .flatMap((row) => many(row.chilli_types as ChilliTypeRow | ChilliTypeRow[] | null))
    .map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      heatLevel: row.heat_level
    }))
    .sort((a, b) => Number(a.heatLevel ?? 0) - Number(b.heatLevel ?? 0));
}

export default async function ProductExtras({
  locale,
  productId,
  heatLevel,
  scovilleShu
}: ProductExtrasProps) {
  const t = await getTranslations({ locale, namespace: 'Product' });
  const chilliTypes = await loadChilliTypes(productId);

  const hasHeat = heatLevel !== null && heatLevel !== undefined && heatScale !== null;
  const hasScoville = typeof scovilleShu === 'number' && scovilleShu > 0;
  if (!hasHeat && !hasScoville && chilliTypes.length === 0) return null;

  const word = hasHeat ? heatWord(heatLevel) : null;
  const percent = Math.round(heatFraction(heatLevel) * 100);

  return (
    <section aria-labelledby="product-heat" className="space-y-3">
      <h2 id="product-heat" className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        {t('heat')}
      </h2>

      {hasHeat && heatScale && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-lg font-bold text-orange-600">{formatHeat(heatLevel)}</span>
            {word && heatScale.display === 'number' && (
              <span className="text-sm text-gray-600">{word}</span>
            )}
          </div>
          <div
            role="meter"
            aria-valuemin={0}
            aria-valuemax={heatScale.max}
            aria-valuenow={Number(heatLevel)}
            aria-label={t('heatMeter', { level: Number(heatLevel), max: heatScale.max })}
            className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-yellow-400 via-orange-500 to-red-600"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {hasScoville && (
        <p className="text-sm text-gray-600">
          {t('scoville', { shu: scovilleShu.toLocaleString(locale) })}
        </p>
      )}

      {chilliTypes.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-medium">{t('chilliTypes')}</h3>
          <ul className="flex flex-wrap gap-2">
            {chilliTypes.map((type) => (
              <li key={type.id}>
                <Chip>
                  {type.name}
                  {type.heatLevel !== null && type.heatLevel !== undefined && (
                    <span className="text-text-muted">· {formatHeat(type.heatLevel)}</span>
                  )}
                </Chip>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
