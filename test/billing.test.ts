import { describe, expect, test } from 'bun:test'
import {
  buildBillingPackPresentation,
  canAffordGenerate,
  getGenerateCreditCost,
  type BillingPack,
} from '../src/shared/billing'

const STANDARD_PACK: BillingPack = {
  id: 'standard',
  name: '1100 credits',
  priceUsd: '10',
  credits: 1100,
  buttonLabel: 'Buy 1100 credits',
  badge: 'Most popular',
  description: '22 standard generations',
}

describe('getGenerateCreditCost', () => {
  test('always charges 50 credits for generate', () => {
    expect(getGenerateCreditCost()).toBe(50)
  })
})

describe('canAffordGenerate', () => {
  test('allows generation when balance meets the threshold', () => {
    expect(canAffordGenerate({ balanceCredits: 50 })).toBe(true)
  })

  test('rejects generation when balance is below 50 credits', () => {
    expect(canAffordGenerate({ balanceCredits: 49 })).toBe(false)
  })
})

describe('buildBillingPackPresentation', () => {
  test('derives bonus credits and standard-generation count from the pack credits', () => {
    expect(buildBillingPackPresentation(STANDARD_PACK)).toEqual({
      bonusCredits: 100,
      standardGenerations: 22,
    })
  })
})
