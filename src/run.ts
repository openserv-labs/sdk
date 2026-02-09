import type { Agent } from './agent'
import { logger } from './logger'
import { OpenServTunnel, type OpenServTunnelOptions } from './tunnel'

// ============================================================================
// Types
// ============================================================================

export interface RunOptions {
  /**
   * Options for the OpenServ tunnel.
   * If not provided, defaults will be used (API key from env, default proxy URL).
   */
  tunnel?: Omit<OpenServTunnelOptions, 'onConnected' | 'onRequest' | 'onError'>

  /**
   * Whether to register signal handlers for graceful shutdown (SIGTERM, SIGINT).
   * Defaults to true.
   */
  handleSignals?: boolean
}

export interface RunResult {
  /**
   * The tunnel instance for advanced control.
   * Null when the tunnel is disabled (DISABLE_TUNNEL=true).
   */
  tunnel: OpenServTunnel | null

  /**
   * Stop the agent and tunnel.
   */
  stop: () => Promise<void>
}

// ============================================================================
// Main Run Function
// ============================================================================

/**
 * Run an agent with automatic tunnel management.
 *
 * This function handles:
 * 1. Starting the agent's HTTP server
 * 2. Creating a tunnel to connect to the OpenServ proxy
 *
 * @param agent - The Agent instance to run
 * @param options - Optional configuration for the tunnel
 * @returns Run result with tunnel and stop function
 *
 * @example
 * ```typescript
 * import { Agent, run } from '@openserv-labs/sdk'
 *
 * const agent = new Agent({
 *   systemPrompt: 'You are a helpful assistant.'
 * })
 *
 * agent.addCapability({
 *   name: 'greet',
 *   description: 'Greet someone',
 *   inputSchema: z.object({ name: z.string() }),
 *   run: async ({ args }) => `Hello, ${args.name}!`
 * })
 *
 * const { stop } = await run(agent)
 *
 * // Later, to stop:
 * await stop()
 * ```
 */
export async function run(agent: Agent, options?: RunOptions): Promise<RunResult> {
  await agent.start()

  const tunnelDisabled = process.env.DISABLE_TUNNEL === 'true'

  let tunnel: OpenServTunnel | null = null

  if (!tunnelDisabled) {
    tunnel = new OpenServTunnel({
      ...options?.tunnel,
      // Always use the agent's API key to ensure tunnel authenticates as the correct agent
      // This prevents issues when running multiple agents with different API keys
      apiKey: agent.apiKey,
      onConnected: isReconnect => {
        if (!isReconnect) {
          logger.info('Agent connected to OpenServ proxy')
        }
      },
      onError: error => {
        logger.error(`Tunnel error: ${error.message}`)
      }
    })

    try {
      await tunnel.start(agent.port)
    } catch (error) {
      // Clean up the agent if tunnel fails to connect
      await agent.stop()
      throw error
    }
  } else {
    logger.info(`Agent running on port ${agent.port} (tunnel disabled)`)
  }

  let shutdownPromise: Promise<void> | null = null
  let sigtermHandler: (() => void) | null = null
  let sigintHandler: (() => void) | null = null

  const stop = async () => {
    // Return existing shutdown promise if already in progress
    // This ensures concurrent callers wait for actual completion
    if (shutdownPromise) return shutdownPromise

    shutdownPromise = (async () => {
      // Remove signal handlers to prevent stale references on repeated run() calls
      if (sigtermHandler) {
        process.removeListener('SIGTERM', sigtermHandler)
        sigtermHandler = null
      }
      if (sigintHandler) {
        process.removeListener('SIGINT', sigintHandler)
        sigintHandler = null
      }

      if (tunnel) await tunnel.stop()
      await agent.stop()
    })()

    return shutdownPromise
  }

  // Register signal handlers for graceful shutdown (default: true)
  const handleSignals = options?.handleSignals !== false
  if (handleSignals) {
    const signalHandler = (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`)
      stop()
        .then(() => {
          process.exit(0)
        })
        .catch(err => {
          logger.error(`Error during shutdown: ${err.message}`)
          process.exit(1)
        })
    }

    sigtermHandler = () => signalHandler('SIGTERM')
    sigintHandler = () => signalHandler('SIGINT')
    process.once('SIGTERM', sigtermHandler)
    process.once('SIGINT', sigintHandler)
  }

  return {
    tunnel,
    stop
  }
}
