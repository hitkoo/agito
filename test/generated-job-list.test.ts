import { describe, expect, mock, test } from 'bun:test'
import { createGeneratedJobListLoader } from '../src/main/generated-job-list'

describe('generated job list loader', () => {
  test('deduplicates concurrent loads', async () => {
    const load = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return ['job-1']
    })

    const loader = createGeneratedJobListLoader(load)
    const [first, second] = await Promise.all([loader(), loader()])

    expect(first).toEqual(['job-1'])
    expect(second).toEqual(['job-1'])
    expect(load).toHaveBeenCalledTimes(1)
  })
})
