import { expectTypeOf, test } from "bun:test";
import type { JoinPath as CoreJoinPath, PathParams as CorePathParams } from "@zebra/core";
import type { JoinPath, PathParams } from "../src/path.ts";

test("vendored PathParams is structurally identical to core's", () => {
  expectTypeOf<PathParams<"/a/:id">>().toEqualTypeOf<CorePathParams<"/a/:id">>();
  expectTypeOf<PathParams<"/a/:id/comments/:cid">>().toEqualTypeOf<
    CorePathParams<"/a/:id/comments/:cid">
  >();
  expectTypeOf<PathParams<"/static">>().toEqualTypeOf<CorePathParams<"/static">>();
  expectTypeOf<PathParams<"/a/*rest">>().toEqualTypeOf<CorePathParams<"/a/*rest">>();
  expectTypeOf<PathParams<string>>().toEqualTypeOf<CorePathParams<string>>();
});

test("vendored JoinPath is structurally identical to core's", () => {
  expectTypeOf<JoinPath<"/api", "/blogs">>().toEqualTypeOf<CoreJoinPath<"/api", "/blogs">>();
  expectTypeOf<JoinPath<"/api", "blogs">>().toEqualTypeOf<CoreJoinPath<"/api", "blogs">>();
});
