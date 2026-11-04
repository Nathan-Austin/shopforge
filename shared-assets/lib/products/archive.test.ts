import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_SORTS,
  archiveQueryString,
  availableSorts,
  POPULARITY_MIN_UNITS,
  popularityAvailable,
  DEFAULT_ARCHIVE_SORT,
  EMPTY_ARCHIVE_QUERY,
  filterArchive,
  parseArchiveQuery,
  sortArchive,
  type ArchiveProduct,
  type ArchiveQuery
} from './archive';
import type { HeatScale } from './heat';

const query = (overrides: Partial<ArchiveQuery>): ArchiveQuery => ({
  ...EMPTY_ARCHIVE_QUERY,
  ...overrides
});

describe('parseArchiveQuery', () => {
  it('is empty with the default sort for a bare URL', () => {
    expect(parseArchiveQuery({})).toEqual(EMPTY_ARCHIVE_QUERY);
  });

  it('reads every parameter', () => {
    expect(
      parseArchiveQuery({
        q: 'ghost',
        category: 'smoky',
        heat: 'Hot',
        type: 'habanero',
        sort: 'hot-first'
      })
    ).toEqual({
      search: 'ghost',
      category: 'smoky',
      heat: 'Hot',
      chilliType: 'habanero',
      sort: 'hot-first'
    });
  });

  it('takes the first value when a parameter repeats, and trims', () => {
    expect(parseArchiveQuery({ q: ['  mango ', 'other'] }).search).toBe('mango');
  });

  it('falls back to the default sort for junk', () => {
    expect(parseArchiveQuery({ sort: 'cheapest' }).sort).toBe(DEFAULT_ARCHIVE_SORT);
    expect(parseArchiveQuery({ sort: ['', undefined] as never }).sort).toBe(
      DEFAULT_ARCHIVE_SORT
    );
  });

  it('rejects sorts the store mode does not offer', () => {
    expect(parseArchiveQuery({ sort: 'mild-first' }, ['recent', 'popular']).sort).toBe(
      DEFAULT_ARCHIVE_SORT
    );
    expect(parseArchiveQuery({ sort: 'popular' }, ['recent', 'popular']).sort).toBe(
      'popular'
    );
  });
});

describe('archiveQueryString', () => {
  it('is empty for the default state, so /shop stays bare', () => {
    expect(archiveQueryString(EMPTY_ARCHIVE_QUERY)).toBe('');
  });

  it('writes only what is set and skips the default sort', () => {
    expect(archiveQueryString(query({ search: 'mango', sort: 'recent' }))).toBe(
      '?q=mango'
    );
    expect(archiveQueryString(query({ sort: 'popular' }))).toBe('?sort=popular');
  });

  it('encodes values that need it', () => {
    expect(archiveQueryString(query({ heat: 'Extra hot' }))).toBe('?heat=Extra+hot');
  });

  it('round-trips through parseArchiveQuery', () => {
    const state = query({
      search: 'über scharf & fruchtig',
      category: 'fruit-forward',
      heat: 'Extra hot',
      chilliType: 'ghost-pepper',
      sort: 'mild-first'
    });
    const params = Object.fromEntries(
      new URLSearchParams(archiveQueryString(state).slice(1))
    );
    expect(parseArchiveQuery(params)).toEqual(state);
  });
});

const scale: HeatScale = {
  max: 10,
  display: 'both',
  bands: [
    { word: 'Mild', upTo: 3 },
    { word: 'Medium', upTo: 6 },
    { word: 'Hot', upTo: 10 }
  ]
};

const sauces: (ArchiveProduct & { name: string })[] = [
  {
    name: 'Mango Mild',
    description: 'A gentle fruity sauce',
    brand: { name: 'Fruit Co' },
    category: { id: 1, slug: 'fruit-forward' },
    chilliTypes: [{ id: 'a', slug: 'jalapeno' }],
    heatLevel: 2,
    salesCount: 5,
    createdAt: '2026-01-03T00:00:00Z'
  },
  {
    name: 'Smoke Show',
    description: null,
    brand: { name: 'Ember' },
    category: { id: 2, slug: 'smoky' },
    chilliTypes: [{ id: 'b', slug: 'habanero' }],
    heatLevel: 6,
    salesCount: 40,
    createdAt: '2026-01-01T00:00:00Z'
  },
  {
    name: 'Reaper Rage',
    description: 'Serious heat',
    brand: null,
    category: { id: 2, slug: 'smoky' },
    chilliTypes: [{ id: 'c', slug: 'carolina-reaper' }],
    heatLevel: 10,
    salesCount: 5,
    createdAt: '2026-01-02T00:00:00Z'
  },
  {
    name: 'Mystery Marinade',
    category: null,
    heatLevel: null,
    createdAt: null
  }
];

const names = (list: { name: string }[]) => list.map((product) => product.name);

describe('filterArchive', () => {
  it('returns everything for the empty query', () => {
    expect(filterArchive(sauces, EMPTY_ARCHIVE_QUERY, scale)).toHaveLength(4);
  });

  it('searches name, description and brand, case-insensitively', () => {
    expect(names(filterArchive(sauces, query({ search: 'MANGO' }), scale))).toEqual([
      'Mango Mild'
    ]);
    expect(names(filterArchive(sauces, query({ search: 'serious' }), scale))).toEqual([
      'Reaper Rage'
    ]);
    expect(names(filterArchive(sauces, query({ search: 'ember' }), scale))).toEqual([
      'Smoke Show'
    ]);
    expect(filterArchive(sauces, query({ search: 'nope' }), scale)).toEqual([]);
  });

  it('filters by category slug or id', () => {
    expect(names(filterArchive(sauces, query({ category: 'smoky' }), scale))).toEqual([
      'Smoke Show',
      'Reaper Rage'
    ]);
    expect(names(filterArchive(sauces, query({ category: '1' }), scale))).toEqual([
      'Mango Mild'
    ]);
  });

  it('filters by the heat band word, leaving unrated products out', () => {
    expect(names(filterArchive(sauces, query({ heat: 'Hot' }), scale))).toEqual([
      'Reaper Rage'
    ]);
    expect(names(filterArchive(sauces, query({ heat: 'Medium' }), scale))).toEqual([
      'Smoke Show'
    ]);
  });

  it('ignores the heat filter without a scale, as in a generic shop', () => {
    expect(filterArchive(sauces, query({ heat: 'Hot' }), null)).toHaveLength(0);
  });

  it('filters by chilli type slug or id', () => {
    expect(
      names(filterArchive(sauces, query({ chilliType: 'habanero' }), scale))
    ).toEqual(['Smoke Show']);
    expect(names(filterArchive(sauces, query({ chilliType: 'c' }), scale))).toEqual([
      'Reaper Rage'
    ]);
  });

  it('combines filters', () => {
    expect(
      names(filterArchive(sauces, query({ category: 'smoky', search: 'rage' }), scale))
    ).toEqual(['Reaper Rage']);
  });
});

describe('sortArchive', () => {
  it('puts the newest first, undated products last', () => {
    expect(names(sortArchive(sauces, 'recent'))).toEqual([
      'Mango Mild',
      'Reaper Rage',
      'Smoke Show',
      'Mystery Marinade'
    ]);
  });

  it('puts the best sellers first for popular, newest among equals, unsold last', () => {
    expect(names(sortArchive(sauces, 'popular'))).toEqual([
      'Smoke Show',
      'Mango Mild',
      'Reaper Rage',
      'Mystery Marinade'
    ]);
  });

  it('sorts mild to hot with unrated products last', () => {
    expect(names(sortArchive(sauces, 'mild-first'))).toEqual([
      'Mango Mild',
      'Smoke Show',
      'Reaper Rage',
      'Mystery Marinade'
    ]);
  });

  it('sorts hot to mild with unrated products still last', () => {
    expect(names(sortArchive(sauces, 'hot-first'))).toEqual([
      'Reaper Rage',
      'Smoke Show',
      'Mango Mild',
      'Mystery Marinade'
    ]);
  });

  it('does not mutate its input', () => {
    const before = names([...sauces]);
    sortArchive(sauces, 'hot-first');
    expect(names([...sauces])).toEqual(before);
  });

  it('covers every declared sort', () => {
    for (const sort of ARCHIVE_SORTS) {
      expect(sortArchive(sauces, sort)).toHaveLength(sauces.length);
    }
  });
});

describe('popularityAvailable', () => {
  it('needs the minimum number of units sold', () => {
    expect(popularityAvailable(0)).toBe(false);
    expect(popularityAvailable(POPULARITY_MIN_UNITS - 1)).toBe(false);
    expect(popularityAvailable(POPULARITY_MIN_UNITS)).toBe(true);
    expect(popularityAvailable(Number.NaN)).toBe(false);
  });
});

describe('availableSorts', () => {
  it('hides popular in a shop that has not sold enough', () => {
    expect(availableSorts(['recent', 'popular', 'hot-first'], 3)).toEqual([
      'recent',
      'hot-first'
    ]);
  });

  it('offers popular once the shop has the sales history', () => {
    expect(availableSorts(['recent', 'popular'], POPULARITY_MIN_UNITS)).toEqual([
      'recent',
      'popular'
    ]);
  });

  it('means a ?sort=popular link falls back to the default until then', () => {
    expect(parseArchiveQuery({ sort: 'popular' }, availableSorts(['recent', 'popular'], 0)).sort).toBe(
      DEFAULT_ARCHIVE_SORT
    );
  });
});
