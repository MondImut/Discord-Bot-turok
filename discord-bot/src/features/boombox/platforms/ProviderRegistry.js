/**
 * ProviderRegistry — Generic multi-provider orchestrator with health tracking.
 *
 * Guarantees:
 * - Tries providers in registration order; skips disabled ones.
 * - Each provider can have its own timeout (per-provider override).
 * - A provider is auto-disabled when its recent fail rate exceeds the threshold.
 * - After a cooldown period the provider is re-tried automatically.
 * - Providers receive (url, ctx) — ctx carries pre-fetched metadata (duration, id, title).
 * - Full status snapshot available for monitoring panels.
 * - Attaches _triedProviders to thrown errors for ErrorLogger.
 */

export class ProviderRegistry {
  /** Track last N results per provider (true = success, false = failure). */
  static HISTORY_SIZE     = 10;
  /** Disable if ≥ this fraction of recent attempts failed. */
  static FAIL_THRESHOLD   = 0.6;
  /** How long (ms) a disabled provider stays offline before retry. */
  static COOLDOWN_MS      = 5 * 60 * 1000;   // 5 min
  /** Default per-provider timeout if not set on the registry or the provider. */
  static DEFAULT_TIMEOUT_MS = 15_000;

  #name;
  #logger;
  #defaultTimeoutMs;
  /** @type {Array<{name:string, fn:Function, timeoutMs:number, stats:object, disabledUntil:number}>} */
  #providers = [];

  /**
   * @param {string} name       — platform label for logging
   * @param {object} logger
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]  — default per-provider timeout (ms)
   */
  constructor(name, logger, opts = {}) {
    this.#name             = name;
    this.#logger           = logger;
    this.#defaultTimeoutMs = opts.timeoutMs ?? ProviderRegistry.DEFAULT_TIMEOUT_MS;
  }

  /**
   * Register a provider.
   *
   * @param {string}   name  Human-readable label shown in monitoring.
   * @param {Function} fn    Async (url: string, ctx: object) => PlatformResult
   * @param {object}   [opts]
   * @param {number}   [opts.timeoutMs]  Per-provider timeout override (ms).
   *                         Useful to give yt-dlp a much longer timeout than API providers.
   */
  register(name, fn, opts = {}) {
    this.#providers.push({
      name,
      fn,
      timeoutMs:     opts.timeoutMs ?? this.#defaultTimeoutMs,
      disabledUntil: 0,
      stats: {
        total:        0,
        success:      0,
        failed:       0,
        totalLatency: 0,
        history:      [],   // circular last-N booleans
        lastSuccess:  0,
        lastFailure:  0,
      },
    });
  }

  /**
   * Try each provider in order until one succeeds.
   *
   * @param {string} url
   * @param {object} [ctx={}]   Pre-fetched metadata: { id, title, duration, ... }
   *                            Passed as second argument to every provider.
   * @returns {Promise<object>} Platform result
   */
  async resolve(url, ctx = {}) {
    const now    = Date.now();
    const errors = [];
    const tried  = [];       // { name, reason } — for error logging
    let   allDisabled = true;

    for (const provider of this.#providers) {
      // Auto-re-enable after cooldown
      if (provider.disabledUntil > 0 && provider.disabledUntil <= now) {
        provider.disabledUntil = 0;
        this.#logger?.info(
          `[${this.#name}] Provider "${provider.name}" re-enabled after cooldown.`,
          'ProviderRegistry',
        );
      }

      if (provider.disabledUntil > now) {
        const sec    = Math.ceil((provider.disabledUntil - now) / 1000);
        const reason = `Disabled — cooldown ${sec}s remaining`;
        this.#logger?.debug(
          `[${this.#name}] Skipping "${provider.name}" (${reason}).`,
          'ProviderRegistry',
        );
        tried.push({ name: provider.name, reason });
        continue;
      }

      allDisabled = false;
      const start = Date.now();

      try {
        // Each provider gets its own configured timeout — fast-fail for API, generous for yt-dlp
        const result = await this.#withTimeout(
          provider.fn(url, ctx),
          provider.timeoutMs,
          `Timeout ${(provider.timeoutMs / 1000).toFixed(0)}s`,
        );
        const latencyMs = Date.now() - start;

        this.#recordResult(provider, true, latencyMs);
        this.#logger?.debug(
          `[${this.#name}] "${provider.name}" succeeded in ${latencyMs}ms.`,
          'ProviderRegistry',
        );

        return { ...result, _provider: provider.name };

      } catch (err) {
        const latencyMs = Date.now() - start;
        this.#recordResult(provider, false, latencyMs);
        const reason = err.message ?? 'Unknown error';
        this.#logger?.warn(
          `[${this.#name}] "${provider.name}" failed (${latencyMs}ms): ${reason}`,
          'ProviderRegistry',
        );
        errors.push(`${provider.name}: ${reason}`);
        tried.push({ name: provider.name, reason });
        // Continue immediately to next provider
      }
    }

    let finalErr;
    if (allDisabled) {
      finalErr = new Error(
        `[${this.#name}] Semua provider sedang offline (cooldown aktif). Coba lagi dalam beberapa menit.`,
      );
    } else {
      finalErr = new Error(
        `[${this.#name}] Semua provider gagal setelah ${tried.length} percobaan.`,
      );
    }

    finalErr._triedProviders = tried;
    finalErr._lastProvider   = tried.at(-1)?.name ?? null;
    finalErr._providerDetail = errors.join(' | ');

    throw finalErr;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  #withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err);  },
      );
    });
  }

  #recordResult(provider, success, latencyMs) {
    const s = provider.stats;
    s.total++;
    s.totalLatency += latencyMs;

    if (success) {
      s.success++;
      s.lastSuccess = Date.now();
    } else {
      s.failed++;
      s.lastFailure = Date.now();
    }

    s.history.push(success);
    if (s.history.length > ProviderRegistry.HISTORY_SIZE) s.history.shift();

    // Auto-disable on repeated failures
    if (!success && s.history.length >= ProviderRegistry.HISTORY_SIZE) {
      const failRate = s.history.filter(v => !v).length / s.history.length;
      if (failRate >= ProviderRegistry.FAIL_THRESHOLD) {
        provider.disabledUntil = Date.now() + ProviderRegistry.COOLDOWN_MS;
        this.#logger?.warn(
          `[${this.#name}] Provider "${provider.name}" disabled ` +
          `(fail rate ${(failRate * 100).toFixed(0)}% in last ${ProviderRegistry.HISTORY_SIZE} attempts). ` +
          `Cooldown: ${ProviderRegistry.COOLDOWN_MS / 1000}s.`,
          'ProviderRegistry',
        );
      }
    }
  }

  // ─── Public status ─────────────────────────────────────────────────────────

  /**
   * Snapshot of all providers' health — safe to call at any time.
   * @returns {Array<ProviderStatus>}
   */
  getStatus() {
    const now = Date.now();
    return this.#providers.map((p) => {
      const s        = p.stats;
      const disabled = p.disabledUntil > now;
      const avgMs    = s.total > 0 ? Math.round(s.totalLatency / s.total) : 0;
      const rate     = s.total > 0 ? `${((s.success / s.total) * 100).toFixed(1)}%` : '—';

      return {
        name:          p.name,
        enabled:       !disabled,
        disabledUntil: disabled ? p.disabledUntil : null,
        timeoutMs:     p.timeoutMs,
        total:         s.total,
        success:       s.success,
        failed:        s.failed,
        successRate:   rate,
        avgLatencyMs:  avgMs,
        lastSuccess:   s.lastSuccess || null,
        lastFailure:   s.lastFailure || null,
      };
    });
  }

  get name()          { return this.#name;              }
  get providerCount() { return this.#providers.length;  }
}
