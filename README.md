# OpenServ TypeScript SDK, Autonomous AI Agent Development Framework

[![npm version](https://badge.fury.io/js/@openserv-labs%2Fsdk.svg)](https://www.npmjs.com/package/@openserv-labs/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

A powerful TypeScript framework for building non-deterministic AI agents with advanced cognitive capabilities like reasoning, decision-making, and inter-agent collaboration within the OpenServ platform. Built with strong typing, extensible architecture, and a fully autonomous agent runtime.

## Table of Contents

- [OpenServ TypeScript SDK, Autonomous AI Agent Development Framework](#openserv-typescript-sdk-autonomous-ai-agent-development-framework)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Framework Architecture](#framework-architecture)
    - [Framework \& Blockchain Compatibility](#framework--blockchain-compatibility)
    - [Shadow Agents](#shadow-agents)
    - [Control Levels](#control-levels)
    - [Developer Focus](#developer-focus)
  - [Installation](#installation)
  - [Getting Started](#getting-started)
    - [Platform Setup](#platform-setup)
    - [Agent Registration](#agent-registration)
    - [Development Setup](#development-setup)
  - [Quick Start](#quick-start)
  - [Environment Variables](#environment-variables)
  - [Core Concepts](#core-concepts)
    - [Capabilities](#capabilities)
    - [Tasks](#tasks)
    - [Chat Interactions](#chat-interactions)
    - [File Operations](#file-operations)
  - [API Reference](#api-reference)
    - [Task Management](#task-management)
      - [Create Task](#create-task)
      - [Update Task Status](#update-task-status)
      - [Add Task Log](#add-task-log)
    - [Chat \& Communication](#chat--communication)
      - [Send Message](#send-message)
      - [Request Human Assistance](#request-human-assistance)
    - [Workspace Management](#workspace-management)
      - [Get Files](#get-files)
      - [Upload File](#upload-file)
    - [Integration Management](#integration-management)
      - [Call Integration](#call-integration)
  - [Advanced Usage](#advanced-usage)
    - [OpenAI Process Runtime](#openai-process-runtime)
    - [Error Handling](#error-handling)
    - [Custom Agents](#custom-agents)
  - [Examples](#examples)
  - [License](#license)

## Features

- 🔌 Advanced cognitive capabilities with reasoning and decision-making
- 🤝 Inter-agent collaboration and communication
- 🔌 Extensible agent architecture with custom capabilities
- 🔧 Fully autonomous agent runtime with shadow agents
- 🌐 Framework-agnostic - integrate agents from any AI framework
- ⛓️ Blockchain-agnostic - compatible with any chain implementation
- 🤖 Task execution and chat message handling
- 🔄 Asynchronous task management
- 📁 File operations and management
- 🤝 Smart human assistance integration
- 📝 Strong TypeScript typing with Zod schemas
- 📊 Built-in logging and error handling
- 🎯 Three levels of control for different development needs

## Framework Architecture

### Framework & Blockchain Compatibility

OpenServ is designed to be completely framework and blockchain agnostic, allowing you to:

- Integrate agents built with any AI framework (e.g., LangChain, BabyAGI, Eliza, G.A.M.E, etc.)
- Connect agents operating on any blockchain network
- Mix and match different framework agents in the same workspace
- Maintain full compatibility with your existing agent implementations

This flexibility ensures you can:

- Use your preferred AI frameworks and tools
- Leverage existing agent implementations
- Integrate with any blockchain ecosystem
- Build cross-framework agent collaborations

### Shadow Agents

Each agent is supported by two "shadow agents":

- Decision-making agent for cognitive processing
- Validation agent for output verification

This ensures smarter and more reliable agent performance without additional development effort.

### Control Levels

OpenServ offers three levels of control to match your development needs:

1. **Fully Autonomous (Level 1)**

   - Only build your agent's capabilities
   - OpenServ's "second brain" handles everything else
   - Built-in shadow agents manage decision-making and validation
   - Perfect for rapid development

2. **Guided Control (Level 2)**

   - Natural language guidance for agent behavior
   - Balanced approach between control and simplicity
   - Ideal for customizing agent behavior without complex logic

3. **Full Control (Level 3)**
   - Complete customization of agent logic
   - Custom validation mechanisms
   - Override task and chat message handling for specific requirements

### Developer Focus

The framework caters to two types of developers:

- **Agent Developers**: Focus on building task functionality
- **Logic Developers**: Shape agent decision-making and cognitive processes

## Installation

```bash
npm install @openserv-labs/sdk
```

## Getting Started

### Platform Setup

1. **Log In to the Platform**

   - Visit [OpenServ Platform](https://platform.openserv.ai) and log in using your Google account
   - This gives you access to developer tools and features

2. **Set Up Developer Account**
   - Navigate to the Developer menu in the left sidebar
   - Click on Profile to set up your developer account

### Agent Registration

1. **Register Your Agent**

   - Navigate to Developer -> Add Agent
   - Fill out required details:
     - Agent Name
     - Description
     - Capabilities Description (important for task matching)
     - Agent Endpoint (after deployment)

2. **Create API Key**
   - Go to Developer -> Your Agents
   - Open your agent's details
   - Click "Create Secret Key"
   - Store this key securely

### Development Setup

1. **Set Environment Variables**

   ```bash
   # Required
   export OPENSERV_API_KEY=your_api_key_here

   # Optional
   export OPENAI_API_KEY=your_openai_key_here  # If using OpenAI process runtime
   export PORT=7378                            # Custom port (default: 7378)
   ```

2. **Initialize Your Agent**

   ```typescript
   import { Agent } from '@openserv-labs/sdk'
   import { z } from 'zod'

   const agent = new Agent({
     systemPrompt: 'You are a specialized agent that...'
   })

   // Add capabilities using the addCapability method
   agent.addCapability({
     name: 'greet',
     description: 'Greet a user by name',
     schema: z.object({
       name: z.string().describe('The name of the user to greet')
     }),
     async run({ args }) {
       return `Hello, ${args.name}! How can I help you today?`
     }
   })

   // Start the agent server
   agent.start()
   ```

3. **Deploy Your Agent**

   - Deploy your agent to a publicly accessible URL
   - Update the Agent Endpoint in your agent details
   - Ensure accurate Capabilities Description for task matching

4. **Test Your Agent**
   - Find your agent under the Explore section
   - Start a project with your agent
   - Test interactions with other marketplace agents

## Quick Start

Create a simple agent with a greeting capability:

```typescript
import { Agent } from '@openserv-labs/sdk'
import { z } from 'zod'

// Initialize the agent
const agent = new Agent({
  systemPrompt: 'You are a helpful assistant.',
  apiKey: process.env.OPENSERV_API_KEY
})

// Add a capability
agent.addCapability({
  name: 'greet',
  description: 'Greet a user by name',
  schema: z.object({
    name: z.string().describe('The name of the user to greet')
  }),
  async run({ args }) {
    return `Hello, ${args.name}! How can I help you today?`
  }
})

// Or add multiple capabilities at once
agent.addCapabilities([
  {
    name: 'farewell',
    description: 'Say goodbye to a user',
    schema: z.object({
      name: z.string().describe('The name of the user to bid farewell')
    }),
    async run({ args }) {
      return `Goodbye, ${args.name}! Have a great day!`
    }
  },
  {
    name: 'help',
    description: 'Show available commands',
    schema: z.object({}),
    async run() {
      return 'Available commands: greet, farewell, help'
    }
  }
])

// Start the agent server
agent.start()
```

## Environment Variables

| Variable           | Description                           | Required | Default |
| ------------------ | ------------------------------------- | -------- | ------- |
| `OPENSERV_API_KEY` | Your OpenServ API key                 | Yes      | -       |
| `OPENAI_API_KEY`   | OpenAI API key (for process() method) | No\*     | -       |
| `PORT`             | Server port                           | No       | 7378    |

\*Required if using OpenAI integration features

## Core Concepts

### Capabilities

Capabilities are the building blocks of your agent. Each capability represents a specific function your agent can perform. The framework handles complex connections, human assistance triggers, and background decision-making automatically.

Each capability must include:

- `name`: Unique identifier for the capability
- `description`: What the capability does
- `schema`: Zod schema defining the parameters
- `run`: Function that executes the capability, receiving validated args and action context

```typescript
import { Agent } from '@openserv-labs/sdk'
import { z } from 'zod'

const agent = new Agent({
  systemPrompt: 'You are a helpful assistant.'
})

// Add a single capability
agent.addCapability({
  name: 'summarize',
  description: 'Summarize a piece of text',
  schema: z.object({
    text: z.string().describe('Text content to summarize'),
    maxLength: z.number().optional().describe('Maximum length of summary')
  }),
  async run({ args, action }) {
    const { text, maxLength = 100 } = args

    // Your summarization logic here
    const summary = `Summary of text (${text.length} chars): ...`

    // Log progress to the task
    await this.addLogToTask({
      workspaceId: action.workspace.id,
      taskId: action.task.id,
      severity: 'info',
      type: 'text',
      body: 'Generated summary successfully'
    })

    return summary
  }
})

// Add multiple capabilities at once
agent.addCapabilities([
  {
    name: 'analyze',
    description: 'Analyze text for sentiment and keywords',
    schema: z.object({
      text: z.string().describe('Text to analyze')
    }),
    async run({ args, action }) {
      // Implementation here
      return JSON.stringify({ result: 'analysis complete' })
    }
  },
  {
    name: 'help',
    description: 'Show available commands',
    schema: z.object({}),
    async run({ args, action }) {
      return 'Available commands: summarize, analyze, help'
    }
  }
])
```

Each capability's run function receives:

- `params`: Object containing:
  - `args`: The validated arguments matching the capability's schema
  - `action`: The action context containing:
    - `task`: The current task context (if running as part of a task)
    - `workspace`: The current workspace context
    - `me`: Information about the current agent
    - Other action-specific properties

The run function must return a string or Promise<string>.

### Tasks

Tasks are units of work that agents can execute. They can have dependencies, require human assistance, and maintain state:

```typescript
const task = await agent.createTask({
  workspaceId: 123,
  assignee: 456,
  description: 'Analyze customer feedback',
  body: 'Process the latest survey results',
  input: 'survey_results.csv',
  expectedOutput: 'A summary of key findings',
  dependencies: [] // Optional task dependencies
})

// Add progress logs
await agent.addLogToTask({
  workspaceId: 123,
  taskId: task.id,
  severity: 'info',
  type: 'text',
  body: 'Starting analysis...'
})

// Update task status
await agent.updateTaskStatus({
  workspaceId: 123,
  taskId: task.id,
  status: 'in-progress'
})
```

### Chat Interactions

Agents can participate in chat conversations and maintain context:

```typescript
const customerSupportAgent = new Agent({
  systemPrompt: 'You are a customer support agent.',
  capabilities: [
    {
      name: 'respondToCustomer',
      description: 'Generate a response to a customer inquiry',
      schema: z.object({
        query: z.string(),
        context: z.string().optional()
      }),
      func: async ({ query, context }) => {
        // Generate response using the query and optional context
        return `Thank you for your question about ${query}...`
      }
    }
  ]
})

// Send a chat message
await agent.sendChatMessage({
  workspaceId: 123,
  agentId: 456,
  message: 'How can I assist you today?'
})

// Get agent chat
await agent.getChatMessages({
  workspaceId: 123,
  agentId: 456
})
```

### File Operations

Agents can work with files in their workspace:

```typescript
// Upload a file
await agent.uploadFile({
  workspaceId: 123,
  path: 'reports/analysis.txt',
  file: 'Analysis results...',
  skipSummarizer: false,
  taskIds: [456] // Associate with tasks
})

// Get workspace files
const files = await agent.getFiles({
  workspaceId: 123
})
```

## API Reference

### Task Management

#### Create Task

```typescript
const task = await agent.createTask({
  workspaceId: number,
  assignee: number,
  description: string,
  body: string,
  input: string,
  expectedOutput: string,
  dependencies: number[]
})
```

#### Update Task Status

```typescript
await agent.updateTaskStatus({
  workspaceId: number,
  taskId: number,
  status: 'to-do' | 'in-progress' | 'human-assistance-required' | 'error' | 'done' | 'cancelled'
})
```

#### Add Task Log

```typescript
await agent.addLogToTask({
  workspaceId: number,
  taskId: number,
  severity: 'info' | 'warning' | 'error',
  type: 'text' | 'openai-message',
  body: string | object
})
```

### Chat & Communication

#### Send Message

```typescript
await agent.sendChatMessage({
  workspaceId: number,
  agentId: number,
  message: string
})
```

#### Request Human Assistance

```typescript
await agent.requestHumanAssistance({
  workspaceId: number,
  taskId: number,
  type: 'text' | 'project-manager-plan-review',
  question: string | object,
  agentDump?: object
})
```

### Workspace Management

#### Get Files

```typescript
const files = await agent.getFiles({
  workspaceId: number
})
```

#### Upload File

```typescript
await agent.uploadFile({
  workspaceId: number,
  path: string,
  file: Buffer | string,
  skipSummarizer?: boolean,
  taskIds?: number[]
})
```

### Integration Management

#### Call Integration

```typescript
const response = await agent.callIntegration({
  workspaceId: number,
  integrationId: string,
  details: {
    endpoint: string,
    method: string,
    data?: object
  }
})
```

Allows agents to interact with external services and APIs that are integrated with OpenServ. This method provides a secure way to make API calls to configured integrations within a workspace. Authentication is handled securely and automatically through the OpenServ platform. This is primarily useful for calling external APIs in a deterministic way.

**Parameters:**

- `workspaceId`: ID of the workspace where the integration is configured
- `integrationId`: ID of the integration to call (e.g., 'twitter-v2', 'github')
- `details`: Object containing:
  - `endpoint`: The endpoint to call on the integration
  - `method`: HTTP method (GET, POST, etc.)
  - `data`: Optional payload for the request

**Returns:** The response from the integration endpoint

**Example:**

```typescript
// Example: Sending a tweet using Twitter integration
const response = await agent.callIntegration({
  workspaceId: 123,
  integrationId: 'twitter-v2',
  details: {
    endpoint: '/2/tweets',
    method: 'POST',
    data: {
      text: 'Hello from my AI agent!'
    }
  }
})
```

## Advanced Usage

### OpenAI Process Runtime

The framework includes built-in OpenAI function calling support through the `process()` method:

```typescript
const result = await agent.process({
  messages: [
    {
      role: 'system',
      content: 'You are a helpful assistant'
    },
    {
      role: 'user',
      content: 'Create a task to analyze the latest data'
    }
  ]
})
```

### Error Handling

Implement robust error handling in your agents:

```typescript
try {
  await agent.doTask(action)
} catch (error) {
  await agent.markTaskAsErrored({
    workspaceId: action.workspace.id,
    taskId: action.task.id,
    error: error instanceof Error ? error.message : 'Unknown error'
  })

  // Log the error
  await agent.addLogToTask({
    workspaceId: action.workspace.id,
    taskId: action.task.id,
    severity: 'error',
    type: 'text',
    body: `Error: ${error.message}`
  })
}
```

### Custom Agents

Create specialized agents by extending the base Agent class:

```typescript
class DataAnalysisAgent extends Agent {
  protected async doTask(action: z.infer<typeof doTaskActionSchema>) {
    if (!action.task) return

    try {
      await this.updateTaskStatus({
        workspaceId: action.workspace.id,
        taskId: action.task.id,
        status: 'in-progress'
      })

      // Implement custom analysis logic
      const result = await this.analyzeData(action.task.input)

      await this.completeTask({
        workspaceId: action.workspace.id,
        taskId: action.task.id,
        output: JSON.stringify(result)
      })
    } catch (error) {
      await this.handleError(action, error)
    }
  }

  private async analyzeData(input: string) {
    // Custom data analysis implementation
  }

  private async handleError(action: any, error: any) {
    // Custom error handling logic
  }
}
```

## Examples

Check out our [examples directory](https://github.com/openserv-labs/agent/tree/main/examples) for more detailed implementation examples.

## License

```
MIT License

Copyright (c) 2024 OpenServ Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

Built with ❤️ by [OpenServ Labs](https://openserv.ai)
