import WebSocket from 'ws'
import http from 'node:http'
import { logger } from './logger'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PROXY_URL = process.env.OPENSERV_PROXY_URL || 'https://agents-proxy.openserv.ai'
const MAX_RECONNECTION_ATTEMPTS = 10
const MAX_RESPONSE_SIZE = 100 * 1024 * 1024 // 100MB max response body
const WS_TERMINATE_TIMEOUT = 3000 // 3 seconds to wait before force-terminating WebSocket

// Reusable HTTP agent for local forwarding (keep-alive to avoid TCP connection overhead)
const localAgent = new http.Agent({ keepAlive: true, maxSockets: 64 })

// ============================================================================
// State Machine Types
// ============================================================================

/**
 * All possible states for the tunnel connection.
 */
export type TunnelState =
  | 'idle' // Initial state, not started
  | 'starting' // start() called, initializing before connection
  | 'connecting' // WebSocket connection in progress
  | 'authenticating' // WS open, auth message sent
  | 'connected' // Fully authenticated, handling requests
  | 'awaiting_reconnect_ack' // Sent will-reconnect, waiting for server ack
  | 'reconnect_delay' // Waiting for backoff timer before retry
  | 'stopping' // stop() called, cleaning up resources
  | 'failed' // Max retries reached, terminal state
  | 'stopped' // User called stop(), terminal state

/**
 * Events that can trigger state transitions.
 */
export type TunnelEvent =
  | 'START' // User calls start()
  | 'SETUP_COMPLETE' // Initialization done, proceed to connect
  | 'SETUP_FAILED' // Initialization failed (e.g., missing API key)
  | 'STOP' // User calls stop()
  | 'CLEANUP_COMPLETE' // Async cleanup finished
  | 'GRACEFUL_RECONNECT' // User calls gracefulReconnect()
  | 'WS_OPEN' // WebSocket 'open' event
  | 'WS_CLOSE' // WebSocket 'close' event
  | 'WS_ERROR' // WebSocket 'error' event (informational, close follows)
  | 'AUTH_SUCCESS' // Received 'registered' message
  | 'AUTH_ERROR' // Received 'error' message
  | 'RECONNECT_ACK' // Received 'will-reconnect-ack' message
  | 'DELAY_COMPLETE' // Backoff delay timer completed
  | 'ACK_TIMEOUT' // Will-reconnect ack timeout
  | 'MAX_RETRIES' // Max reconnection attempts reached

/**
 * Valid state transitions. Maps current state to events and their target states.
 */
const VALID_TRANSITIONS: Record<TunnelState, Partial<Record<TunnelEvent, TunnelState>>> = {
  idle: {
    START: 'starting',
    STOP: 'stopped'
  },
  starting: {
    SETUP_COMPLETE: 'connecting',
    SETUP_FAILED: 'failed',
    STOP: 'stopping'
  },
  connecting: {
    WS_OPEN: 'authenticating',
    WS_CLOSE: 'reconnect_delay',
    WS_ERROR: 'reconnect_delay', // Error triggers reconnect with backoff
    STOP: 'stopping'
  },
  authenticating: {
    AUTH_SUCCESS: 'connected',
    AUTH_ERROR: 'failed', // Auth errors are fatal, no retry
    WS_CLOSE: 'reconnect_delay',
    WS_ERROR: 'reconnect_delay', // Error triggers reconnect with backoff
    STOP: 'stopping'
  },
  connected: {
    WS_CLOSE: 'reconnect_delay',
    WS_ERROR: 'reconnect_delay', // Error triggers reconnect with backoff
    GRACEFUL_RECONNECT: 'awaiting_reconnect_ack',
    STOP: 'stopping'
  },
  awaiting_reconnect_ack: {
    RECONNECT_ACK: 'reconnect_delay',
    ACK_TIMEOUT: 'reconnect_delay',
    WS_CLOSE: 'reconnect_delay',
    WS_ERROR: 'reconnect_delay', // Error triggers reconnect with backoff
    STOP: 'stopping'
  },
  reconnect_delay: {
    DELAY_COMPLETE: 'connecting',
    MAX_RETRIES: 'failed',
    STOP: 'stopping'
  },
  stopping: {
    CLEANUP_COMPLETE: 'stopped'
  },
  failed: {
    STOP: 'stopped',
    START: 'starting' // Allow restart after failure
  },
  stopped: {
    START: 'starting' // Allow restart after stop
  }
}

/**
 * Context that persists across state transitions.
 */
interface TunnelContext {
  reconnectAttempts: number
  disconnectedAt: number | null
  hasConnectedOnce: boolean // For isReconnect detection
  lastError: Error | null
}

// ============================================================================
// Types
// ============================================================================

export interface RequestData {
  id: string
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}

export interface ResponseData {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

interface TunnelMessage {
  type: string
  data?: RequestData | { bufferTimeout: number }
  error?: string
  message?: string
}

export interface OpenServTunnelOptions {
  /**
   * The OpenServ API key for authentication.
   * Required unless OPENSERV_API_KEY environment variable is set.
   */
  apiKey?: string

  /**
   * The proxy server URL.
   * Defaults to OPENSERV_PROXY_URL env var or 'https://agents-proxy.openserv.ai'
   */
  proxyUrl?: string

  /**
   * Called when tunnel is connected/reconnected.
   */
  onConnected?: (isReconnect: boolean) => void | Promise<void>

  /**
   * Called when a request is received through the tunnel.
   */
  onRequest?: (method: string, path: string) => void

  /**
   * Called when an error occurs.
   */
  onError?: (error: Error) => void
}

// ============================================================================
// Helper Functions
// ============================================================================

async function forwardToLocalAgent(
  localPort: number,
  requestData: RequestData
): Promise<ResponseData> {
  return new Promise((resolve, reject) => {
    const { method, path, headers, body } = requestData

    // Remove hop-by-hop headers that shouldn't be forwarded
    const cleanHeaders: Record<string, string> = { ...headers }
    delete cleanHeaders.connection
    delete cleanHeaders.upgrade
    delete cleanHeaders['proxy-connection']
    delete cleanHeaders['transfer-encoding']
    delete cleanHeaders.host // Don't forward original host - can confuse local routing
    delete cleanHeaders['content-length'] // Will be set based on actual body bytes
    delete cleanHeaders['keep-alive']
    delete cleanHeaders.te
    delete cleanHeaders.trailer

    // Handle request body - support binary (base64) encoding from proxy
    // Headers are case-insensitive, so check common variations
    const encoding =
      headers['x-openserv-encoding'] ??
      headers['X-OpenServ-Encoding'] ??
      headers['X-Openserv-Encoding']

    // Handle body: undefined means no body, null/empty string means empty body
    const bodyBuffer =
      body === undefined
        ? undefined
        : encoding === 'base64'
          ? Buffer.from(body, 'base64')
          : Buffer.from(body, 'utf8')

    // Always set content-length when body field exists (even if empty)
    // This ensures POST/PUT with empty body get Content-Length: 0
    if (bodyBuffer !== undefined) {
      cleanHeaders['content-length'] = String(bodyBuffer.length)
    }

    // Remove encoding headers after processing - they're not for the local agent
    delete cleanHeaders['x-openserv-encoding']
    delete cleanHeaders['X-OpenServ-Encoding']
    delete cleanHeaders['X-Openserv-Encoding']

    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: localPort,
      path: path,
      method: method,
      headers: cleanHeaders,
      agent: localAgent
    }

    const req = http.request(options, res => {
      const chunks: Buffer[] = []
      let totalSize = 0
      let responseTooLarge = false

      res.on('data', (chunk: Buffer) => {
        if (responseTooLarge) return

        totalSize += chunk.length
        if (totalSize > MAX_RESPONSE_SIZE) {
          responseTooLarge = true
          req.destroy()
          reject(
            new Error(`Response too large (exceeds ${MAX_RESPONSE_SIZE / 1024 / 1024}MB limit)`)
          )
          return
        }
        chunks.push(chunk)
      })

      res.on('error', (error: Error) => {
        reject(new Error(`Response stream error: ${error.message}`))
      })

      res.on('end', () => {
        if (!responseTooLarge) {
          const responseBuffer = Buffer.concat(chunks)
          const contentType = res.headers['content-type'] || ''

          // Check if content is text-based (can be safely converted to string)
          const isTextContent =
            contentType.includes('text/') ||
            contentType.includes('application/json') ||
            contentType.includes('application/xml') ||
            contentType.includes('application/javascript') ||
            contentType.includes('+json') ||
            contentType.includes('+xml')

          // For text content, convert to UTF-8 string; for binary, use base64
          const responseBody = isTextContent
            ? responseBuffer.toString('utf8')
            : responseBuffer.toString('base64')

          // Build clean response headers - strip hop-by-hop headers
          const responseHeaders: Record<string, string | string[] | undefined> = {
            ...(res.headers as Record<string, string | string[] | undefined>)
          }
          // Remove hop-by-hop headers that shouldn't be forwarded back
          delete responseHeaders.connection
          delete responseHeaders['keep-alive']
          delete responseHeaders['transfer-encoding']
          delete responseHeaders.te
          delete responseHeaders.trailer
          delete responseHeaders.upgrade
          // Remove original content-length - will be recalculated based on actual body
          delete responseHeaders['content-length']

          // Set correct content-length based on the (possibly re-encoded) body
          const bodyBytes = Buffer.byteLength(responseBody, 'utf8')
          responseHeaders['content-length'] = String(bodyBytes)

          // Add encoding header for binary responses
          if (!isTextContent) {
            responseHeaders['x-openserv-encoding'] = 'base64'
          }

          resolve({
            status: res.statusCode || 500,
            headers: responseHeaders,
            body: responseBody
          })
        }
      })
    })

    req.on('error', (error: Error) => {
      reject(new Error(`Local agent connection failed: ${error.message}`))
    })

    // Use explicit setTimeout for more reliable timeout handling
    // Node's options.timeout behavior can be subtle
    req.setTimeout(120000, () => {
      req.destroy(new Error('Request to local agent timed out'))
    })

    if (bodyBuffer !== undefined) {
      req.write(bodyBuffer)
    }

    req.end()
  })
}

// ============================================================================
// OpenServ Tunnel
// ============================================================================

/**
 * OpenServ Tunnel
 *
 * Connects local agent servers to the OpenServ proxy service.
 *
 * @example
 * ```typescript
 * const tunnel = new OpenServTunnel({
 *   apiKey: process.env.OPENSERV_API_KEY
 * })
 *
 * await tunnel.start(7378)
 * console.log('Tunnel connected')
 *
 * // Later...
 * await tunnel.stop()
 * ```
 */
export class OpenServTunnel {
  // Configuration
  private proxyUrl: string
  private apiKey: string
  private localPort: number = 0

  // WebSocket connection
  private ws: WebSocket | null = null

  // State machine
  private state: TunnelState = 'idle'
  private context: TunnelContext = {
    reconnectAttempts: 0,
    disconnectedAt: null,
    hasConnectedOnce: false,
    lastError: null
  }

  // Timers (managed by state machine)
  private delayTimeoutId: ReturnType<typeof setTimeout> | null = null
  private ackTimeoutId: ReturnType<typeof setTimeout> | null = null

  // Pending promises for async operations
  private pendingStart: {
    resolve: () => void
    reject: (error: Error) => void
  } | null = null
  private pendingGracefulReconnect: {
    resolve: () => void
    reject: (error: Error) => void
  } | null = null
  private pendingStop: {
    resolve: () => void
  } | null = null

  // Callbacks
  private onConnected?: (isReconnect: boolean) => void | Promise<void>
  private onRequest?: (method: string, path: string) => void
  private onError?: (error: Error) => void

  constructor(options: OpenServTunnelOptions = {}) {
    this.proxyUrl = options.proxyUrl || DEFAULT_PROXY_URL
    this.apiKey = options.apiKey || process.env.OPENSERV_API_KEY || ''
    this.onConnected = options.onConnected
    this.onRequest = options.onRequest
    this.onError = options.onError
  }

  // ============================================================================
  // State Machine Core
  // ============================================================================

  /**
   * Get the current state of the tunnel.
   */
  getState(): TunnelState {
    return this.state
  }

  /**
   * Attempt to transition to a new state based on an event.
   * Returns true if the transition was valid and executed, false otherwise.
   */
  private transition(event: TunnelEvent): boolean {
    const validTransitions = VALID_TRANSITIONS[this.state]
    const nextState = validTransitions[event]

    if (!nextState) {
      // Invalid transition - log and ignore
      logger.warn(`Invalid transition: ${this.state} + ${event} (no valid target state)`)
      return false
    }

    const previousState = this.state
    logger.debug(`State transition: ${previousState} -> ${nextState} (${event})`)

    // Exit current state
    this.exitState(previousState)

    // Update state
    this.state = nextState

    // Enter new state
    this.enterState(nextState, event, previousState)

    return true
  }

  /**
   * Actions to perform when exiting a state.
   */
  private exitState(state: TunnelState): void {
    switch (state) {
      case 'reconnect_delay':
        // Clear delay timer when leaving reconnect_delay state
        if (this.delayTimeoutId) {
          clearTimeout(this.delayTimeoutId)
          this.delayTimeoutId = null
        }
        break

      case 'awaiting_reconnect_ack':
        // Clear ack timeout when leaving awaiting_reconnect_ack state
        if (this.ackTimeoutId) {
          clearTimeout(this.ackTimeoutId)
          this.ackTimeoutId = null
        }
        break
    }
  }

  /**
   * Actions to perform when entering a state.
   */
  private enterState(state: TunnelState, _event: TunnelEvent, previousState: TunnelState): void {
    switch (state) {
      case 'starting':
        this.doStarting()
        break

      case 'connecting':
        this.doConnect()
        break

      case 'authenticating':
        this.doAuthenticate()
        break

      case 'connected':
        void this.doConnected()
        break

      case 'awaiting_reconnect_ack':
        this.doAwaitReconnectAck()
        break

      case 'reconnect_delay':
        this.doReconnectDelay(previousState)
        break

      case 'stopping':
        this.doStopping()
        break

      case 'failed':
        this.doFailed()
        break

      case 'stopped':
        this.doStopped()
        break
    }
  }

  // ============================================================================
  // State Entry Actions
  // ============================================================================

  /**
   * Entry action for 'starting' state: validate and initialize.
   * Resets context and validates API key before proceeding to connect.
   */
  private doStarting(): void {
    // Reset context for fresh start
    this.context = {
      reconnectAttempts: 0,
      disconnectedAt: null,
      hasConnectedOnce: false,
      lastError: null
    }

    // Validate API key
    if (!this.apiKey) {
      logger.error(
        'API key is required. Set OPENSERV_API_KEY environment variable or pass apiKey option.'
      )
      this.context.lastError = new Error('API key is required')
      this.transition('SETUP_FAILED')
      return
    }

    // Proceed to connecting
    this.transition('SETUP_COMPLETE')
  }

  /**
   * Entry action for 'connecting' state: create WebSocket connection.
   */
  private doConnect(): void {
    this.setupWebSocket()
  }

  /**
   * Entry action for 'authenticating' state: send auth message.
   */
  private doAuthenticate(): void {
    const authMessage = {
      type: 'auth',
      apiKey: this.apiKey,
      localPort: this.localPort
    }
    this.ws?.send(JSON.stringify(authMessage))
    logger.info('Authenticating...')
  }

  /**
   * Entry action for 'connected' state: resolve promises, call callbacks.
   */
  private async doConnected(): Promise<void> {
    // Reset reconnect attempts on successful connection
    this.context.reconnectAttempts = 0

    const isReconnect = this.context.hasConnectedOnce

    if (isReconnect) {
      if (this.context.disconnectedAt) {
        const duration = ((Date.now() - this.context.disconnectedAt) / 1000).toFixed(2)
        logger.info(`Tunnel reconnected (${duration}s)`)
        this.context.disconnectedAt = null
      } else {
        logger.info('Tunnel reconnected')
      }
    } else {
      logger.info('Tunnel connected')
      this.context.hasConnectedOnce = true
    }

    // Resolve pending promises
    this.pendingStart?.resolve()
    this.pendingStart = null

    this.pendingGracefulReconnect?.resolve()
    this.pendingGracefulReconnect = null

    // Call user callback
    await this.onConnected?.(isReconnect)
  }

  /**
   * Entry action for 'awaiting_reconnect_ack' state: send will-reconnect and start timeout.
   */
  private doAwaitReconnectAck(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // WebSocket not available, go directly to reconnect_delay
      this.transition('ACK_TIMEOUT')
      return
    }

    logger.info('Initiating graceful reconnection...')
    this.ws.send(JSON.stringify({ type: 'will-reconnect' }))
    logger.info('Sent will-reconnect to server...')

    // Start timeout for ack
    this.ackTimeoutId = setTimeout(() => {
      logger.info('Will-reconnect ack timeout, proceeding with reconnection')
      this.transition('ACK_TIMEOUT')
    }, 2000)
  }

  /**
   * Entry action for 'reconnect_delay' state: calculate backoff and start timer.
   */
  private doReconnectDelay(previousState: TunnelState): void {
    // Track when we disconnected
    if (!this.context.disconnectedAt) {
      this.context.disconnectedAt = Date.now()
    }

    // Increment reconnect attempts
    this.context.reconnectAttempts++

    // Check if max retries reached
    if (this.context.reconnectAttempts > MAX_RECONNECTION_ATTEMPTS) {
      this.context.lastError = new Error('Max reconnection attempts reached')
      logger.error(this.context.lastError.message)
      // Transition to failed via proper state machine
      this.transition('MAX_RETRIES')
      return
    }

    // Calculate backoff delay: first attempt is instant, then exponential
    const delay =
      this.context.reconnectAttempts === 1
        ? 0
        : Math.min(1000 * 2 ** (this.context.reconnectAttempts - 2), 30000)

    if (delay === 0) {
      logger.info(
        `Reconnection attempt ${this.context.reconnectAttempts}/${MAX_RECONNECTION_ATTEMPTS} (instant)...`
      )
    } else {
      logger.info(
        `Reconnection attempt ${this.context.reconnectAttempts}/${MAX_RECONNECTION_ATTEMPTS} in ${delay / 1000}s...`
      )
    }

    // Close WebSocket if still open (graceful reconnect case)
    if (previousState === 'awaiting_reconnect_ack' && this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }

    // Start delay timer
    this.delayTimeoutId = setTimeout(() => {
      this.transition('DELAY_COMPLETE')
    }, delay)
  }

  /**
   * Entry action for 'stopping' state: clean up resources.
   * Handles async WebSocket cleanup and transitions to 'stopped' when done.
   */
  private doStopping(): void {
    // Clear any pending timers
    if (this.delayTimeoutId) {
      clearTimeout(this.delayTimeoutId)
      this.delayTimeoutId = null
    }
    if (this.ackTimeoutId) {
      clearTimeout(this.ackTimeoutId)
      this.ackTimeoutId = null
    }

    // If no WebSocket, cleanup is instant
    if (!this.ws) {
      this.transition('CLEANUP_COMPLETE')
      return
    }

    // Async WebSocket cleanup
    this.ws.removeAllListeners()
    const ws = this.ws
    this.ws = null
    ws.close()

    const onCleanupComplete = () => {
      clearTimeout(terminateTimeout)
      this.transition('CLEANUP_COMPLETE')
    }

    const terminateTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        logger.warn('WebSocket close timed out, forcing termination')
        ws.terminate()
      }
      onCleanupComplete()
    }, WS_TERMINATE_TIMEOUT)

    ws.once('close', onCleanupComplete)
    ws.once('error', onCleanupComplete)
  }

  /**
   * Entry action for 'failed' state: reject promises, call error callback.
   */
  private doFailed(): void {
    const error = this.context.lastError || new Error('Tunnel failed')

    // Close WebSocket if still open (e.g., auth failure case)
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }

    // Reject pending promises
    this.pendingStart?.reject(error)
    this.pendingStart = null

    this.pendingGracefulReconnect?.reject(error)
    this.pendingGracefulReconnect = null

    // Call error callback
    this.onError?.(error)
  }

  /**
   * Entry action for 'stopped' state: resolve/reject pending promises.
   * Cleanup has already been done in 'stopping' state.
   */
  private doStopped(): void {
    // Resolve graceful reconnect (intentional stop)
    this.pendingGracefulReconnect?.resolve()
    this.pendingGracefulReconnect = null

    // Reject pending start with clear message
    if (this.pendingStart) {
      this.pendingStart.reject(new Error('Tunnel stopped'))
      this.pendingStart = null
    }

    // Resolve pendingStop
    this.pendingStop?.resolve()
    this.pendingStop = null

    logger.info('Tunnel stopped')
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Start the tunnel and connect to the proxy.
   * @param port - The local port to expose
   */
  async start(port: number): Promise<void> {
    this.localPort = port

    return new Promise<void>((resolve, reject) => {
      // Set pendingStart BEFORE transition so doFailed() can reject it
      // (transition is synchronous and may reach 'failed' state immediately)
      this.pendingStart = { resolve, reject }

      if (!this.transition('START')) {
        this.pendingStart = null
        reject(new Error(`Cannot start tunnel from state: ${this.state}`))
      }
    })
  }

  /**
   * Stop the tunnel and clean up resources.
   * Returns a promise that resolves when cleanup is complete.
   */
  async stop(): Promise<void> {
    // If already stopped, return immediately
    if (this.state === 'stopped') {
      return
    }

    // If already stopping, wait for existing stop to complete
    if (this.state === 'stopping') {
      return new Promise<void>(resolve => {
        // Chain onto existing pendingStop
        const existing = this.pendingStop
        if (existing) {
          const originalResolve = existing.resolve
          existing.resolve = () => {
            originalResolve()
            resolve()
          }
        } else {
          // Shouldn't happen, but handle gracefully
          resolve()
        }
      })
    }

    return new Promise<void>(resolve => {
      // Set pendingStop BEFORE transition so doStopped() can resolve it
      // (transition may reach 'stopped' synchronously from idle or when no WebSocket)
      this.pendingStop = { resolve }

      if (!this.transition('STOP')) {
        this.pendingStop = null
        resolve()
      }
    })
  }

  /**
   * Check if the tunnel is currently connected and authenticated.
   * Returns true only after the tunnel has successfully registered with the proxy.
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  // ============================================================================
  // WebSocket Setup and Event Handlers
  // ============================================================================

  private setupWebSocket(): void {
    // Clean up old WebSocket if it exists (defensive - shouldn't happen with proper state machine)
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }

    const wsUrl = this.proxyUrl.replace(/^http/, 'ws') + '/ws'

    const wsOptions = {
      headers: {
        'User-Agent': 'OpenServ-Tunnel-Client/2.0.0'
      }
    }

    this.ws = new WebSocket(wsUrl, wsOptions)

    this.ws.on('open', () => this.handleWsOpen())
    this.ws.on('ping', (data: Buffer) => this.ws?.pong(data))
    this.ws.on('message', (data: WebSocket.RawData) => this.handleWsMessage(data))
    this.ws.on('close', (code: number, reason: Buffer) => this.handleWsClose(code, reason))
    this.ws.on('error', (error: Error) => this.handleWsError(error))
  }

  /**
   * Handle WebSocket 'open' event - dispatch WS_OPEN event.
   */
  private handleWsOpen(): void {
    this.transition('WS_OPEN')
  }

  /**
   * Handle WebSocket 'message' event - dispatch appropriate events based on message type.
   */
  private async handleWsMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const message: TunnelMessage = JSON.parse(data.toString())

      switch (message.type) {
        case 'error':
          this.handleProtocolError(message)
          break
        case 'registered':
          this.transition('AUTH_SUCCESS')
          break
        case 'will-reconnect-ack':
          this.handleReconnectAck(message.data as { bufferTimeout: number })
          break
        case 'request':
          await this.handleRequest(message.data as RequestData)
          break
      }
    } catch (error) {
      logger.error(`Error processing message: ${(error as Error).message}`)
    }
  }

  /**
   * Handle protocol-level error message from server.
   */
  private handleProtocolError(message: TunnelMessage): void {
    const errorMessage = message.message || 'Unknown tunnel error'
    this.logTunnelError(message)
    this.context.lastError = new Error(errorMessage)
    this.transition('AUTH_ERROR')
  }

  /**
   * Handle will-reconnect-ack message from server.
   */
  private handleReconnectAck(data: { bufferTimeout: number }): void {
    logger.info(`Server acknowledged will-reconnect, buffer timeout: ${data.bufferTimeout}ms`)
    this.transition('RECONNECT_ACK')
  }

  /**
   * Handle incoming request through the tunnel.
   */
  private async handleRequest(requestData: RequestData): Promise<void> {
    this.onRequest?.(requestData.method, requestData.path)
    await this.forwardRequest(requestData)
  }

  /**
   * Handle WebSocket 'close' event - dispatch WS_CLOSE event.
   */
  private handleWsClose(code: number, reason: Buffer): void {
    logger.info(`Disconnected: ${code} ${reason.toString()}`)
    this.ws = null
    this.transition('WS_CLOSE')
  }

  /**
   * Handle WebSocket 'error' event - dispatch WS_ERROR event (informational).
   */
  private handleWsError(error: Error): void {
    logger.error(`Connection error: ${error.message}`)
    this.context.lastError = error

    if (!this.context.disconnectedAt) {
      this.context.disconnectedAt = Date.now()
    }

    this.logConnectionErrorHint(error)
    this.onError?.(error)

    // Dispatch event (close will follow, which handles actual state transition)
    this.transition('WS_ERROR')
  }

  private logTunnelError(message: TunnelMessage): void {
    if (message.error === 'AUTH_TIMEOUT' || message.error === 'AUTH_REQUIRED') {
      logger.error(`Authentication error: ${message.message}`)
    } else if (message.error === 'AUTHENTICATION_FAILED' || message.error === 'AUTH_FAILED') {
      logger.error(`Authentication failed: ${message.message}`)
      logger.info('Check your API key')
    } else {
      logger.error(`Tunnel error: ${message.message}`)
    }
  }

  private logConnectionErrorHint(error: Error): void {
    if (error.message.includes('protocol error')) {
      logger.info('This may be a temporary issue. Retrying...')
    } else if (error.message.includes('upstream connect error')) {
      logger.info('The proxy server may be starting up. Retrying...')
    } else if (error.message.includes('400')) {
      logger.info('Server rejected connection. Check your proxy URL.')
    } else if ((error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
      logger.info('DNS resolution failed. Check your proxy URL.')
    } else if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      logger.info('Connection refused. Is the proxy server running?')
    }
  }

  // ============================================================================
  // Request Forwarding
  // ============================================================================

  private async forwardRequest(requestData: RequestData): Promise<void> {
    const sendResponse = (responseData: {
      id: string
      status: number
      headers: Record<string, string | string[] | undefined>
      body: string
    }) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'response',
            data: responseData
          })
        )
      } else {
        logger.warn(`Cannot send response for request ${responseData.id}: WebSocket not open`)
      }
    }

    try {
      const response = await forwardToLocalAgent(this.localPort, requestData)

      sendResponse({
        id: requestData.id,
        status: response.status,
        headers: response.headers,
        body: response.body
      })
    } catch (error) {
      logger.error(`Error forwarding request: ${(error as Error).message}`)

      sendResponse({
        id: requestData.id,
        status: 502,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Bad Gateway',
          message: (error as Error).message
        })
      })
    }
  }

  /**
   * Initiate a graceful reconnection to the proxy server.
   * This notifies the server before disconnecting, allowing it to buffer requests.
   * Returns a promise that resolves when the reconnection is complete.
   */
  async gracefulReconnect(): Promise<void> {
    // Only valid from connected state
    if (this.state !== 'connected') {
      logger.warn(`Cannot graceful reconnect from state: ${this.state}`)
      return Promise.resolve()
    }

    // If there's already a graceful reconnect in progress, wait for it
    if (this.pendingGracefulReconnect) {
      return new Promise((resolve, reject) => {
        const existing = this.pendingGracefulReconnect!
        const originalResolve = existing.resolve
        const originalReject = existing.reject
        existing.resolve = () => {
          originalResolve()
          resolve()
        }
        existing.reject = (error: Error) => {
          originalReject(error)
          reject(error)
        }
      })
    }

    // Reset reconnect attempts for fresh graceful reconnect
    this.context.reconnectAttempts = 0

    // Create promise that will be resolved when reconnected
    return new Promise<void>((resolve, reject) => {
      this.pendingGracefulReconnect = { resolve, reject }
      this.transition('GRACEFUL_RECONNECT')
    })
  }
}
