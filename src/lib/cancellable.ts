// Renderer-side helper for cancellable IPC operations.
//
// AbortSignal can't be passed across the contextBridge (structured clone
// strips its prototype methods), so the renderer holds the
// AbortController and translates `abort` events into
// `window.api.cancelOperation(streamId)` calls. This helper hides the
// boilerplate so each flow stays clean.

export async function withCancellable<T>(
  signal: AbortSignal | undefined,
  fn: (streamId: string) => Promise<T>,
): Promise<T> {
  const streamId = await window.api.makeStreamId();
  if (signal?.aborted) {
    // Pre-aborted: tell main not to bother starting this operation.
    void window.api.cancelOperation(streamId);
    // Throw a cancellation-flavoured error so the caller hits its
    // cancelled branch without making the IPC call at all.
    throw new DOMException("Operation aborted", "AbortError");
  }
  const onAbort = () => {
    void window.api.cancelOperation(streamId);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fn(streamId);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
