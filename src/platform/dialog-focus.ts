import { watch, type Ref } from "vue";

/** Keep a modal keyboard interaction inside its panel and return to its trigger. */
export function useDialogFocus(panel: Ref<HTMLElement | null>, dismiss: () => void, canDismiss: () => boolean = () => true, opened?: () => boolean) {
  let openingFocus: HTMLElement | null = null;
  // Capture before rendering disables the trigger, which would blur it.
  if (opened) watch(opened, value => { if (value) openingFocus = document.activeElement as HTMLElement | null; }, { flush: "sync" });
  watch(panel, (element, _previous, cleanup) => {
    if (!element) return;
    const previousFocus = openingFocus ?? document.activeElement as HTMLElement | null;
    openingFocus = null;
    const controls = () => [...element.querySelectorAll<HTMLElement>(
      'button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])',
    )].filter(control => !control.matches(":disabled") && control.tabIndex >= 0 && control.getClientRects().length > 0);
    (controls()[0] ?? element).focus({ preventScroll: true });
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (canDismiss()) dismiss();
      }
      if (event.key !== "Tab") return;
      const available = controls(), first = available[0], last = available[available.length - 1];
      if (!first) { event.preventDefault(); element!.focus(); }
      else if (!element!.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keyboard, true);
    cleanup(() => {
      document.removeEventListener("keydown", keyboard, true);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    });
  }, { flush: "post" });
}
