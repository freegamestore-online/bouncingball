import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => vi.restoreAllMocks());

it("runs the render loop on the menu screen so the menu is drawn", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  render(<App />);
  expect(raf).toHaveBeenCalled();
});
