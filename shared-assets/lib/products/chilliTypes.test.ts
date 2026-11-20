import { describe, expect, it } from 'vitest';

import { CHILLI_TYPES_PRESENT, chilliTypeSelection } from './chilliTypes';

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe('chilliTypeSelection', () => {
  it('leaves the links alone when the form never showed the control', () => {
    // A generic shop's product form, and a chilli shop that has no types
    // defined yet: neither says anything about chilli types.
    expect(chilliTypeSelection(form([['name', 'Sauce']]))).toEqual({ submitted: false, ids: [] });
    // Even if something else put ids in the body, the marker is what counts.
    expect(chilliTypeSelection(form([['chilliTypeIds', 'abc']]))).toEqual({ submitted: false, ids: [] });
  });

  it('clears the links when the control was shown with nothing picked', () => {
    expect(chilliTypeSelection(form([[CHILLI_TYPES_PRESENT, '1']]))).toEqual({ submitted: true, ids: [] });
  });

  it('reads every picked type', () => {
    const selection = chilliTypeSelection(
      form([
        [CHILLI_TYPES_PRESENT, '1'],
        ['chilliTypeIds', 'habanero'],
        ['chilliTypeIds', 'ghost']
      ])
    );
    expect(selection).toEqual({ submitted: true, ids: ['habanero', 'ghost'] });
  });

  it('drops blanks and repeats, which the join table would refuse', () => {
    const selection = chilliTypeSelection(
      form([
        [CHILLI_TYPES_PRESENT, '1'],
        ['chilliTypeIds', 'habanero'],
        ['chilliTypeIds', '  '],
        ['chilliTypeIds', 'habanero'],
        ['chilliTypeIds', ' ghost ']
      ])
    );
    expect(selection).toEqual({ submitted: true, ids: ['habanero', 'ghost'] });
  });
});
