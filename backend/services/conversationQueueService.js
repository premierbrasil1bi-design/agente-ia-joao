/**
 * Conversation-level queue: messages from the same conversation (channel + senderId + agentId)
 * are processed sequentially to avoid race conditions.
 * In-memory queues per conversationKey.
 */

const queues = new Map();
const processing = new Map();

/**
 * Run a single task and then process the next in queue or mark idle.
 * @param {string} conversationKey
 * @param {() => Promise<void>} task
 */
function runTask(conversationKey, task) {
  (async () => {
    try {
      console.log('[QUEUE] Processing message for conversationKey', conversationKey);
      await task();
    } catch (err) {
      console.error('[QUEUE] Error for conversationKey', conversationKey, err.message);
    } finally {
      const q = queues.get(conversationKey) || [];
      if (q.length > 0) {
        const next = q.shift();
        runTask(conversationKey, next);
      } else {
        processing.set(conversationKey, false);
        console.log('[QUEUE] Finished processing conversationKey', conversationKey);
      }
    }
  })();
}

/**
 * Enqueue a task for the given conversation. If this conversation is not currently
 * processing, the task runs immediately; otherwise it is queued and runs when its turn.
 *
 * @param {string} conversationKey - e.g. "whatsapp:558899999999@s.whatsapp.net:agent-uuid"
 * @param {() => Promise<void>} task - Async function to run (pipeline + send, etc.)
 */
export function enqueueConversationTask(conversationKey, task) {
  if (!conversationKey || typeof task !== 'function') {
    return;
  }

  if (!processing.get(conversationKey)) {
    processing.set(conversationKey, true);
    runTask(conversationKey, task);
  } else {
    if (!queues.has(conversationKey)) {
      queues.set(conversationKey, []);
    }
    queues.get(conversationKey).push(task);
    console.log('[QUEUE] Enqueued message for conversationKey', conversationKey);
  }
}
