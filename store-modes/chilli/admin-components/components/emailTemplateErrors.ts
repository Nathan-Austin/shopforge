import type { EmailTemplateActionError, EmailTemplateActionResult } from '../actions/emailTemplates';

type Translate = (key: string, values?: Record<string, string | number>) => string;

const ERROR_KEYS: Record<EmailTemplateActionError, string> = {
  name: 'name',
  document: 'document',
  'too-large': 'tooLarge',
  starter: 'starter',
  not_found: 'notFound',
  not_authorized: 'notAuthorized',
  failed: 'failed'
};

/** For error codes that come back through the URL, which anyone can edit. */
export function isEmailTemplateActionError(value: unknown): value is EmailTemplateActionError {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_KEYS, value);
}

/** A failed template action in the owner's words (`Admin.email` translator). */
export function actionErrorText(t: Translate, result: Extract<EmailTemplateActionResult, { ok: false }>): string {
  return t(`errors.${ERROR_KEYS[result.error]}`, {
    count: result.issues?.length ?? 0,
    message: result.message ?? ''
  });
}
