import type { CampaignWarning, CampaignWarningCode } from '@/lib/email/campaigns/render';

type Translate = (key: string, values?: Record<string, string | number>) => string;

const WARNING_KEYS: Record<CampaignWarningCode, string> = {
  'invalid-block': 'invalidBlock',
  'block-failed': 'blockFailed',
  'missing-translation': 'missingTranslation',
  'empty-block': 'emptyBlock',
  'missing-product': 'missingProduct',
  'missing-discount': 'missingDiscount',
  'unknown-merge-tag': 'unknownMergeTag',
  'unsafe-url': 'unsafeUrl',
  'missing-unsubscribe': 'missingUnsubscribe'
};

/**
 * A renderer warning in the owner's words, with the `Admin.email`
 * translator from either side (getTranslations or useTranslations).
 */
export function warningText(t: Translate, warning: CampaignWarning): string {
  // missing-translation details read "field:locale"; the locale is what matters.
  const language = warning.detail?.split(':').pop()?.toUpperCase() ?? '';
  const message = t(`warnings.${WARNING_KEYS[warning.code]}`, { detail: warning.detail ?? '', language });
  return warning.blockId ? t('warningIn', { message, block: warning.blockId }) : message;
}
