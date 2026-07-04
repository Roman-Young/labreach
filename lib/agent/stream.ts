import type { AgentEvent } from '@/types'

export function encodeEvent(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export function createSSEStream(): {
  readable: ReadableStream<Uint8Array>
  emit: (event: AgentEvent) => void
  close: () => void
} {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array>

  const readable = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
    },
  })

  return {
    readable,
    emit(event: AgentEvent) {
      controller.enqueue(encoder.encode(encodeEvent(event)))
    },
    close() {
      controller.close()
    },
  }
}
