export class Canceled extends Error {
  constructor() {
    super("context canceled");
    this.name = "Canceled";
  }
}

export class DeadlineExceeded extends Error {
  constructor() {
    super("context deadline exceeded");
    this.name = "DeadlineExceeded";
  }
}

// A Context carries a deadline, a cancellation signal, and other values across
// API boundaries.
//
// Context's methods may be called by multiple promise simultaneously.
export interface Context {
  error(): Error | null;
  doneSignal(): AbortSignal | null;
}

export class Background implements Context {
  constructor() {}

  doneSignal(): null {
    return null;
  }

  error(): null {
    return null;
  }
}

export class WithCancel implements Context {
  protected _abort: AbortController;
  protected _error: Error | null;

  constructor(ctx: Context) {
    this._abort = new AbortController();
    this._abort.signal.onabort = () => {
      if (this._error === null) {
        this._error = ctx.error();
      }
    };
    this._error = null;
    const doneSignal = ctx.doneSignal();
    if (doneSignal !== null) {
      const onAbort = () => this._abort.abort();
      const eType = "abort";
      doneSignal.addEventListener(eType, onAbort, { once: true });
      this._abort.signal.addEventListener(eType, () => {
        doneSignal.removeEventListener(eType, onAbort);
      }, { once: true });
    }
  }

  error(): Error | null {
    return this._error;
  }

  cancel(): void {
    // In order to properly propagation the error, the order of execution
    // here must be observed. Set the error before aborting.
    this._error = new Canceled();
    this._abort.abort();
  }

  doneSignal(): AbortSignal {
    return this._abort.signal;
  }
}

export class WithTimeout extends WithCancel implements Context {
  constructor(ctx: Context, ms: number) {
    super(ctx);
    const id = setTimeout(() => {
      this._error = new DeadlineExceeded();
      this._abort.abort();
    }, ms);
    this._abort.signal.addEventListener(
      "abort",
      () => clearTimeout(id),
      { once: true },
    );
  }
}
