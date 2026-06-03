import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { formatUSD } from "@/utils/formatCurrency"

export { formatUSD, formatUSDShort, MONEY_LOCALE_US } from "@/utils/formatCurrency"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ---------- Date / time formatting helpers ----------

/** US English for all CRM-facing dates and times (consistent regardless of browser locale). */
export const DATE_LOCALE_US = "en-US" as const

export type DateInput = string | number | Date | null | undefined

/**
 * Normalize API/store dates to YYYY-MM-DD so month keys (e.g. loan allocation by YYYY-MM)
 * stay consistent. Handles ISO timestamps, plain YYYY-MM-DD, and US MM/DD/YYYY.
 */
export function normalizeApiDateToYyyyMmDd(value: DateInput): string {
  if (value === null || value === undefined || value === "") return ""
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return ""
    const isoPrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
    if (isoPrefix) return isoPrefix[1]
    const us = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
    if (us) {
      const month = parseInt(us[1], 10)
      const day = parseInt(us[2], 10)
      const year = parseInt(us[3], 10)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      }
    }
    const d = new Date(trimmed)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return ""
  }
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
}

/** Format a date-like value as "Apr 07, 2026" (US English, short month). */
export function formatDate(value: DateInput, fallback = ""): string {
  if (value === null || value === undefined || value === "") return fallback
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback

  return new Intl.DateTimeFormat(DATE_LOCALE_US, {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date)
}

/**
 * US numeric calendar date (month/day/year), e.g. "5/10/2023".
 * Parses leading `YYYY-MM-DD` as a local calendar day so it does not shift by timezone.
 */
export function formatDateMonthDayYear(value: DateInput, fallback = ""): string {
  if (value === null || value === undefined || value === "") return fallback

  let date: Date
  if (typeof value === "string") {
    const trimmed = value.trim()
    const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (ymd) {
      const y = Number(ymd[1])
      const mo = Number(ymd[2]) - 1
      const d = Number(ymd[3])
      date = new Date(y, mo, d)
    } else {
      date = new Date(trimmed)
    }
  } else if (value instanceof Date) {
    date = value
  } else {
    date = new Date(value)
  }

  if (Number.isNaN(date.getTime())) return fallback

  return new Intl.DateTimeFormat(DATE_LOCALE_US, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

/** Date and time in US English (e.g. "Apr 07, 2026, 3:45 PM"). */
export function formatDateTimeUS(value: DateInput, fallback = ""): string {
  if (value === null || value === undefined || value === "") return fallback
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return fallback

  return new Intl.DateTimeFormat(DATE_LOCALE_US, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

/** Format lastSeenAt as "Last seen X ago" (e.g. "Last seen 5m ago", "Last seen yesterday") */
export function formatLastSeen(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return "Last seen"
  const date = new Date(lastSeenAt)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return "Last seen just now"
  if (diffMins < 60) return `Last seen ${diffMins}m ago`
  if (diffHours < 24) return `Last seen ${diffHours}h ago`
  if (diffDays === 1) return "Last seen yesterday"
  if (diffDays < 7) return `Last seen ${diffDays}d ago`
  return `Last seen ${formatDate(date)}`
}

/** Exact date/time (e.g. "Mar 09, 2026, 3:45 PM") - for tooltip or "Last seen at ..." */
export function formatLastSeenExact(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return ""
  const date = new Date(lastSeenAt)
  if (Number.isNaN(date.getTime())) return ""
  const dateStr = formatDate(date)
  const timeStr = date.toLocaleTimeString(DATE_LOCALE_US, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  return `${dateStr}, ${timeStr}`
}

/** Display text for last seen: actual time when user was last online (e.g. "Last seen today at 3:45 PM") */
export function formatLastSeenWithTime(lastSeenAt: string | null | undefined): string {
  if (!lastSeenAt) return "Last seen"
  const date = new Date(lastSeenAt)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return "Last seen just now"
  const timeStr = date.toLocaleTimeString(DATE_LOCALE_US, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  const isToday = date.toDateString() === now.toDateString()
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === date.toDateString()
  if (isToday) return `Last seen today at ${timeStr}`
  if (isYesterday) return `Last seen yesterday at ${timeStr}`
  const dateStr = formatDate(date)
  return `Last seen ${dateStr} at ${timeStr}`
}

// ---------- Numeric formatting helpers ----------
// Single source of truth for how numbers are rounded and displayed.

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const num = typeof value === "string" ? Number(value) : (value as number)
  return Number.isFinite(num) ? num : null
}

/** Round any value to an integer using Math.round. Returns null for invalid input. */
export function roundToInt(value: unknown): number | null {
  const num = toNumberOrNull(value)
  if (num === null) return null
  return Math.round(num)
}

type FormatIntOptions = {
  locale?: string
  useGrouping?: boolean
  fallback?: string
}

/** Format a value as an integer string (no decimals). */
export function formatInt(
  value: unknown,
  options: FormatIntOptions = {},
): string {
  const { locale = "en-US", useGrouping = true, fallback = "" } = options
  const rounded = roundToInt(value)
  if (rounded === null) return fallback

  return rounded.toLocaleString(locale, {
    useGrouping,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })
}

type FormatCurrencyIntOptions = {
  locale?: string
  currency?: string
  fallback?: string
}

/** Format a value as a currency string with no decimals (whole units only). */
export function formatCurrencyInt(
  value: unknown,
  options: FormatCurrencyIntOptions = {},
): string {
  const { locale = "en-US", currency = "USD", fallback = "" } = options
  const rounded = roundToInt(value)
  if (rounded === null) return fallback

  return rounded.toLocaleString(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })
}

/**
 * Generic number formatting helper for UI display.
 * Uses the International Number System with comma grouping and no decimals.
 * Use for counts and other non-money integers.
 *
 * Examples:
 * - 1000 -> "1,000"
 * - 1000000 -> "1,000,000"
 */
export function formatNumber(value: unknown, fallback = ""): string {
  return formatInt(value, { fallback })
}

/** Strip non-numeric characters for parsing (digits, optional leading minus, one decimal point). */
export function sanitizeDecimalStringForParse(raw: string): string {
  let s = String(raw).replace(/[^0-9.-]+/g, "")
  const neg = s.startsWith("-")
  if (neg) s = s.slice(1)
  s = s.replace(/-/g, "")
  const parts = s.split(".")
  if (parts.length > 1) {
    s = parts[0] + "." + parts.slice(1).join("")
  } else {
    s = parts[0] ?? ""
  }
  return (neg ? "-" : "") + s
}

/** Parse a display/user string into a finite number, or NaN. */
export function parseNumberUS(value: unknown): number {
  if (value === null || value === undefined) return NaN
  if (typeof value === "string" && value.trim() === "") return NaN
  const s = sanitizeDecimalStringForParse(String(value)).replace(/,/g, "").trim()
  if (s === "" || s === "-" || s === "+" || s === ".") return NaN
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/**
 * US English number for read-only display: comma thousands, period decimal, always two fraction digits.
 */
export function formatNumberUS(value: unknown): string {
  if (value === null || value === undefined) return ""
  const num = parseNumberUS(value)
  if (Number.isNaN(num)) {
    if (typeof value === "string" && value.trim() !== "") return value
    return ""
  }
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Factor/sell rate — keeps real precision (e.g. 1.499), not forced to two decimals.
 */
export function formatRateUS(value: unknown): string {
  if (value === null || value === undefined) return ""
  const num = parseNumberUS(value)
  if (Number.isNaN(num)) {
    if (typeof value === "string" && value.trim() !== "") return value.trim()
    return ""
  }
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  })
}

/** Normalize rate on blur without rounding to two decimal places. */
export function formatRateUSCommit(raw: string): string {
  const num = parseNumberUS(raw)
  if (!Number.isFinite(num)) return ""
  return formatRateUS(num)
}

/**
 * Live numeric input: thousand separators on the integer part only; keep fractional digits as typed.
 */
export function formatNumberUSForInput(str: string): string {
  let s = String(str).replace(/[^0-9.-]/g, "")
  const neg = s.startsWith("-")
  if (neg) s = s.slice(1)
  s = s.replace(/-/g, "")
  const dot = s.indexOf(".")
  const intRaw = (dot === -1 ? s : s.slice(0, dot)).replace(/\D/g, "")
  const fracRaw = dot === -1 ? undefined : s.slice(dot + 1).replace(/\D/g, "")
  const hasDot = dot !== -1

  let intFormatted = ""
  if (intRaw !== "") {
    intFormatted = Number(intRaw).toLocaleString("en-US", {
      useGrouping: true,
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    })
  } else if (hasDot) {
    intFormatted = "0"
  }

  let body = intFormatted
  if (hasDot) {
    body += "." + (fracRaw ?? "")
  }

  if (!neg) return body
  if (body === "" && !hasDot) return "-"
  return `-${body}`
}

/** Percent for display using two fraction digits (e.g. 12.50%). */
export function formatPercentUS(value: unknown): string {
  const s = formatNumberUS(value)
  return s === "" ? "" : `${s}%`
}

/**
 * Full-precision currency for forms and contracts (e.g. "$ 12,345.67").
 */
export function formatCurrencyFull(
  value: unknown,
  options: { fallback?: string } = {},
): string {
  const { fallback = "" } = options
  if (value === null || value === undefined || value === "") return fallback
  const num = typeof value === "number" ? value : parseNumberUS(value)
  if (Number.isNaN(num)) return fallback
  return `$ ${formatNumberUS(num)}`
}

/**
 * Standard USD currency (no compact K/M notation).
 */
export function formatCurrency(
  value: unknown,
  options: { fallback?: string } = {},
): string {
  return formatUSD(value, options)
}

