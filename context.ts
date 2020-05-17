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
  done(): AbortSignal | null;
  value(key: any): any | null;
}

export class Background implements Context {
  constructor() {}

  done(): null {
    return null;
  }

  error(): null {
    return null;
  }

  value(_: any): any | null {
    return null;
  }
}

export class WithValue implements Context {
  private _parent: Context;
  private _key: any;
  private _val: any;
  constructor(parent: Context, key: any, val: any) {
    if (key === undefined || key === null) {
      throw new Error("undefined or null key");
    }
    if (key instanceof Array) {
      throw new Error("array key");
    }
    if (typeof key === "object") {
      throw new Error("object key");
    }
    if (typeof key === "function") {
      throw new Error("function key");
    }
    this._parent = parent;
    this._key = key;
    this._val = val;
  }

  error(): Error | null {
    return this._parent.error();
  }

  done(): AbortSignal | null {
    return this._parent.done();
  }

  value(key: any): any | null {
    if (this._key === key) {
      return this._val;
    }
    return this._parent.value(key);
  }
}

export class WithCancel implements Context {
  private _parent: Context;
  protected _abort: AbortController;
  protected _error: Error | null;

  constructor(ctx: Context) {
    this._parent = ctx;
    this._abort = new AbortController();
    this._abort.signal.onabort = () => {
      if (this._error === null) {
        this._error = this._parent.error();
      }
    };
    this._error = null;
    const doneSignal = this._parent.done();
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

  done(): AbortSignal {
    return this._abort.signal;
  }

  value(key: any): any | null {
    return this._parent.value(key);
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

type PromiseResolver<T> = (value?: T | PromiseLike<T>) => void;
type PromiseRejector<T> = (reason?: any) => void;
type ContextPromiseExecutor<T> = (
  resolve: PromiseResolver<T>,
  reject: PromiseRejector<T>,
  signal: Signal,
) => void;

export interface Signaler {
  onSignaled(fn: PromiseRejector<void>): void;
}

class Signal implements Signaler {
  private _ctx: Context;
  constructor(ctx: Context) {
    this._ctx = ctx;
  }
  onSignaled(fn: PromiseRejector<void>): void {
    const ctx = this._ctx;
    const signal = ctx.done();
    if (!signal) return;
    if (signal.aborted) {
      fn(ctx.error());
      return;
    }
    signal.addEventListener("abort", () => fn(ctx.error()), { once: true });
  }
}

export class ContextPromise<T> implements Promise<T> {
  private _resolve!: PromiseResolver<T>;
  private _reject!: PromiseRejector<T>;
  private readonly promise: Promise<T>;
  readonly [Symbol.toStringTag]: "ContextPromise";

  constructor(ctx: Context, executor: ContextPromiseExecutor<T>) {
    this.promise = new Promise((rs, rj) => {
      this._resolve = rs;
      this._reject = rj;
      executor(rs, rj, new Signal(ctx));
    });
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?:
      | ((value: T) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: any) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  catch(onRejected?: (reason: any) => PromiseLike<never>): Promise<T> {
    return this.promise.catch(onRejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.promise.finally(onfinally);
  }

  resolve(value?: T | PromiseLike<T>): void {
    return this._resolve(value);
  }

  reject(reason?: any): void {
    return this._reject(reason);
  }
}
