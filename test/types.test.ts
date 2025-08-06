import assert from 'node:assert'
import { describe, test } from 'node:test'
import type {
  UploadFileParams,
  MarkTaskAsErroredParams,
  CompleteTaskParams,
  SendChatMessageParams,
  GetTaskDetailParams,
  GetAgentsParams,
  GetTasksParams,
  CreateTaskParams,
  AddLogToTaskParams,
  RequestHumanAssistanceParams,
  UpdateTaskStatusParams,
  ProcessParams,
  GetChatMessagesParams
} from '../src/types'

describe('Action Schemas', () => {
  test('should validate UploadFileParams with all variations', () => {
    // Test with array of taskIds
    const params1: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      taskIds: [1, 2, 3],
      skipSummarizer: true
    }
    assert.ok(params1)

    // Test with single taskId
    const params2: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      taskIds: 1
    }
    assert.ok(params2)

    // Test with null taskIds
    const params3: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      taskIds: null
    }
    assert.ok(params3)

    // Test with skipSummarizer false
    const params4: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content',
      skipSummarizer: false
    }
    assert.ok(params4)

    // Test with Buffer file
    const params5: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: Buffer.from('test content')
    }
    assert.ok(params5)

    // Test with minimum required fields
    const params6: UploadFileParams = {
      workspaceId: 1,
      path: 'test.txt',
      file: 'test content'
    }
    assert.ok(params6)
  })

  test('should validate MarkTaskAsErroredParams', () => {
    const params: MarkTaskAsErroredParams = {
      workspaceId: 1,
      taskId: 2,
      error: 'Test error message'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
    assert.strictEqual(typeof params.error, 'string')
  })

  test('should validate CompleteTaskParams', () => {
    const params: CompleteTaskParams = {
      workspaceId: 1,
      taskId: 2,
      output: 'Test task output'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
    assert.strictEqual(typeof params.output, 'string')
  })

  test('should validate SendChatMessageParams', () => {
    const params: SendChatMessageParams = {
      workspaceId: 1,
      agentId: 2,
      message: 'Test chat message'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.agentId, 'number')
    assert.strictEqual(typeof params.message, 'string')
  })

  test('should validate GetChatMessagesParams', () => {
    const params: GetChatMessagesParams = {
      workspaceId: 1,
      agentId: 2
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.agentId, 'number')
  })

  test('should validate GetTaskDetailParams', () => {
    const params: GetTaskDetailParams = {
      workspaceId: 1,
      taskId: 2
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
  })

  test('should validate GetAgentsParams', () => {
    const params: GetAgentsParams = {
      workspaceId: 1
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
  })

  test('should validate GetTasksParams', () => {
    const params: GetTasksParams = {
      workspaceId: 1
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
  })

  test('should validate CreateTaskParams', () => {
    const params: CreateTaskParams = {
      workspaceId: 1,
      assignee: 2,
      description: 'Test task',
      body: 'Test body',
      input: 'Test input',
      expectedOutput: 'Test output',
      dependencies: [3, 4]
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.assignee, 'number')
    assert.strictEqual(typeof params.description, 'string')
    assert.strictEqual(typeof params.body, 'string')
    assert.strictEqual(typeof params.input, 'string')
    assert.strictEqual(typeof params.expectedOutput, 'string')
    assert.ok(Array.isArray(params.dependencies))
  })

  test('should validate AddLogToTaskParams', () => {
    const textParams: AddLogToTaskParams = {
      workspaceId: 1,
      taskId: 2,
      severity: 'info',
      type: 'text',
      body: 'Test log message'
    }
    assert.ok(textParams)

    const openaiParams: AddLogToTaskParams = {
      workspaceId: 1,
      taskId: 2,
      severity: 'warning',
      type: 'openai-message',
      body: { role: 'assistant', content: 'Test message' }
    }
    assert.ok(openaiParams)
  })

  test('should validate RequestHumanAssistanceParams', () => {
    const textParams: RequestHumanAssistanceParams = {
      workspaceId: 1,
      taskId: 2,
      type: 'text',
      question: {
        type: 'text',
        question: 'Test question'
      }
    }
    assert.ok(textParams)

    const reviewParams: RequestHumanAssistanceParams = {
      workspaceId: 1,
      taskId: 2,
      type: 'project-manager-plan-review',
      question: { type: 'project-manager-plan-review', tasks: [] },
      agentDump: { data: 'Test data' }
    }
    assert.ok(reviewParams)
  })

  test('should validate UpdateTaskStatusParams', () => {
    const params: UpdateTaskStatusParams = {
      workspaceId: 1,
      taskId: 2,
      status: 'in-progress'
    }
    assert.ok(params)
    assert.strictEqual(typeof params.workspaceId, 'number')
    assert.strictEqual(typeof params.taskId, 'number')
    assert.strictEqual(params.status, 'in-progress')
  })

  test('should validate ProcessParams', () => {
    const params: ProcessParams = {
      messages: [
        { role: 'user', content: 'Test message' },
        { role: 'assistant', content: 'Test response' }
      ]
    }
    assert.ok(params)
    assert.ok(Array.isArray(params.messages))
    assert.strictEqual(params.messages[0].role, 'user')
    assert.strictEqual(params.messages[1].role, 'assistant')
  })
})
