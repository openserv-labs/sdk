import pino from 'pino'
import { config } from './config.instance'

export const createLogger = () =>
  pino({
    name: 'openserv-agent',
    level: config.LOG_LEVEL
  })

export const logger = createLogger()
