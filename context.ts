// Most of the descriptions in here are copied and edited from the following links.
// https://golang.org/pkg/context
//
//
// This library defines the Context type, which carries deadlines,
// cancellation signals, and other request-scoped values across API boundaries
// if use ContextPromise instead of Promise.
//
// The WithCancel and WithTimeout functions take a
// Context (the parent) and return a derived Context (the child) and a cancel method.
// Calling the cancel method cancels the child and its children, removes the parent's
// reference to the child, and stops any associated timers. Failing to call the cancel
// method leaks the child and its children until the parent is canceled or the timer
// fires.
//
// Programs that use Contexts should follow these rules to keep interfaces consistent across
// libraries. Do not store Contexts inside any classes; instead, pass a Context explicitly to
// each function and method that needs it. The Context should be the first parameter,
// typically named ctx:
//
//   function DoSomething(ctx: context.Context, arg Arg): context.ContextPromise<void> {
//     return new context.ContextPromise(ctx, (resolve, reject) => {
//       // ... use ctx ...
//     }
//   }
//
//   ... or
//
//   function DoSomething(ctx: context.Context, arg Arg): Promise<void> {
//     return new Promise((resolve, reject) => {
//       // ... use ctx ...
//     }
//   }
//
// Do not pass a null Context, even if a function permits it.
//
// Context's methods may be called by multiple promise simultaneously.
export interface Context {
  error(): Error | null;
  done(): CancelSignal | null;
  value(key: any): any | null;
}

// Background returns a non-nil, empty Context. It is never canceled, has
// no values, and has no deadline. It is typically used by the main function,
// initialization, and tests.
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

// WithValue returns a copy of parent in which the value associated with key is val.
//
// Use context Values only for request-scoped data that transits processes and APIs,
// not for passing optional parameters to functions.
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

// WithCancel returns a copy of parent with a new done signal.
//
// The returned context's done signal is signaled when the cancel method is called or
// when the parent context's done signal is signaled, whichever happens first.
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
      parentSignal.onCanceled(handler);
      this._signal.onCanceled(() => {
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

// WithTimeout returns a copy of the parent context with the timeout
// adjusted to be no later than “ms". If the parent's timeout is already
// earlier than “ms", WithTimeout(parent, ms) is semantically equivalent
// to parent.
//
// The returned context's done signal is signaled when the timeout expires,
// when the returned cancel method is called, or when the parent context's
// done signal is signaled, whichever happens first.
export class WithTimeout extends WithCancel implements Context {
  constructor(ctx: Context, ms: number) {
    super(ctx);
    const id = setTimeout(() => {
      this._signal.cancel(new DeadlineExceeded());
    }, ms);
    this._signal.onCanceled(() => clearTimeout(id));
  }
}

// Canceled is the error happened by Context.error() when the context is canceled.
export class Canceled extends Error {
  constructor() {
    super("context canceled");
    this.name = "Canceled";
  }
}

// DeadlineExceeded is the error returned by Context.error() when the context's
// deadline passes.
export class DeadlineExceeded extends Error {
  constructor() {
    super("context deadline exceeded");
    this.name = "DeadlineExceeded";
  }
}

type PromiseResolver<T> = (value?: T | PromiseLike<T>) => void;
type PromiseRejector<T> = (reason?: any) => void;
type ContextPromiseExecutor<T> = (
  resolve: PromiseResolver<T>,
  reject: PromiseRejector<T>,
) => void;

// "done signal" essentially refers to this CancelSignal class.
//
// This class can be passed as an AbortSignal to the expected parameter
// as input.
class CancelSignal implements AbortSignal {
  private _error: Error | null;
  private _abort: AbortController;
  readonly [Symbol.toStringTag]: "CancelSignal";

  constructor() {
    this._error = null;
    this._abort = new AbortController();
  }

  // Always returns null, unless the cancel method is called.
  error(): Error | null {
    return this._error;
  }

  // Passes an error when calling this cancel method.
  // The error passed here is expected to be Canceled or DeadlineExceeded.
  cancel(error: Error) {
    this._error = error;
    this._abort.abort();
  }

  // The specified callback will be executed only once in the event that is
  // emitted when the cancel method is called.
  //
  // If the cancel method has already been called, the passed callback will
  // be executed immediately.
  onCanceled(fn: PromiseRejector<void>): void {
    // It's already been cancelled.
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

// ContextPromise is automatically rejected when the Context done signal is signaled.
//
// When rejected, an error, either Canceled or DeadlineExceeded, is passed to indicate
// why it was canceled.
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
    ctx.done()?.onCanceled((reason?: any) => {
      this.reject(reason);
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
