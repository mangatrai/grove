import { describe, expect, it } from "vitest";

import {
  idsControlledByParent,
  parentSelectedCount,
  toggleMultiValue,
  toggleParentMultiSelection
} from "./hierarchicalPickerMultiSelect.js";

const parent = {
  selectableValue: "parent-id",
  children: [{ value: "child-a" }, { value: "child-b" }]
};

describe("toggleMultiValue", () => {
  it("adds and removes a single value", () => {
    expect(toggleMultiValue([], "child-a")).toEqual(["child-a"]);
    expect(toggleMultiValue(["child-a", "child-b"], "child-a")).toEqual(["child-b"]);
  });
});

describe("toggleParentMultiSelection", () => {
  it("selects the parent value and all children together", () => {
    expect(toggleParentMultiSelection([], parent)).toEqual(["parent-id", "child-a", "child-b"]);
  });

  it("deselects the parent value and all children when already fully selected", () => {
    expect(toggleParentMultiSelection(["parent-id", "child-a", "child-b", "other"], parent)).toEqual(["other"]);
  });

  it("leaves unrelated selections untouched when partially selected", () => {
    expect(toggleParentMultiSelection(["child-a", "other"], parent)).toEqual([
      "child-a",
      "other",
      "parent-id",
      "child-b"
    ]);
  });
});

describe("idsControlledByParent", () => {
  it("includes the parent selectable value and child values", () => {
    expect(idsControlledByParent(parent)).toEqual(["parent-id", "child-a", "child-b"]);
    expect(idsControlledByParent({ selectableValue: null, children: [{ value: "only-child" }] })).toEqual([
      "only-child"
    ]);
  });
});

describe("parentSelectedCount", () => {
  it("counts selected parent and child values", () => {
    expect(parentSelectedCount(parent, ["parent-id", "child-b", "other"])).toBe(2);
    expect(parentSelectedCount(parent, ["parent-id", "child-a", "child-b"])).toBe(3);
  });
});
