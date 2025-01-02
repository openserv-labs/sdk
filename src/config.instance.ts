// config.instance.ts - Singleton config instance
import { validateEnv } from './config'

export const config = validateEnv()
