/* Mediul testelor unitare: jsdom, curatarea React intre teste si API-urile de
   browser pe care jsdom nu le are (URL.createObjectURL, window.open, confirm). */
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

if (!URL.createObjectURL) URL.createObjectURL = () => "blob:test";
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
