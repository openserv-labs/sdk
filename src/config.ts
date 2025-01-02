import { z } from 'zod'
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'

// Check if .env file exists
const envPath = path.resolve(process.cwd(), '.env')
if (!fs.existsSync(envPath)) {
  throw new Error('No .env file found. Please create one based on .env.example')
}

// Load environment variables from .env file
dotenv.config()

export const envSchema = z.object({
  OPENAI_ORGANIZATION: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENSERV_API_KEY: z
    .string({
      required_error:
        'OpenServ API key is required. Please provide it in options or set OPENSERV_API_KEY environment variable.'
    })
    .min(1, 'OpenServ API key cannot be empty'),
  OPENAI_MODEL: z
    .enum([
      'gpt-4o',
      'gpt-4o-2024-08-06',
      'gpt-4o-2024-05-13',
      'gpt-4o-mini',
      'gpt-4o-mini-2024-07-18',
      'gpt-4-turbo',
      'gpt-4-turbo-2024-04-09',
      'gpt-4-turbo-preview',
      'gpt-4-0125-preview',
      'gpt-4-1106-preview',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-0125',
      'gpt-3.5-turbo-1106'
    ])
    .default('gpt-4o'),
  OPENSERV_API_URL: z.string().default('https://api.openserv.ai'),
  OPENSERV_RUNTIME_URL: z.string().default('https://agents.openserv.ai'),
  PORT: z
    .string()
    .optional()
    .transform(val => Number.parseInt(val || '') || 7378),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
})

export type EnvConfig = z.infer<typeof envSchema>

export function validateEnv(env: Record<string, string | undefined> = process.env): EnvConfig {
  try {
    return envSchema.parse(env)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map(err => `${err.path.join('.')}: ${err.message}`)
        .join('\n')
      throw new Error(`Environment validation failed:\n${errorMessages}`)
    }
    throw error
  }
}
