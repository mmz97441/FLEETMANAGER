/** Bound the entire operation, including preparation before an SDK's own timer.
 * A deadline does not cancel a remote write; its retry must retain the request ID. */
export async function withDeadline<T>(operation: Promise<T>, milliseconds: number, error: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(error), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
