import type { ChangeEvent } from 'react'

import { getCaretFromDigitIndex, getDigitsBeforeCaret } from './formatPhoneNumber'

export type SSNInput = string | number | null | undefined

export function getSSNDigits(value: SSNInput): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\D/g, '')
}

/**
 * Formats an SSN-like value into US format: XXX-XX-XXXX.
 * - Non-digits are stripped.
 * - Uses only the first 9 digits.
 * - Returns progressive formatting for fewer than 9 digits.
 */
export function formatSSN(value: SSNInput): string {
  const digits = getSSNDigits(value)
  if (!digits) return ''

  const limited = digits.slice(0, 9)
  const area = limited.slice(0, 3)
  const group = limited.slice(3, 5)
  const serial = limited.slice(5, 9)

  if (limited.length < 4) return area
  if (limited.length < 6) return `${area}-${group}`
  return `${area}-${group}-${serial}`
}

/**
 * React-friendly change helper that keeps caret position stable
 * for controlled SSN inputs while applying formatting.
 */
export function handleSSNInputChange(
  event: ChangeEvent<HTMLInputElement>,
  onFormattedChange: (value: string) => void
): void {
  const input = event.currentTarget
  const rawValue = input.value
  const selectionStart = input.selectionStart ?? rawValue.length
  const digitsBeforeCaret = getDigitsBeforeCaret(rawValue, selectionStart)
  const formattedValue = formatSSN(rawValue)

  onFormattedChange(formattedValue)

  // Wait for controlled value to render, then restore caret near user's typing point.
  requestAnimationFrame(() => {
    const nextCaret = getCaretFromDigitIndex(formattedValue, digitsBeforeCaret)
    input.setSelectionRange(nextCaret, nextCaret)
  })
}
