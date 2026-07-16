import { expect, test, afterEach } from "bun:test";
import { setApiKey, getApiKey, deleteApiKey } from "./keychain";

const P = "ccm-test-kc";

afterEach(async () => {
  await deleteApiKey(P);
});

test("getApiKey returns null when absent", async () => {
  expect(await getApiKey("ccm-test-absent")).toBeNull();
});

test("set then get round-trips", async () => {
  await setApiKey(P, "sk-ant-test-123");
  expect(await getApiKey(P)).toBe("sk-ant-test-123");
});

test("set overwrites an existing key", async () => {
  await setApiKey(P, "sk-ant-old");
  await setApiKey(P, "sk-ant-new");
  expect(await getApiKey(P)).toBe("sk-ant-new");
});

test("delete removes the key", async () => {
  await setApiKey(P, "sk-ant-test-123");
  await deleteApiKey(P);
  expect(await getApiKey(P)).toBeNull();
});

test("deleteApiKey on missing key does not throw", async () => {
  await deleteApiKey("ccm-test-absent");
});
