export interface ValidationResult {
  ok: boolean;
  value?: string;
  error?: string;
}

const HTML_LIKE_PATTERN = /[<>]|<\/?[a-z][\s\S]*>|javascript:|data:text\/html|on\w+\s*=|\bscript\b/i;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function validateUserText(
  input: unknown,
  options: { min?: number; max: number; label?: string; allowBlank?: boolean },
): ValidationResult {
  const label = options.label ?? 'Texto';
  if (typeof input !== 'string') return { ok: false, error: `${label} inválido.` };

  const value = input.trim();
  if (!value) {
    return options.allowBlank ? { ok: true, value: '' } : { ok: false, error: `${label} é obrigatório.` };
  }

  const codepoints = Array.from(value);
  const min = options.min ?? 1;
  if (codepoints.length < min) return { ok: false, error: `${label} deve ter pelo menos ${min} caractere(s).` };
  if (codepoints.length > options.max) return { ok: false, error: `${label} deve ter até ${options.max} caracteres.` };
  if (CONTROL_CHARS.test(value) || HTML_LIKE_PATTERN.test(value)) return { ok: false, error: `${label} contém conteúdo inválido.` };

  return { ok: true, value };
}

export function validateEmailInput(input: unknown): ValidationResult {
  const result = validateUserText(input, { min: 5, max: 254, label: 'E-mail' });
  if (!result.ok) return result;
  const value = result.value!.toLowerCase();
  if (!EMAIL_PATTERN.test(value)) return { ok: false, error: 'E-mail inválido.' };
  return { ok: true, value };
}

export function validatePasswordInput(input: unknown): ValidationResult {
  if (typeof input !== 'string') return { ok: false, error: 'Senha inválida.' };
  if (input.length < 8) return { ok: false, error: 'Senha deve ter pelo menos 8 caracteres.' };
  if (input.length > 128) return { ok: false, error: 'Senha deve ter até 128 caracteres.' };
  if (CONTROL_CHARS.test(input)) return { ok: false, error: 'Senha contém caracteres inválidos.' };
  return { ok: true, value: input };
}

export function validateUuid(input: unknown, label = 'Identificador'): ValidationResult {
  if (typeof input !== 'string' || !UUID_PATTERN.test(input)) return { ok: false, error: `${label} inválido.` };
  return { ok: true, value: input };
}
