import dotenv from 'dotenv'
dotenv.config()

import { Agent } from '../src'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { logger } from '../src/logger'

const marketingManager = new Agent({
  systemPrompt: fs.readFileSync(path.join(__dirname, './system.md'), 'utf8'),
  apiKey: process.env.OPENSERV_API_KEY
})

marketingManager
  .addCapabilities([
    {
      name: 'createSocialMediaPost',
      description: `Creates a social media post for the specified platform.
Follow these platform-specific guidelines:
- Twitter: Max 280 characters, casual tone, use hashtags
- LinkedIn: Professional tone, industry insights, call to action
- Facebook: Engaging, conversational, can be longer
Include emojis where appropriate. Focus on driving engagement.
Only generate post for the given platform.
Save the post in markdown format as a file and attach it to the task.`,
      inputSchema: z.object({
        platform: z.enum(['twitter', 'linkedin', 'facebook']),
        topic: z.string()
      }),
      async run({ args, action }) {
        const generatedPost = await this.generate({
          prompt: `Create a compelling ${args.platform} post about: ${args.topic}`,
          action
        })

        logger.info(`Generated ${args.platform} post: ${generatedPost}`)

        return generatedPost || 'Failed to generate post'
      }
    },
    {
      name: 'analyzeEngagement',
      description: `Analyzes social media engagement metrics and provides recommendations.
Consider platform-specific benchmarks.
Provide:
1. Current engagement rate
2. Performance assessment (below average, average, above average)
3. Top 3 actionable recommendations to improve engagement
4. Key metrics to focus on for improvement`,
      inputSchema: z.object({
        platform: z.enum(['twitter', 'linkedin', 'facebook']),
        metrics: z.object({
          likes: z.number(),
          shares: z.number(),
          comments: z.number(),
          impressions: z.number()
        })
      }),
      async run({ args, action }) {
        const analysis = await this.generate({
          prompt: `Analyze the engagement metrics for ${args.platform}: ${JSON.stringify(args.metrics)}`,
          action
        })

        logger.info(`Generated engagement analysis for ${args.platform}: ${analysis}`)

        return analysis || 'Failed to analyze engagement'
      }
    }
  ])
  .start()
  .catch(console.error)
