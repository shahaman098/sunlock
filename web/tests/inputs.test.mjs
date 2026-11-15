import { test } from "node:test";
import assert from "node:assert/strict";
import { readLanderParams } from "../.build/inputs.js";

test("shared links restore panel and battery recommendations across the supported input ranges", () => {
  for (const array of [0.1, 0.3, 4, 50, 50.1, 500]) {
    for (const battery of [0.1, 0.3, 1, 10, 200, 200.1, 1000]) {
      const hash = new URLSearchParams({ load: "100", heater: "0", array: String(array), battery: String(battery) });
      assert.deepEqual(readLanderParams(hash), { load: 100, heater: 0, array, battery });
    }
  }
});

test("shared links reject invalid numbers and values outside supported lander limits", () => {
  for (const value of ["", " ", "NaN", "Infinity", "-1", "junk"]) {
    const params = new URLSearchParams({ load: value, heater: value, array: value, battery: value });
    assert.deepEqual(readLanderParams(params), { load: undefined, heater: undefined, array: undefined, battery: undefined });
  }
  assert.deepEqual(readLanderParams(new URLSearchParams("load=2001&heater=2001&array=501&battery=1001")), {
    load: undefined, heater: undefined, array: undefined, battery: undefined,
  });
});
