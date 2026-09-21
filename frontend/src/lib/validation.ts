// validation.ts — input validation for subscription form fields

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface FieldErrors {
  merchantAddress?: string;
  tokenAddress?: string;
  amount?: string;
  interval?: string;
}

export const DEFAULT_INTERVAL_SECONDS = 2_592_000; // 30 days

/** Validates XLM amount input */
export function validateAmount(amount: string): ValidationResult {
  const num = parseFloat(amount);
  if (!amount || isNaN(num)) return { valid: false, error: "Amount is required" };
  if (num <= 0)              return { valid: false, error: "Amount must be greater than 0" };
  if (num > 1_000_000)       return { valid: false, error: "Amount exceeds maximum allowed" };
  // fix: minimum balance check — XLM base reserve is 1 XLM (closes #1)
  if (num < 1)               return { valid: false, error: "Minimum subscription amount is 1 XLM" };
  return { valid: true };
}

/** Validates billing interval in days */
export function validateInterval(days: string): ValidationResult {
  const num = parseInt(days, 10);
  if (!days || isNaN(num)) return { valid: false, error: "Interval is required" };
  if (num < 1)             return { valid: false, error: "Interval must be at least 1 day" };
  if (num > 365)           return { valid: false, error: "Interval cannot exceed 365 days" };
  return { valid: true };
}

/** Validates a Stellar public key (G...) */
export function validateAddress(address: string): ValidationResult {
  if (!address)                        return { valid: false, error: "Address is required" };
  if (!address.startsWith("G"))        return { valid: false, error: "Must be a valid Stellar address" };
  if (address.length !== 56)           return { valid: false, error: "Invalid Stellar address length" };
  return { valid: true };
}

/** Validates a Stellar contract address (C...) */
export function validateContractAddress(address: string): ValidationResult {
  if (!address)                        return { valid: false, error: "Token contract address is required" };
  if (!address.startsWith("C"))        return { valid: false, error: "Must be a valid Stellar contract address" };
  if (address.length !== 56)           return { valid: false, error: "Invalid Stellar contract address length" };
  return { valid: true };
}

/** Validates the full subscription form and returns field-level errors. */
export function validateSubscriptionForm(fields: {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
}): FieldErrors {
  const errors: FieldErrors = {};

  const merchant = validateAddress(fields.merchantAddress.trim());
  if (!merchant.valid) {
    errors.merchantAddress = merchant.error;
  }

  const token = validateContractAddress(fields.tokenAddress.trim());
  if (!token.valid) {
    errors.tokenAddress = token.error;
  }

  const amount = validateAmount(fields.amount);
  if (!amount.valid) {
    errors.amount = amount.error;
  }

  const interval = validateIntervalSeconds(fields.interval);
  if (!interval.valid) {
    errors.interval = interval.error;
  }

  return errors;
}

export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}

function validateIntervalSeconds(interval: string): ValidationResult {
  const num = parseInt(interval, 10);
  if (!interval || isNaN(num)) return { valid: false, error: "Interval is required" };
  if (num < 86_400)           return { valid: false, error: "Interval must be at least 86400 seconds" };
  if (num > 31_536_000)       return { valid: false, error: "Interval cannot exceed 31536000 seconds" };
  return { valid: true };
}
