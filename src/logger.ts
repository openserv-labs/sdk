import pino from 'pino'

export const createLogger = () =>
  pino({
    name: 'openserv-agent',
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    }
  })

export const logger = createLogger()
