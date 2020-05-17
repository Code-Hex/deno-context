# context-promise

![.github/workflows/test.yml](https://github.com/Code-Hex/context-promise/workflows/.github/workflows/test.yml/badge.svg)

🦕【Deno】Propagate deadlines, a cancellation and other request-scoped values to multiple promise. The behaviour is like Go's context.

## Synopsis

This example passes a context with a timeout to tell a blocking methods that it should abandon its work after the timeout elapses.

```typescript
import * as context from "./context.ts";

const tooSlow = (
  ctx: context.Context,
  ms: number,
): Promise<number> => {
  return new Promise<number>((resolve, reject) => {
    const id = setTimeout((): void => {
      clearTimeout(id);
      resolve();
    }, ms);
    ctx.done()?.onCanceled((reason?: any) => {
      clearTimeout(id);
      reject(reason);
    });
    return ms;
  });
};

const ctx = new context.Background();
const tctx = new context.WithTimeout(ctx, 1000); // timeout by 1000ms

try {
  await Promise.race([
    tooSlow(tctx, 3000), // take 3s
    tooSlow(tctx, 4000), // take 4s
    tooSlow(tctx, 5000), // take 5s
  ]);
} catch (e) {
  // Get this error by 1000ms.
  // DeadlineExceeded: context deadline exceeded
  console.warn(e);
} finally {
  tctx.cancel(); // To prevent leak.
}
```

## About Context

Most of the descriptions in here are copied and edited from the following links.
https://golang.org/pkg/context


This library defines the Context type, which carries deadlines,
cancellation signals, and other request-scoped values across API boundaries.

The WithCancel and WithTimeout functions take a
Context (the parent) and return a derived Context (the child) and a cancel method.
Calling the cancel method cancels the child and its children, removes the parent's
reference to the child, and stops any associated timers. Failing to call the cancel
method leaks the child and its children until the parent is canceled or the timer
fires.

Programs that use Contexts should follow these rules to keep interfaces consistent across
libraries. Do not store Contexts inside any classes; instead, pass a Context explicitly to
each function and method that needs it. The Context should be the first parameter,
typically named ctx:

```typescript
  function DoSomething(ctx: context.Context, arg Arg): context.ContextPromise<void> {
    return new context.ContextPromise(ctx, (resolve, reject) => {
      // ... use ctx ...
    }
  }

  ... or

  function DoSomething(ctx: context.Context, arg Arg): Promise<void> {
    return new Promise((resolve, reject) => {
      // ... use ctx ...
    }
  }
```

## context.Background

```typescript
const ctx = new context.Background();
```

Background returns a non-nil, empty Context. It is never canceled, has
no values, and has no deadline. It is typically used by the main function,
initialization, and tests.

## context.WithValue

```typescript
const ctx = new context.Background();
const vctx = new context.WithValue(ctx, "key", "value");
```

WithValue returns a copy of parent in which the value associated with key is val.

Use context Values only for request-scoped data that transits processes and APIs,
not for passing optional parameters to functions.

<details>
 <summary>Example</summary>

```typescript
const ctx = new context.Background();

const key = "language";
const vctx = new context.WithValue(ctx, key, "Deno");

const f = (ctx: context.Context, key: string): void => {
  const v = ctx.value(key);
  if (v != undefined) {
    console.log("found value:", v);
    return;
  }
  console.log("key not found:", key);
};

f(vctx, key);
f(vctx, "color");
```

</details>

## context.WithCancel

```typescript
const ctx = new context.Background();
const cctx = new context.WithCancel(ctx);
```

WithCancel returns a copy of parent with a new done signal.

The returned context's done signal is signaled when the cancel method is called or
when the parent context's done signal is signaled, whichever happens first.

<details>
 <summary>Example</summary>

```typescript
const ctx = new context.Background();
const cctx = new context.WithCancel(ctx);

const canceler = async () => {
  await tooSlow(cctx, 1000);
  cctx.cancel();
}

// Run asynchronously
canceler();

try {
  await Promise.race([
    tooSlow(cctx, 3000),
    tooSlow(cctx, 4000),
    tooSlow(cctx, 5000),
  ]);
} catch (e) {
  // Canceled: context canceled
  console.warn(e);
} finally {
  cctx.cancel(); // To prevent leak.
}
```

</details>

### Callback to be performed on cancel

The specified callback will be executed only once in the event that is emitted when the cancel method is called.
  
If the cancel method has already been called, the passed callback will be executed immediately.

<details>
 <summary>Example</summary>

```typescript
import * as context from "./context.ts";

const ctx = new context.Background();
const cctx = new context.WithCancel(ctx);

cctx.done().onCanceled((reason?: any) => {
  console.log("canceled reason:", reason)
})

console.log("start cancel")
cctx.cancel();
console.log("canceled")
```

</details>

## context.WithTimeout

```typescript
const ctx = new context.Background();
const tctx = new context.WithTimeout(ctx, 1000);
```

WithTimeout returns a copy of the parent context with the timeout
adjusted to be no later than “ms". If the parent's timeout is already
earlier than “ms", WithTimeout(parent, ms) is semantically equivalent
to parent.

The returned context's done signal is signaled when the timeout expires,
when the returned cancel method is called, or when the parent context's
done signal is signaled, whichever happens first.
