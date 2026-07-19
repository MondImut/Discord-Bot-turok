/**
 * QueueManager — FIFO job queue for BoomBox conversions.
 *
 * Guarantees:
 * - Strict FIFO ordering via Array shift/push.
 * - Duplicate job ID guard prevents a job from being enqueued twice.
 * - Jobs are never silently dropped; enqueue returns false if duplicate detected.
 * - JavaScript is single-threaded, so shift/push are inherently atomic.
 */

export class QueueManager {
  /** @type {object[]} */
  #jobs = [];

  /** Set of enqueued job IDs — prevents duplicate enqueue. */
  #ids = new Set();

  /**
   * Add a job to the end of the queue.
   * @param {object} job — must have a unique `id` string property
   * @returns {boolean} true if enqueued, false if duplicate
   */
  enqueue(job) {
    if (!job?.id) throw new TypeError('Job must have an id property.');
    if (this.#ids.has(job.id)) return false; // already queued
    this.#jobs.push(job);
    this.#ids.add(job.id);
    return true;
  }

  /**
   * Remove and return the front job. Returns null when empty.
   * @returns {object|null}
   */
  dequeue() {
    const job = this.#jobs.shift();
    if (job) this.#ids.delete(job.id);
    return job ?? null;
  }

  /**
   * Inspect the front job without removing it.
   * @returns {object|null}
   */
  peek() {
    return this.#jobs[0] ?? null;
  }

  /** Remove all pending jobs for a specific guild. Returns count removed. */
  clearGuild(guildId) {
    const before = this.#jobs.length;
    this.#jobs = this.#jobs.filter((j) => {
      if (j.guildId !== guildId) return true;
      this.#ids.delete(j.id);
      return false;
    });
    return before - this.#jobs.length;
  }

  /** Drain all jobs. Used during shutdown. */
  clear() {
    const count = this.#jobs.length;
    this.#jobs = [];
    this.#ids.clear();
    return count;
  }

  get size()    { return this.#jobs.length; }
  get isEmpty() { return this.#jobs.length === 0; }
}
