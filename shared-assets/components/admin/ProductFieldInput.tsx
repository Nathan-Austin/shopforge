'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DIMENSION_KEYS,
  NUTRITION_KEYS,
  type ProductField
} from '@/lib/products/catalogue';
import { heatLevels, heatWord } from '@/lib/products/heat';

interface ProductFieldInputProps {
  field: ProductField;
  /** The product being edited, or undefined when creating one. */
  values?: Record<string, unknown> | null;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asList(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : asString(value);
}

function asRecord(value: unknown): Record<string, number> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, number>)
    : {};
}

/**
 * Renders one product field from the catalogue. The input `name` is always
 * the field key, which is what `parseProductFields` reads back out.
 */
export default function ProductFieldInput({
  field,
  values
}: ProductFieldInputProps) {
  const raw = values?.[field.column];
  const help = field.help ? (
    <p className="text-xs text-muted-foreground">{field.help}</p>
  ) : null;

  switch (field.type) {
    case 'textarea':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Textarea
            id={field.key}
            name={field.key}
            rows={field.key === 'details' ? 5 : 3}
            defaultValue={asString(raw)}
          />
          {help}
        </div>
      );

    case 'boolean':
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name={field.key}
              defaultChecked={raw === true}
              className="h-4 w-4 rounded border-input"
            />
            {field.label}
          </label>
          {help}
        </div>
      );

    case 'timestamp':
      return (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name={field.key}
              defaultChecked={Boolean(raw)}
              className="h-4 w-4 rounded border-input"
            />
            {field.label}
          </label>
          {help}
        </div>
      );

    case 'multiSelect':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <div className="flex flex-wrap gap-3">
            {(field.options ?? []).map((option) => (
              <label
                key={option}
                className="flex items-center gap-2 text-sm capitalize"
              >
                <input
                  type="checkbox"
                  name={field.key}
                  value={option}
                  defaultChecked={
                    Array.isArray(raw) && (raw as string[]).includes(option)
                  }
                  className="h-4 w-4 rounded border-input"
                />
                {option}
              </label>
            ))}
          </div>
          {help}
        </div>
      );

    case 'stringList':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            name={field.key}
            defaultValue={asList(raw)}
            placeholder="Comma separated"
          />
          {help}
        </div>
      );

    case 'cents':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            name={field.key}
            type="number"
            step="0.01"
            min="0"
            defaultValue={
              typeof raw === 'number' ? (raw / 100).toFixed(2) : ''
            }
          />
          {help}
        </div>
      );

    case 'decimal':
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            name={field.key}
            type="number"
            step="0.01"
            defaultValue={asString(raw)}
          />
          {help}
        </div>
      );

    case 'integer':
      // Heat gets a dropdown over the shop's own scale rather than a free
      // number box, so the words stay meaningful.
      if (field.key === 'heat_level') {
        const levels = heatLevels();
        return (
          <div className="space-y-2">
            <Label htmlFor={field.key}>{field.label}</Label>
            <select
              id={field.key}
              name={field.key}
              defaultValue={asString(raw)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Not set</option>
              {levels.map((level) => {
                const word = heatWord(level);
                return (
                  <option key={level} value={level}>
                    {word ? `${level} — ${word}` : String(level)}
                  </option>
                );
              })}
            </select>
            {help}
          </div>
        );
      }

      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input
            id={field.key}
            name={field.key}
            type="number"
            step="1"
            defaultValue={asString(raw)}
          />
          {help}
        </div>
      );

    case 'measure': {
      const unit = field.unitColumn ? asString(values?.[field.unitColumn]) : '';
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <div className="flex gap-2">
            <Input
              id={field.key}
              name={field.key}
              type="number"
              step="0.01"
              min="0"
              defaultValue={asString(raw)}
              className="flex-1"
            />
            <select
              name={`${field.key}_unit`}
              defaultValue={unit || field.options?.[0] || ''}
              aria-label={`${field.label} unit`}
              className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          {help}
        </div>
      );
    }

    case 'dimensions': {
      const dimensions = asRecord(raw);
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
          <div className="grid grid-cols-3 gap-2">
            {DIMENSION_KEYS.map((entry) => (
              <Input
                key={entry.key}
                name={`${field.key}_${entry.key}`}
                type="number"
                step="1"
                min="0"
                placeholder={entry.label}
                aria-label={`${field.label} ${entry.label}`}
                defaultValue={asString(dimensions[entry.key])}
              />
            ))}
          </div>
          {help}
        </div>
      );
    }

    case 'nutrition': {
      const nutrition = asRecord(raw);
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
          <div className="grid gap-4 sm:grid-cols-2">
            {NUTRITION_KEYS.map((entry) => (
              <div key={entry.key} className="space-y-1">
                <Label htmlFor={entry.key} className="text-xs font-normal">
                  {entry.label}
                </Label>
                <Input
                  id={entry.key}
                  name={entry.key}
                  type="number"
                  step={entry.step}
                  defaultValue={asString(nutrition[entry.key])}
                />
              </div>
            ))}
          </div>
          {help}
        </div>
      );
    }

    case 'text':
    default:
      return (
        <div className="space-y-2">
          <Label htmlFor={field.key}>{field.label}</Label>
          <Input id={field.key} name={field.key} defaultValue={asString(raw)} />
          {help}
        </div>
      );
  }
}
