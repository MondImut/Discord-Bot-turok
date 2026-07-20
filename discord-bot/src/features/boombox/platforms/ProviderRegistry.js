/**
 * ProviderRegistry — Generic multi-provider orchestrator with health tracking.
 *
 * Guarantees:
 * - Tries providers in registration order; skips disabled ones.
 * - A provider is auto-disabled when its recent fail rate exceeds the threshold.
 * - After a cooldown period the provider is re-tried automatically.
 * - Full status snapshot available for monitoring panels.
 * - Thread-safe in Node.js single-threaded model (no locking needed).
 * - Attaches _triedProviders to thrown errors so callers can log full detail.
 */

export class ProviderRegistry {
  /** Track last N results per provider (true = success, false = failure). */
  static HISTORY_SIZE     = 10;
  /** Disable if ≥ this fraction of recent attempts failed. */
  static FAIL_THRESHOLD   = 0.6;
  /** How long (ms) a disabled provider stays offline before retry. */
  static COOLDOWN_MS      = 5 * 60 * 1000;   // 5 min
  /** Hard timeout per-provider call. Provider is skipped after this. */
  static PROVIDER_TIMEOUT_MS = 15_000;        // 15 s — fast fallback

  #name;
  #logger;
  #timeoutMs;
  /** @type {Array<{name:string, fn:Function, stats:object, disabledUntil:number}>} */
  #providers = [];

  /**
   * @param {string} name     — platform label for logging
   * @param {object} logger
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]  — per-provider timeout in ms (default: PROVIDER_TIMEOUT_MS)
   */
  constructor(name, logger, opts = {}) {
    this.#name      = name;
    this.#logger    = logger;
    this.#timeoutMs = opts.timeoutMs ?? ProviderRegistry.PROVIDER_TIMEOUT_MS;
  }

  /**
   * Register a provider.
   * @param {string}   name  Human-readable label shown in monitoring.
   * @param {Function} fn    Async (url: string) => PlatformResult
   */
  register(name, fn) {
    this.#providers.push({
      name,
      fn,
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
   * On total failure, the thrown Error has:
   *   - err._triedProviders  = [{ name, reason }]  — all providers attempted
   *   - err._lastProvider    = 'name'               — last provider tried
   * @param {string} url
   * @returns {Promise<object>} Platform result
   */
  async resolve(url) {
    const now    = Date.now();
    const errors = [];
    const tried  = [];       // { name, reason } — for error logging
    let   allDisabled = true;

    for (const provider of this.#providers) {
      // Auto-re-enable after cooldown
      if (provider.disabledUntil > 0 && provider.disabledUntil <= now) {
        provider.disabledUntil = 0;
        this.#logger.info(
          `[${this.#name}] Provider "${provider.name}" re-enabled after cooldown.`,
          'ProviderRegistry',
        );
      }

      if (provider.disabledUntil > now) {
        const sec = Math.ceil((provider.disabledUntil - now) / 1000);
        const reason = `Disabled — cooldown ${sec}s remaining`;
        this.#logger.debug(
          `[${this.#name}] Skipping "${provider.name}" (${reason}).`,
          'ProviderRegistry',
        );
        tried.push({ name: provider.name, reason });
        continue;
      }

      allDisabled = false;
      const start = Date.now();

      try {
        // Each provider gets a hard timeout — timeout → skip to next provider
        const result = await this.#withTimeout(
          provider.fn(url),
          this.#timeoutMs,
          `Timeout ${this.#timeoutMs / 1000}s`,
        );
        const latencyMs = Date.now() - start;

        this.#recordResult(provider, true, latencyMs);
        this.#logger.debug(
          `[${this.#name}] "${provider.name}" succeeded in ${latencyMs}ms.`,
          'ProviderRegistry',
        );

        return { ...result, _provider: provider.name };

      } catch (err) {
        const latencyMs = Date.now() - start;
        this.#recordResult(provider, false, latencyMs);
        const reason = err.message ?? 'Unknown error';
        this.#logger.warn(
          `[${this.#name}] "${provider.name}" failed (${latencyMs}ms): ${reason}`,
          'ProviderRegistry',
        );
        errors.push(`${provider.name}: ${reason}`);
        tried.push({ name: provider.name, reason });

        // Continue immediately to next provider — never stop on a single failure
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

    // Attach diagnostic data for callers (ErrorLogger etc.) — no stack noise
    finalErr._triedProviders = tried;
    finalErr._lastProvider   = tried.length > 0 ? tried[tried.length - 1].name : null;
    finalErr._providerDetail = errors.join(' | ');

    throw finalErr;
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /**
   * Race a promise against a timeout. Cleans up timer on both paths.
   * @param {Promise} promise
   * @param {number}  ms       Timeout in milliseconds
   * @param {string}  label    Error message on timeout
   */
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

    // Check if provider should be disabled
    if (!success && s.history.length >= ProviderRegistry.HISTORY_SIZE) {
      const failRate = s.history.filter(v => !v).length / s.history.length;
      if (failRate >= ProviderRegistry.FAIL_THRESHOLD) {
        provider.disabledUntil = Date.now() + ProviderRegistry.COOLDOWN_MS;
        this.#logger.warn(
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
      const s         = p.stats;
      const disabled  = p.disabledUntil > now;
      const avgMs     = s.total > 0 ? Math.round(s.totalLatency / s.total) : 0;
      const rate      = s.total > 0
        ? `${((s.success / s.total) * 100).toFixed(1)}%`
        : '—';

      return {
        name:          p.name,
        enabled:       !disabled,
        disabledUntil: disabled ? p.disabledUntil : null,
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
