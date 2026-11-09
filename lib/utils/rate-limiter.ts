// Open Backup UI v1.0.2
/**
 * Rate Limiter Utility
 * 
 * Implements request queuing and rate limiting to prevent API quota exceeded errors.
 * Particularly useful for VBM API which has strict rate limits (1 request per second).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface QueuedRequest<T = any> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class RateLimiter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: QueuedRequest<any>[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private minInterval: number; // Minimum time between requests in milliseconds

  constructor(requestsPerSecond: number = 1) {
    this.minInterval = 1000 / requestsPerSecond;
  }

  /**
   * Execute a function with rate limiting
   * @param fn Function to execute
   * @returns Promise that resolves with the function's result
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: fn,
        resolve,
        reject,
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const waitTime = Math.max(0, this.minInterval - timeSinceLastRequest);

      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      const request = this.queue.shift();
      if (!request) break;

      try {
        this.lastRequestTime = Date.now();
        const result = await request.execute();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    }

    this.processing = false;
  }

  /**
   * Clear all pending requests
   */
  clear(): void {
    this.queue.forEach(request => {
      request.reject(new Error('Request queue cleared'));
    });
    this.queue = [];
  }

  /**
   * Get the number of pending requests
   */
  getPendingCount(): number {
    return this.queue.length;
  }
}

/**
 * Debouncer for authentication requests
 * Prevents multiple simultaneous auth calls by sharing the same promise
 */
export class AuthDebouncer<T> {
  private pendingPromise: Promise<T> | null = null;
  private lastResult: T | null = null;
  private lastResultTime = 0;
  private cacheTimeout: number;

  constructor(cacheTimeoutMs: number = 5000) {
    this.cacheTimeout = cacheTimeoutMs;
  }

  /**
   * Execute a function with debouncing
   * If a request is already in progress, returns the same promise
   * If recently completed, returns cached result
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    // Return cached result if available and fresh
    const now = Date.now();
    if (this.lastResult && (now - this.lastResultTime) < this.cacheTimeout) {
      return this.lastResult;
    }

    // Return existing promise if already in progress
    if (this.pendingPromise) {
      return this.pendingPromise;
    }

    // Create new promise
    this.pendingPromise = fn()
      .then(result => {
        this.lastResult = result;
        this.lastResultTime = Date.now();
        this.pendingPromise = null;
        return result;
      })
      .catch(error => {
        this.pendingPromise = null;
        throw error;
      });

    return this.pendingPromise;
  }

  /**
   * Clear cached result
   */
  clear(): void {
    this.lastResult = null;
    this.lastResultTime = 0;
  }
}
