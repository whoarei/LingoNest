import { expect, test, type Page } from "@playwright/test";

async function appearance(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return Object.fromEntries([
      "font-family", "font-size", "line-height", "color", "background-color",
      "border-radius", "border-width", "padding", "margin", "width", "box-sizing",
      "--green", "--orange", "--muted", "--line",
    ].map((name) => [name, style.getPropertyValue(name)]));
  });
}

for (const width of [390, 1280]) {
  test(`flex-gap fallback preserves spacing and stays inside the mode (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // Emulate the old WebView's feature-probe result, then remove native gap
    // so measured spacing must come from the real fallback stylesheet.
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight")!;
      Object.defineProperty(Element.prototype, "scrollHeight", {
        ...descriptor,
        get() {
          if (this instanceof HTMLElement && this.style.rowGap === "1px" && this.style.top === "-9999px") return 0;
          return descriptor.get!.call(this);
        },
      });
    });
    await page.goto("/");
    await page.getByLabel("先给自己起个昵称").fill("间距测试");
    await page.getByRole("button", { name: "建立我的小窝" }).click();
    await expect(page.locator(".profile-chip")).toBeVisible();
    await page.addStyleTag({ content: ".seven-step-mode .brand, .seven-step-mode .topbar-actions, .seven-step-mode .profile-chip { gap: 0 !important; }" });
    await expect(page.locator(".brand-symbol")).toHaveCSS("margin-right", "11px");
    await expect(page.locator(".avatar-mini")).toHaveCSS("margin-right", "7px");
    await expect(page.locator(".topbar-actions > .icon-button")).toHaveCSS("margin-left", "12px");
    await expect(page.locator(".seven-step-mode")).toHaveClass(/no-flex-gap/);
    await expect(page.locator("html")).not.toHaveClass(/no-flex-gap/);
    const brandGap = await page.locator(".brand").evaluate((brand) => {
      const [button, label] = [...brand.children];
      return label!.getBoundingClientRect().left - button!.getBoundingClientRect().right;
    });
    expect(brandGap).toBeCloseTo(11);
    await page.evaluate(() => {
      const other = document.createElement("section");
      other.id = "other-mode";
      other.innerHTML = '<button class="brand-symbol">Other mode</button>';
      document.body.append(other);
    });
    await expect(page.locator("#other-mode .brand-symbol")).toHaveCSS("margin-right", "0px");
    await page.evaluate(() => {
      const host = document.getElementById("app")! as HTMLElement & { __vue_app__: { unmount(): void } };
      host.__vue_app__.unmount();
      host.append(document.getElementById("other-mode")!);
    });
    await expect(page.locator("html")).not.toHaveClass(/no-flex-gap/);
    await expect(page.locator("#other-mode .brand-symbol")).toHaveCSS("margin-right", "0px");
  });

  test(`seven-step theme stays inside its root before and after unmount (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // Load the real application only after capturing a neutral experience's styles.
    await page.route("**/mode-isolation-harness", (route) => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><style>body { margin: 0; }</style></head><body>
        <div id="app"></div><section id="other-mode"><h1 class="page">Other mode</h1>
        <button>Continue</button><input value="Independent input"><span class="spinner">Busy</span></section>
        </body></html>`,
    }));
    await page.goto("/mode-isolation-harness");
    const selectors = ["html", "body", "#other-mode h1", "#other-mode button", "#other-mode input", "#other-mode .spinner"];
    const baseline = await Promise.all(selectors.map((selector) => appearance(page, selector)));
    await page.evaluate(async () => {
      const entry = "/src/main.ts";
      await import(/* @vite-ignore */ entry);
    });
    await expect(page.getByLabel("先给自己起个昵称")).toBeVisible();
    await expect(page.locator(".seven-step-mode")).not.toHaveClass(/no-flex-gap/);
    await expect(page.locator("html")).not.toHaveClass(/no-flex-gap/);
    await expect(page.locator(".brand-symbol")).toHaveCSS("margin-right", "0px");
    await expect(page.locator(".seven-step-mode")).toHaveCSS("background-color", "rgb(247, 246, 240)");
    await expect(page.locator(".seven-step-mode input").first()).toHaveCSS("border-radius", "12px");
    expect(await Promise.all(selectors.map((selector) => appearance(page, selector)))).toEqual(baseline);

    // Inspect nested media rules as well; keyframes use a private name too.
    const leaks = await page.evaluate(() => {
      const problems: string[] = [];
      const visit = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if (rule instanceof CSSKeyframesRule) {
            if (!rule.name.startsWith("seven-step-")) problems.push(rule.cssText);
          } else if (rule instanceof CSSStyleRule) {
            if (rule.selectorText.split(",").some((selector) => !selector.trim().startsWith(".seven-step-mode"))) problems.push(rule.selectorText);
          } else if ("cssRules" in rule) visit((rule as CSSMediaRule).cssRules);
        }
      };
      const sheets = [...document.querySelectorAll<HTMLStyleElement>("style[data-vite-dev-id]")]
        .filter((style) => style.dataset.viteDevId?.replaceAll("\\", "/").endsWith("/seven-step/style.css"));
      if (sheets.length !== 1) problems.push(`expected seven-step stylesheet, got ${sheets.length}`);
      for (const style of sheets) visit(style.sheet!.cssRules);
      return problems;
    });
    expect(leaks).toEqual([]);
    await page.evaluate(() => {
      const host = document.getElementById("app")! as HTMLElement & { __vue_app__: { unmount(): void } };
      host.__vue_app__.unmount();
      // Simulate the next independent mode using the same host after unload.
      host.append(document.getElementById("other-mode")!);
    });
    await expect(page.locator(".seven-step-mode")).toHaveCount(0);
    expect(await Promise.all(selectors.map((selector) => appearance(page, selector)))).toEqual(baseline);
    await expect(page.locator("#other-mode .spinner")).toHaveCSS("animation-name", "none");
  });
}
