/**
 * WorkerPool — Concurrent worker pool driven by QueueManager.
 *
 * Guarantees:
 * - Workers run in parallel up to the configured limit.
 * - Crash in one job never stops other workers.
 * - Timeout timer is always cleared (no dangling timers / memory leak).
 * - Supports graceful drain: waits for active jobs to finish on shutdown.
 * - Re-spawn logic is idempotent — no double-spawn possible.
 * - `#stopping` flag prevents new spawns during drain/shutdown.
 *
 * v1.4:
 * - Default retries increased to 3 (minimum required per spec).
 * - Provider timeout handled gracefully: move to next provider, never stop.
 */

export class WorkerPool {
  #queue;
  #downloader;
  #logger;
  #activeCount = 0;
  #stopping    = false;
  #retryCount  = 0;   // cumulative retry attempts across all jobs (resets on restart)
  #config;  // { workers, timeout, retries }

  constructor(queue, downloader, logger, config) {
    this.#queue      = queue;
    this.#downloader = downloader;
    this.#logger     = logger;
    // Default retries = 3, timeout = 5 min per attempt
    // (Per-provider timeout is 30s in ProviderRegistry; 5 min accommodates
    //  4 providers × 30s + download + ffmpeg + Top4Top upload.)
    this.#config     = { workers: 3, timeout: 300_000, retries: 3, ...config };
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Submit a job. Spawns a new worker slot if capacity allows. */
  submit(job) {
    if (this.#stopping) {
      this.#logger.warn(`WorkerPool is draining — job ${job.id} rejected.`, 'WorkerPool');
      return;
    }
    const ok = this.#queue.enqueue(job);
    if (!ok) {
      this.#logger.warn(`Duplicate job ${job.id} — skipped.`, 'WorkerPool');
      return;
    }
    this.#trySpawn();
  }

  /** Update performance config at runtime (e.g. settings panel change). */
  updateConfig(config) {
    this.#config = { ...this.#config, ...config };
  }

  /**
   * Gracefully drain all active workers.
   * Waits up to `timeoutMs` for in-progress jobs to finish.
   * Queued-but-not-started jobs are abandoned.
   * @param {number} timeoutMs
   */
  async drain(timeoutMs = 30_000) {
    this.#stopping = true;
    this.#queue.clear(); // Drop waiting jobs; active jobs finish naturally.

    const deadline = Date.now() + timeoutMs;
    while (this.#activeCount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (this.#activeCount > 0) {
      this.#logger.warn(
        `Drain timeout: ${this.#activeCount} worker(s) still active after ${timeoutMs}ms.`,
        'WorkerPool',
      );
    } else {
      this.#logger.info('WorkerPool drained cleanly.', 'WorkerPool');
    }

    this.#stopping = false; // Allow reuse after plugin reload
  }

  get activeCount() { return this.#activeCount; }
  get queueSize()   { return this.#queue.size;  }
  get retryCount()  { return this.#retryCount;  }
  get config()      { return { ...this.#config }; }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /** Spawn a worker slot if below capacity and not stopping. */
  #trySpawn() {
    if (this.#stopping) return;
    if (this.#activeCount >= this.#config.workers) return;

    this.#activeCount++;
    this.#workerLoop()
      .catch((err) => {
        // workerLoop is already guarded; this is a safety net for unexpected throws.
        this.#logger.error(`Worker loop fatal error: ${err.message}`, 'WorkerPool');
      })
      .finally(() => {
        this.#activeCount--;
        // If more jobs arrived while this worker was busy, try to spawn again.
        if (!this.#stopping && !this.#queue.isEmpty) {
          this.#trySpawn();
        }
      });
  }

  /** Worker loop: pull and process jobs until the queue is empty. */
  async #workerLoop() {
    while (!this.#queue.isEmpty) {
      const job = this.#queue.dequeue();
      if (!job) break;
      await this.#processJob(job);
    }
  }

  /**
   * Process one job with retry + timeout + error isolation.
   * - Minimum 3 retry attempts (retries config is the max, floor is 3).
   * - On timeout: logs warn and falls through to next retry (not a hard fail).
   * - Timer is always cleared — no memory leaks.
   */
  async #processJob(job) {
    const retries = Math.max(3, this.#config.retries); // enforce min 3 retries
    const timeout = this.#config.timeout;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let timer;
      try {
        const result = await Promise.race([
          this.#downloader.convert(job),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Object.assign(new Error(`Timeout setelah ${timeout / 1000}s — mencoba provider berikutnya`), { _isTimeout: true })),
              timeout,
            );
          }),
        ]);

        clearTimeout(timer); // ← Always clear on success
        await this.#safeCall(job.onSuccess, result);
        return;
      } catch (err) {
        clearTimeout(timer); // ← Always clear on error too
        lastError = err;

        const label = err._isTimeout ? 'TIMEOUT' : 'FAIL';
        this.#logger.warn(
          `Job ${job.id} [${job.platform}/${job.videoId}] attempt ${attempt + 1}/${retries + 1} [${label}]: ${err.message}`,
          'WorkerPool',
        );

        if (attempt < retries) {
          this.#retryCount++;
          await this.#safeCall(job.onRetry, null);
          // Exponential backoff: 1s, 2s, 3s — capped at 5s
          const delay = Math.min(1000 * (attempt + 1), 5000);
          await this.#sleep(delay);
        }
      }
    }

    // All retries exhausted
    this.#logger.error(
      `Job ${job.id} [${job.platform}/${job.videoId}] failed after ${retries + 1} attempt(s): ${lastError?.message}`,
      'WorkerPool',
    );
    await this.#safeCall(job.onError, lastError);
  }

  /** Call a callback safely — its failure must not crash the worker. */
  async #safeCall(fn, arg) {
    if (typeof fn !== 'function') return;
    try {
      await fn(arg);
    } catch (e) {
      this.#logger.error(`Job callback error: ${e.message}`, 'WorkerPool');
    }
  }

  #sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}
