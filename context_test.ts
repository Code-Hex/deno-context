import { assertEquals } from "https://deno.land/std/testing/asserts.ts";
import { delay } from "https://deno.land/std@0.50.0/async/delay.ts";
import * as context from "./context.ts";

const { test } = Deno;

test("background context", () => {
  const ctx = new context.Background();
  assertEquals(ctx.error(), null);
  assertEquals(ctx.doneSignal(), null);
});

test("cancel context", async () => {
  const ctx = new context.Background();
  const cctx = new context.WithCancel(ctx);
  const cctx2 = new context.WithCancel(cctx);
  const cctx3 = new context.WithCancel(cctx2);
  const cctx4 = new context.WithCancel(cctx3);

  [cctx, cctx2, cctx3, cctx4].forEach((c, i) => {
    assertEquals(c.error(), null, "context: " + i);
    assertEquals(c.doneSignal().aborted, false, "context: " + i);
  });

  // cancel and will check the result of propagation
  cctx.cancel();
  await delay(10); // let cancellation propagate

  [cctx, cctx2, cctx3, cctx4].forEach((c, i) => {
    assertEquals(c.doneSignal().aborted, true, "cancel context: " + i);
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
  assertEquals(tctx.doneSignal().aborted, true);

  [cctx, cctx2, cctx3].forEach((c, i) => {
    assertEquals(c.doneSignal().aborted, true, "timeout context: " + i);
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
