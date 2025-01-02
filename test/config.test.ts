import { describe, it } from 'node:test'
import assert from 'node:assert'
import { validateEnv } from '../src/config'

describe('Config Validation', () => {
  it('should throw error when OPENSERV_API_KEY is missing', () => {
    assert.throws(() => validateEnv({}), /OpenServ API key is required/)
  })

  it('should throw error when OPENSERV_API_KEY is empty', () => {
    assert.throws(() => validateEnv({ OPENSERV_API_KEY: '' }), /OpenServ API key cannot be empty/)
  })

  it('should allow missing OPENAI_API_KEY', () => {
    const config = validateEnv({
      OPENSERV_API_KEY: 'test-key'
    })
    assert.equal(config.OPENAI_API_KEY, undefined)
  })

  it('should validate model names', () => {
    assert.throws(
      () =>
        validateEnv({
          OPENSERV_API_KEY: 'test-key',
          OPENAI_MODEL: 'invalid-model'
        }),
      /Invalid enum value/
    )

    const config = validateEnv({
      OPENSERV_API_KEY: 'test-key',
      OPENAI_MODEL: 'gpt-4o-2024-11-20'
    })
    assert.equal(config.OPENAI_MODEL, 'gpt-4o-2024-11-20')
  })

  it('should use default values', () => {
    const config = validateEnv({
      OPENSERV_API_KEY: 'test-key'
    })
    assert.equal(config.OPENAI_MODEL, 'gpt-4o')
    assert.equal(config.OPENSERV_API_URL, 'https://api.openserv.ai')
    assert.equal(config.OPENSERV_RUNTIME_URL, 'https://agents.openserv.ai')
    assert.equal(config.PORT, 7378)
    assert.equal(config.LOG_LEVEL, 'info')
  })

  it('should parse PORT as number', () => {
    const config = validateEnv({
      OPENSERV_API_KEY: 'test-key',
      PORT: '8080'
    })
    assert.equal(config.PORT, 8080)
  })

  it('should use default PORT when invalid', () => {
    const config = validateEnv({
      OPENSERV_API_KEY: 'test-key',
      PORT: 'invalid'
    })
    assert.equal(config.PORT, 7378)
  })

  it('should validate LOG_LEVEL', () => {
    assert.throws(
      () =>
        validateEnv({
          OPENSERV_API_KEY: 'test-key',
          LOG_LEVEL: 'invalid'
        }),
      /Invalid enum value/
    )

    const config = validateEnv({
      OPENSERV_API_KEY: 'test-key',
      LOG_LEVEL: 'debug'
    })
    assert.equal(config.LOG_LEVEL, 'debug')
  })
})
