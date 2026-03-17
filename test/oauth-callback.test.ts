import { describe, expect, test } from 'bun:test'
import {
  DeepLinkOAuthCallbackCoordinator,
  buildGoogleOAuthRedirectTarget,
} from '../src/main/auth/oauth-callback'

describe('buildGoogleOAuthRedirectTarget', () => {
  test('uses localhost callback during development', () => {
    expect(
      buildGoogleOAuthRedirectTarget({
        isPackaged: false,
        localhostCallbackBaseUrl: 'http://127.0.0.1:46771',
        protocolScheme: 'agito',
      })
    ).toBe('http://127.0.0.1:46771/callback')
  })

  test('uses app deep link callback when packaged', () => {
    expect(
      buildGoogleOAuthRedirectTarget({
        isPackaged: true,
        localhostCallbackBaseUrl: 'http://127.0.0.1:46771',
        protocolScheme: 'agito',
      })
    ).toBe('agito://auth/callback')
  })
})

describe('DeepLinkOAuthCallbackCoordinator', () => {
  test('resolves the pending callback when the matching deep link arrives', async () => {
    const coordinator = new DeepLinkOAuthCallbackCoordinator('agito')
    const pending = coordinator.waitForCallback()

    expect(
      coordinator.handleOpenUrl('agito://auth/callback?code=oauth-code&state=test-state')
    ).toBe(true)

    await expect(pending).resolves.toEqual({
      query: {
        code: 'oauth-code',
        state: 'test-state',
      },
    })
  })

  test('ignores unrelated URLs', () => {
    const coordinator = new DeepLinkOAuthCallbackCoordinator('agito')

    expect(coordinator.handleOpenUrl('https://example.com/callback?code=oauth-code')).toBe(false)
    expect(coordinator.handleOpenUrl('agito://other/callback?code=oauth-code')).toBe(false)
  })
})
