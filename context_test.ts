import {
  assertEquals,
  assertNotEquals,
  assertThrowsAsync,
  assertThrows,
} from "https://deno.land/std/testing/asserts.ts";
import { delay } from "https://deno.land/std@0.50.0/async/delay.ts";
import * as context from "./context.ts";

const { test } = Deno;

test("background context", () => {
  const ctx = new context.Background();
  assertEquals(ctx.error(), null);
  assertEquals(ctx.done(), null);
});

interface testcase {
  name: string;
  key: any;
  val: any;
  want?: string;
}

const normalCasesWithValue: testcase[] = [
  {
    name: "key: string, val: string",
    key: "key",
    val: "hello, world",
  },
  {
    name: "key: number, val: number",
    key: 10.03,
    val: 100,
  },
  {
    name: "key: boolean, val: boolean",
    key: true,
    val: false,
  },
];

normalCasesWithValue.forEach((c) => {
  test(c.name, () => {
    const ctx = new context.Background();
    const vctx = new context.WithValue(ctx, c.key, c.val);
    const key = deepCopy(c.key);

    assertEquals(vctx.value(key), c.val);
    assertNotEquals(vctx.value(key), null);
    assertEquals(vctx.error(), null);
    assertEquals(vctx.done(), null);
  });
});

class temporary {
  constructor() {}
}

const errorCasesWithValue: testcase[] = [
  {
    name: "key: undefined",
    key: undefined,
    val: 100,
    want: "undefined or null key",
  },
  {
    name: "key: null",
    key: null,
    val: 100,
    want: "undefined or null key",
  },
  {
    name: "key: {}",
    key: {},
    val: "hello",
    want: "object key",
  },
  {
    name: "key: temporary class",
    key: new temporary(),
    val: "world",
    want: "object key",
  },
  {
    name: "key: []",
    key: [],
    val: 5000,
    want: "array key",
  },
  {
    name: "key: () => {}",
    key: () => {},
    val: () => {},
    want: "function key",
  },
];
errorCasesWithValue.forEach((c) => {
  test("error case " + c.name, () => {
    const ctx = new context.Background();
    assertThrows(
      () => {
        new context.WithValue(ctx, c.key, 100);
      },
      Error,
      c.want,
    );
  });
});

// https://gist.github.com/erikvullings/ada7af09925082cbb89f40ed962d475e
const deepCopy = <T>(target: T): T => {
  if (target === null) {
    return target;
  }
  if (target instanceof Date) {
    return new Date(target.getTime()) as any;
  }
  if (target instanceof Array) {
    const cp = [] as any[];
    (target as any[]).forEach((v) => {
      cp.push(v);
    });
    return cp.map((n: any) => deepCopy<any>(n)) as any;
  }
  if (typeof target === "object" && target !== {}) {
    const cp = { ...(target as { [key: string]: any }) } as {
      [key: string]: any;
    };
    Object.keys(cp).forEach((k) => {
      cp[k] = deepCopy<any>(cp[k]);
    });
    return cp as T;
  }
  return target;
};

test("withvalue context", () => {
  const ctx = new context.Background();
  const vctx = new context.WithValue(ctx, "key", "value");
  const vctx2 = new context.WithValue(vctx, true, false);
  const vctx3 = new context.WithValue(vctx2, 123, 456.789);

  // check to get from parent context values
  assertEquals(vctx3.value("key"), "value");
  assertEquals(vctx3.value(true), false);
  assertEquals(vctx3.value(123), 456.789);
  assertEquals(vctx3.value("does not exist"), null);

  // get by current key (vctx3) at parent.
  assertEquals(vctx2.value(123), null);

  assertEquals(vctx3.error(), null);
  assertEquals(vctx3.done(), null);

  const cctx = new context.WithCancel(vctx3);
  cctx.cancel(); // To prevent leaking async ops

  // check to get from parent context values on WithCancel
  assertEquals(cctx.value("key"), "value");
  assertEquals(cctx.value(true), false);
  assertEquals(cctx.value(123), 456.789);
  assertEquals(cctx.value("does not exist"), null);

  const tctx = new context.WithTimeout(vctx3, 10);
  tctx.cancel(); // To prevent leaking async ops

  // check to get from parent context values on WithTimeout
  assertEquals(tctx.value("key"), "value");
  assertEquals(tctx.value(true), false);
  assertEquals(tctx.value(123), 456.789);
  assertEquals(tctx.value("does not exist"), null);
});

test("cancel context", async () => {
  const ctx = new context.Background();
  const cctx = new context.WithCancel(ctx);
  const cctx2 = new context.WithCancel(cctx);
  const cctx3 = new context.WithCancel(cctx2);
  const cctx4 = new context.WithCancel(cctx3);

  [cctx, cctx2, cctx3, cctx4].forEach((c, i) => {
    assertEquals(c.error(), null, "context: " + i);
    assertEquals(c.done().aborted, false, "context: " + i);
  });

  // cancel and will check the result of propagation
  cctx.cancel();
  await delay(10); // let cancellation propagate

  [cctx, cctx2, cctx3, cctx4].forEach((c, i) => {
    assertEquals(c.done().aborted, true, "cancel context: " + i);
    assertEquals(c.error(), new context.Canceled(), "cancel context: " + i);
  });
});

test("timeout context", async () => {
  const ctx = new context.Background();
  const tctx = new context.WithTimeout(ctx, 20); // 20ms
  const cctx = new context.WithCancel(tctx);
  const cctx2 = new context.WithCancel(cctx);
  const cctx3 = new context.WithCancel(cctx2);

  // wait 21ms
  // context canceling to children by context.WithTimeout(ctx, 20)
  await delay(21);

  assertEquals(tctx.error(), new context.DeadlineExceeded());
  assertEquals(tctx.done().aborted, true);

  [cctx, cctx2, cctx3].forEach((c, i) => {
    assertEquals(c.done().aborted, true, "timeout context: " + i);
    assertEquals(
      c.error(),
      new context.DeadlineExceeded(),
      "timeout context: " + i,
    );
  });
});

test("clearTimeout on context.WithTimeout", async () => {
  const ctx = new context.Background();

  const timeout = 50;
  const tctx = new context.WithTimeout(ctx, timeout); // 50ms

  // We expect to do clearTimeout on this cancel.
  tctx.cancel();
  assertEquals(tctx.error(), new context.Canceled());

  await delay(timeout + 10);

  // Unexpected new context.DeadlineExceeded()
  assertEquals(tctx.error(), new context.Canceled());
});

function ctxDelay(
  ctx: context.Context,
  ms: number,
): context.ContextPromise<void> {
  return new context.ContextPromise(ctx, (resolve) => {
    const id = setTimeout((): void => {
      clearTimeout(id);
      resolve();
    }, ms);
    ctx.done()?.onCanceled((reason?: any) => {
      clearTimeout(id);
    });
  });
}

test("context promise", async () => {
  const ctx = new context.Background();

  await ctxDelay(ctx, 300); // expect to wait 300ms

  const cctx = new context.WithTimeout(ctx, 100);

  cctx.cancel();

  await assertThrowsAsync(async () => {
    await ctxDelay(cctx, 3000);
  }, context.Canceled);

  const tctx = new context.WithTimeout(ctx, 100);

  await assertThrowsAsync(async () => {
    await ctxDelay(tctx, 3000);
  }, context.DeadlineExceeded);
});
