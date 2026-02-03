import pino from 'pino'

export const createLogger = () => {
  const isPretty =
    process.env.LOG_PRETTY === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.stdout.isTTY)

  return pino({
    name: 'openserv-agent',
    level: process.env.LOG_LEVEL || 'info',
    transport: isPretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
          }
        }
      : undefined
  })
}

export const logger = createLogger()
