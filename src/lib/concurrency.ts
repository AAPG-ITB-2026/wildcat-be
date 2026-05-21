/**
 * Execute async tasks with a maximum concurrency limit
 * Prevents overwhelming the database connection pool and CPU
 * 
 * @param tasks - Array of async functions to execute
 * @param maxConcurrency - Maximum number of concurrent tasks (default: 5)
 * @returns Array of results in the same order as input tasks
 */
export async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number = 5,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let activeCount = 0;
  let taskIndex = 0;
  let resolveNext: (() => void) | null = null;

  const executeTask = async (index: number) => {
    try {
      results[index] = await tasks[index]();
    } catch (error) {
      // Store the error so it can be thrown later
      results[index] = error as T;
    } finally {
      activeCount--;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    }
  };

  // Start initial batch of tasks
  const executing: Promise<void>[] = [];
  while (taskIndex < tasks.length && activeCount < maxConcurrency) {
    activeCount++;
    executing.push(executeTask(taskIndex));
    taskIndex++;
  }

  // Process remaining tasks as others complete
  while (taskIndex < tasks.length) {
    await new Promise<void>((resolve) => {
      resolveNext = resolve;
    });

    // Start new task if we have capacity
    if (taskIndex < tasks.length && activeCount < maxConcurrency) {
      activeCount++;
      executing.push(executeTask(taskIndex));
      taskIndex++;
    }
  }

  // Wait for all tasks to complete
  await Promise.all(executing);

  return results;
}
