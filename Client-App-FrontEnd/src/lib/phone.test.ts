import { describe, expect, it } from 'vitest'
import { isValidIranMobile, normalizePhone } from '@/lib/phone'
import { cartTotal } from '@/services/api'
import { MIN_ORDER } from '@/types'

describe('phone validation', () => {
  it('accepts Iranian mobile numbers with Persian digits', () => {
    expect(isValidIranMobile('۰۹۱۲۳۴۵۶۷۸۹')).toBe(true)
    expect(normalizePhone('09123456789')).toBe('09123456789')
  })

  it('rejects short or landline numbers', () => {
    expect(isValidIranMobile('0912')).toBe(false)
    expect(isValidIranMobile('02191000000')).toBe(false)
    expect(isValidIranMobile('')).toBe(false)
  })
})

describe('cart minimum order', () => {
  it('blocks checkout below 500,000 toman', () => {
    const total = cartTotal([
      { id: 'a', name: 'x', price: 83_400, img: '', unitsPerCarton: 12, qty: 2 },
    ])
    expect(total).toBe(166_800)
    expect(total >= MIN_ORDER).toBe(false)
  })

  it('allows checkout at the minimum', () => {
    const total = cartTotal([
      { id: 'a', name: 'x', price: 250_000, img: '', unitsPerCarton: 12, qty: 2 },
    ])
    expect(total).toBe(MIN_ORDER)
  })
})
