import { Agent } from '../src/agent'
import { z } from 'zod'

// Create an agent with WebSocket connectivity
const agent = new Agent({
  systemPrompt: `You are a helpful assistant that can perform various tasks.
  You can get the current time, generate random numbers, and help with calculations.
  Always be helpful and provide accurate information.`,

  // OpenAI API key for processing conversations
  openaiApiKey: process.env.OPENAI_API_KEY,

  // OpenServ API key for platform integration
  apiKey: process.env.OPENSERV_API_KEY
})

// Add a capability to get current time
agent.addCapability({
  name: 'get_current_time',
  description: 'Get the current date and time',
  schema: z.object({
    timezone: z.string().optional().describe('Timezone to get time for (e.g., "America/New_York")')
  }),
  run: async ({ args }) => {
    const options: Intl.DateTimeFormatOptions = {
      timeZoneName: 'short',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }

    if (args.timezone) {
      options.timeZone = args.timezone
    }

    const now = new Date()
    return now.toLocaleString('en-US', options)
  }
})

// Add a capability to generate random numbers
agent.addCapability({
  name: 'generate_random_number',
  description: 'Generate a random number within a specified range',
  schema: z.object({
    min: z.number().describe('Minimum value (inclusive)'),
    max: z.number().describe('Maximum value (inclusive)')
  }),
  run: async ({ args }) => {
    const { min, max } = args
    if (min > max) {
      throw new Error('Minimum value cannot be greater than maximum value')
    }

    const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min
    return `Generated random number: ${randomNumber}`
  }
})

// Add a capability to perform calculations
agent.addCapability({
  name: 'calculate',
  description: 'Perform basic mathematical calculations',
  schema: z.object({
    expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 3 * 4")')
  }),
  run: async ({ args }) => {
    try {
      // Simple expression evaluation (in production, use a proper math library)
      // This is a basic example - for security, use a proper math expression parser
      const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '')
      if (sanitized !== args.expression) {
        throw new Error('Invalid characters in expression')
      }

      // eslint-disable-next-line no-eval
      const result = eval(sanitized)
      return `${args.expression} = ${result}`
    } catch (error) {
      throw new Error(
        `Calculation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
})

// Start the agent
async function startAgent() {
  try {
    console.log('Starting WebSocket agent...')
    await agent.start()

    // The agent will now connect to the OpenServ proxy via WebSocket
    // and be available at the public URL provided by the proxy

    // Wait a bit for the connection to be established
    setTimeout(() => {
      const publicUrl = agent.getPublicUrl()
      const tunnelId = agent.getTunnelId()

      if (publicUrl) {
        console.log('\n✅ Agent is now available at:', publicUrl)
        console.log('🔗 Tunnel ID:', tunnelId)
        console.log('\n📝 You can use this URL in the OpenServ Platform to connect to your agent.')
        console.log('🔄 If you need to reconnect later, use the tunnel ID to restore the same URL.')

        // Example of how to reconnect with the same tunnel ID:
        console.log('\n💡 To reconnect with the same tunnel ID, set the environment variable:')
        console.log(`   OPENSERV_TUNNEL_ID=${tunnelId}`)
      }
    }, 2000)
  } catch (error) {
    console.error('❌ Failed to start agent:', error)
    process.exit(1)
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down agent...')
  await agent.stop()
  console.log('✅ Agent stopped')
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down agent...')
  await agent.stop()
  console.log('✅ Agent stopped')
  process.exit(0)
})

// Check required environment variables
if (!process.env.OPENSERV_API_KEY) {
  console.error('❌ OPENSERV_API_KEY environment variable is required')
  console.log('Get your API key from the OpenServ Platform: https://platform.openserv.ai')
  process.exit(1)
}

if (!process.env.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable is required')
  console.log('Get your OpenAI API key from: https://platform.openai.com/api-keys')
  process.exit(1)
}

// Start the agent
startAgent()
