import { expect, spyOn, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { token } from "../../src/di/token.ts";

const IDLE_TTL = 10;

class Resource {
  disposeCalls = 0;
  onDispose: (() => void | Promise<void>) | undefined;

  dispose() {
    this.disposeCalls++;
    return this.onDispose?.();
  }
}

function sessionFixture(ttl = IDLE_TTL) {
  const app = new Zebra({
    session: { ttl, resolver: (req) => req.headers.get("x-session") ?? undefined },
    gracePeriod: 0,
  });
  const session = token<Resource>("session resource");
  const request = token<Resource>("request resource");
  const sessions: Resource[] = [];
  const requests: Resource[] = [];
  const holds: {
    entered: ReturnType<typeof Promise.withResolvers<{ session: Resource; request: Resource }>>;
    gate: ReturnType<typeof Promise.withResolvers<void>>;
  }[] = [];
  const responses: Promise<Response>[] = [];
  app.injectFactorySession(session, () => {
    const resource = new Resource();
    sessions.push(resource);
    return resource;
  });
  app.injectFactoryRequest(request, () => {
    const resource = new Resource();
    requests.push(resource);
    return resource;
  });
  app.get("/hold/:index", { session, request }, async (req, resources) => {
    const hold = holds[Number(req.params.index)]!;
    hold.entered.resolve(resources);
    await hold.gate.promise;
    return resources.session.disposeCalls;
  });

  return {
    app,
    sessions,
    requests,
    start(sessionId?: string) {
      const entered = Promise.withResolvers<{ session: Resource; request: Resource }>();
      const gate = Promise.withResolvers<void>();
      const index = holds.push({ entered, gate }) - 1;
      const headers = sessionId === undefined ? undefined : { "x-session": sessionId };
      const response = app.dispatch(new Request(`http://x/hold/${index}`, { headers }));
      responses.push(response);
      return {
        entered: entered.promise,
        finish() {
          gate.resolve();
          return response;
        },
      };
    },
    async cleanup() {
      for (const hold of holds) hold.gate.resolve();
      await Promise.allSettled(responses);
      await app.stop().catch(() => {});
    },
  };
}

test.each([
  [1, 1],
  [3, 2],
])(
  "%i old requests cannot expire a replacement held by %i new requests",
  async (oldCount, newCount) => {
    const fixture = sessionFixture();
    try {
      const old = Array.from({ length: oldCount }, () => fixture.start("same"));
      const oldResources = await Promise.all(old.map((hold) => hold.entered));
      const oldSession = oldResources[0]!.session;
      expect(oldResources.every(({ session }) => session === oldSession)).toBe(true);

      await fixture.app.disposeSession("same");
      expect(oldSession.disposeCalls).toBe(1);
      const current = Array.from({ length: newCount }, () => fixture.start("same"));
      const currentResources = await Promise.all(current.map((hold) => hold.entered));
      const currentSession = currentResources[0]!.session;
      expect(currentSession).not.toBe(oldSession);
      expect(currentResources.every(({ session }) => session === currentSession)).toBe(true);

      for (const hold of old) expect(await (await hold.finish()).json()).toBe(1);
      await Bun.sleep(IDLE_TTL * 3);
      expect(currentSession.disposeCalls).toBe(0);

      for (const hold of current.slice(0, -1)) {
        expect(await (await hold.finish()).json()).toBe(0);
        await Bun.sleep(IDLE_TTL * 3);
        expect(currentSession.disposeCalls).toBe(0);
      }
      expect(await (await current.at(-1)!.finish()).json()).toBe(0);
      expect(currentSession.disposeCalls).toBe(0);
      await Bun.sleep(IDLE_TTL * 3);
      expect(currentSession.disposeCalls).toBe(1);

      await fixture.app.stop();
      expect(fixture.sessions.map((resource) => resource.disposeCalls)).toEqual([1, 1]);
      expect(fixture.requests.map((resource) => resource.disposeCalls)).toEqual(
        Array(oldCount + newCount).fill(1),
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test("a failing old request cleanup cannot release a session replaced twice while it awaited", async () => {
  const fixture = sessionFixture();
  const cleaning = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const failure = new Error("old request cleanup failed");
  try {
    const old = fixture.start("same");
    const oldResources = await old.entered;
    oldResources.request.onDispose = async () => {
      cleaning.resolve();
      await gate.promise;
      throw failure;
    };
    const oldResponse = old.finish();
    await cleaning.promise;
    await fixture.app.disposeSession("same");
    expect(oldResources.session.disposeCalls).toBe(1);

    const middle = fixture.start("same");
    const middleResources = await middle.entered;
    expect(middleResources.session).not.toBe(oldResources.session);
    await fixture.app.disposeSession("same");
    expect(middleResources.session.disposeCalls).toBe(1);

    const current = fixture.start("same");
    const currentResources = await current.entered;
    expect(currentResources.session).not.toBe(middleResources.session);
    gate.resolve();
    expect((await oldResponse).status).toBe(500);
    expect(await (await middle.finish()).json()).toBe(1);
    await Bun.sleep(IDLE_TTL * 3);
    expect(currentResources.session.disposeCalls).toBe(0);

    expect(await (await current.finish()).json()).toBe(0);
    await Bun.sleep(IDLE_TTL * 3);
    expect(currentResources.session.disposeCalls).toBe(1);
    await fixture.app.stop();
    expect(fixture.sessions.map((resource) => resource.disposeCalls)).toEqual([1, 1, 1]);
    expect(fixture.requests.map((resource) => resource.disposeCalls)).toEqual([1, 1, 1]);
  } finally {
    gate.resolve();
    await fixture.cleanup();
  }
});

test.each(["sync", "async"])(
  "a %s request cleanup failure still starts its own session's idle TTL",
  async (mode) => {
    const fixture = sessionFixture();
    const failure = new Error("current request cleanup failed");
    try {
      const hold = fixture.start("same");
      const resources = await hold.entered;
      resources.request.onDispose = () => {
        if (mode === "async") return Promise.reject(failure);
        throw failure;
      };
      expect((await hold.finish()).status).toBe(500);
      expect(resources.request.disposeCalls).toBe(1);
      expect(resources.session.disposeCalls).toBe(0);
      await Bun.sleep(IDLE_TTL * 3);
      expect(resources.session.disposeCalls).toBe(1);
      await fixture.app.stop();
      expect(resources.request.disposeCalls).toBe(1);
      expect(resources.session.disposeCalls).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  },
);

test.each(["success", "failure"])(
  "anonymous scopes stay request-local after cleanup %s",
  async (mode) => {
    const fixture = sessionFixture();
    try {
      const first = fixture.start();
      const second = fixture.start();
      const firstResources = await first.entered;
      const secondResources = await second.entered;
      expect(firstResources.session).not.toBe(secondResources.session);
      firstResources.request.onDispose = () => {
        if (mode === "failure") throw new Error("anonymous request cleanup failed");
      };
      expect((await first.finish()).status).toBe(mode === "success" ? 200 : 500);
      expect(firstResources.request.disposeCalls).toBe(1);
      expect(firstResources.session.disposeCalls).toBe(1);
      await Bun.sleep(IDLE_TTL * 3);
      expect(secondResources.session.disposeCalls).toBe(0);
      expect(await (await second.finish()).json()).toBe(0);
      expect(secondResources.session.disposeCalls).toBe(1);
      await fixture.app.stop();
      expect(fixture.sessions.map((resource) => resource.disposeCalls)).toEqual([1, 1]);
      expect(fixture.requests.map((resource) => resource.disposeCalls)).toEqual([1, 1]);
    } finally {
      await fixture.cleanup();
    }
  },
);

test("an old expiry callback cannot rearm or dispose a replacement session", async () => {
  const ttl = 60_000;
  const fixture = sessionFixture(ttl);
  const schedule = spyOn(globalThis, "setTimeout");
  const sessionTimers = () => schedule.mock.calls.filter(([, delay]) => delay === ttl);
  try {
    const old = fixture.start("same");
    const oldResources = await old.entered;
    await old.finish();
    expect(sessionTimers()).toHaveLength(1);
    const expireOld = sessionTimers()[0]![0];
    await fixture.app.disposeSession("same");
    expect(oldResources.session.disposeCalls).toBe(1);

    const current = fixture.start("same");
    const currentResources = await current.entered;
    // Deliver the old generation's callback after cancellation to control
    // the race independently of the host timer queue.
    expireOld();
    await Bun.sleep(1);
    expect(currentResources.session.disposeCalls).toBe(0);
    expect(sessionTimers()).toHaveLength(1);

    await current.finish();
    expect(sessionTimers()).toHaveLength(2);
    expireOld();
    await Bun.sleep(1);
    expect(currentResources.session.disposeCalls).toBe(0);
    expect(sessionTimers()).toHaveLength(2);

    await fixture.app.stop();
    expireOld();
    await Bun.sleep(1);
    expect(fixture.sessions.map((resource) => resource.disposeCalls)).toEqual([1, 1]);
    expect(sessionTimers()).toHaveLength(2);
  } finally {
    await fixture.cleanup();
    schedule.mockRestore();
  }
});

test("concurrent explicit disposal and stop wait for replaced sessions without leaking timers", async () => {
  const ttl = 60_000;
  const fixture = sessionFixture(ttl);
  const firstCleaning = Promise.withResolvers<void>();
  const secondCleaning = Promise.withResolvers<void>();
  const sessionsCleaned = Promise.withResolvers<void>();
  const firstGate = Promise.withResolvers<void>();
  const secondGate = Promise.withResolvers<void>();
  const oldFailure = new Error("old session cleanup failed");
  const currentFailure = new Error("current session cleanup failed");
  const root = new Resource();
  fixture.app.injectValue(token<Resource>("root resource"), root);
  const schedule = spyOn(globalThis, "setTimeout");
  const clear = spyOn(globalThis, "clearTimeout");
  const pending: Promise<unknown>[] = [];
  try {
    const first = fixture.start("same");
    const firstResources = await first.entered;
    firstResources.session.onDispose = async () => {
      firstCleaning.resolve();
      await firstGate.promise;
      throw oldFailure;
    };
    const firstDisposals = Promise.allSettled([
      fixture.app.disposeSession("same"),
      fixture.app.disposeSession("same"),
    ]);
    pending.push(firstDisposals);
    await firstCleaning.promise;

    const second = fixture.start("same");
    const secondResources = await second.entered;
    secondResources.session.onDispose = async () => {
      secondCleaning.resolve();
      await secondGate.promise;
    };
    const secondDisposal = Promise.allSettled([fixture.app.disposeSession("same")]);
    pending.push(secondDisposal);
    await secondCleaning.promise;

    const current = fixture.start("same");
    const currentResources = await current.entered;
    currentResources.session.onDispose = () => {
      throw currentFailure;
    };
    const other = fixture.start("other");
    const otherResources = await other.entered;
    otherResources.session.onDispose = () => sessionsCleaned.resolve();
    await current.finish();
    await other.finish();
    const timers = schedule.mock.calls.flatMap(([, delay], index) =>
      delay === ttl ? [schedule.mock.results[index]!.value] : [],
    );
    expect(timers).toHaveLength(2);

    let stopSettled = false;
    const stops = Promise.allSettled([fixture.app.stop(), fixture.app.stop()]).then((results) => {
      stopSettled = true;
      return results;
    });
    pending.push(stops);
    await sessionsCleaned.promise;
    expect(currentResources.session.disposeCalls).toBe(1);
    expect(otherResources.session.disposeCalls).toBe(1);
    expect(root.disposeCalls).toBe(0);
    expect(stopSettled).toBe(false);
    for (const timer of timers) {
      expect(clear.mock.calls.some(([actual]) => actual === timer)).toBe(true);
    }

    expect(await (await first.finish()).json()).toBe(1);
    expect(await (await second.finish()).json()).toBe(1);
    expect(schedule.mock.calls.filter(([, delay]) => delay === ttl)).toHaveLength(2);
    firstGate.resolve();
    expect(await firstDisposals).toEqual([
      { status: "rejected", reason: oldFailure },
      { status: "fulfilled", value: undefined },
    ]);
    await Bun.sleep(IDLE_TTL * 3);
    expect(stopSettled).toBe(false);
    expect(root.disposeCalls).toBe(0);

    secondGate.resolve();
    expect(await secondDisposal).toEqual([{ status: "fulfilled", value: undefined }]);
    for (const result of await stops) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AggregateError);
        expect(result.reason.errors).toEqual([currentFailure, oldFailure]);
      }
    }
    expect(root.disposeCalls).toBe(1);
    await fixture.app.stop().catch(() => {});
    expect(fixture.sessions.map((resource) => resource.disposeCalls)).toEqual([1, 1, 1, 1]);
    expect(fixture.requests.map((resource) => resource.disposeCalls)).toEqual([1, 1, 1, 1]);
    expect(schedule.mock.calls.filter(([, delay]) => delay === ttl)).toHaveLength(2);
  } finally {
    firstGate.resolve();
    secondGate.resolve();
    await Promise.allSettled(pending);
    await fixture.cleanup();
    clear.mockRestore();
    schedule.mockRestore();
  }
});
