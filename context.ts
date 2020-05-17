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
  done(): CancelSignal | null;
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

  done(): CancelSignal | null {
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
  protected _signal: CancelSignal;

  constructor(ctx: Context) {
    this._parent = ctx;
    this._signal = new CancelSignal();
    const parentSignal = this._parent.done();
    if (parentSignal !== null) {
      //
      // Signal propagation is thus in a hierarchical state.
      //
      // +------------+
      // | background |
      // +------------+
      //        |         +---------+
      //        +-------->+  child  |
      //        |         +---------+
      //        |         +---------+        +---------+
      //        +-------->+  child  +------->+  child  |
      //                  +---------+        +---------+
      //                       |             +---------+
      //                       +------------>+  child  |
      //                                     +---------+
      //
      // The fact that parentSignal is not null means that 
      // the parent context is not a background. The root
      // is always the background context.
      //
      // When parentSignal observes an abort event,
      // the parent context (which has the parentSignal)
      // will must have an error.
      const handler = () => this._signal.cancel(parentSignal.error()!);
      parentSignal.onSignaled(handler);
      this._signal.onSignaled(() => {
        parentSignal.removeEventListener("abort", handler);
      });
    }
  }

  error(): Error | null {
    return this._signal.error();
  }

  cancel(): void {
    // In order to properly propagation the error, the order of execution
    // here must be observed. Set the error before aborting.
    this._signal.cancel(new Canceled());
  }

  done(): CancelSignal {
    return this._signal;
  }

  value(key: any): any | null {
    return this._parent.value(key);
  }
}

export class WithTimeout extends WithCancel implements Context {
  constructor(ctx: Context, ms: number) {
    super(ctx);
    const id = setTimeout(() => {
      this._signal.cancel(new DeadlineExceeded());
    }, ms);
    this._signal.onSignaled(() => clearTimeout(id));
  }
}

type PromiseResolver<T> = (value?: T | PromiseLike<T>) => void;
type PromiseRejector<T> = (reason?: any) => void;
type ContextPromiseExecutor<T> = (
  resolve: PromiseResolver<T>,
  reject: PromiseRejector<T>,
) => void;

class CancelSignal implements AbortSignal {
  private _error: Error | null;
  private _abort: AbortController;
  readonly [Symbol.toStringTag]: "Signal";

  constructor() {
    this._error = null;
    this._abort = new AbortController();
  }

  // new method
  error(): Error | null {
    return this._error;
  }

  // new method
  cancel(error: Error) {
    this._error = error;
    this._abort.abort();
  }

  // new method
  onSignaled(fn: PromiseRejector<void>): void {
    if (this.aborted) {
      fn(this._error);
      return;
    }
    this.addEventListener("abort", () => fn(this._error), { once: true });
  }

  // readonly on AbortSignal implements
  get aborted(): boolean {
    return this._abort.signal.aborted;
  }

  set onabort(c: ((this: AbortSignal, ev: Event) => any) | null) {
    this._abort.signal.onabort = c;
  }

  get onabort(): ((this: AbortSignal, ev: Event) => any) | null {
    return this._abort.signal.onabort;
  }

  dispatchEvent(event: Event): boolean {
    return this._abort.signal.dispatchEvent(event);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    return this._abort.signal.addEventListener(type, listener, options);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    return this._abort.signal.removeEventListener(type, listener, options);
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
      executor(rs, rj);
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
