import { afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Root } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost:3000" });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SubscriptionDialog } = await import("../SubscriptionSection");

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderDialog(onCheckout: (planId: string) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root?.render(
      <SubscriptionDialog
        loadingPlanId={null}
        monthlyPlanId="plan_monthly"
        onCheckout={onCheckout}
        onOpenChange={() => undefined}
        open
        yearlyPlanId="plan_yearly"
      />
    )
  );
}

function button(name: string) {
  const match = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name
  );
  expect(match).toBeDefined();
  return match as HTMLButtonElement;
}

test("checks out the yearly plan unless another plan is picked", async () => {
  const onCheckout = mock((_planId: string) => undefined);
  await renderDialog(onCheckout);

  await act(() => button("Continue to checkout").click());
  expect(onCheckout).toHaveBeenLastCalledWith("plan_yearly");

  const monthly = document.querySelector<HTMLInputElement>(
    'input[type="radio"][value="plan_monthly"]'
  );
  expect(monthly).not.toBeNull();
  await act(() => monthly?.click());
  await act(() => button("Continue to checkout").click());
  expect(onCheckout).toHaveBeenLastCalledWith("plan_monthly");
});
