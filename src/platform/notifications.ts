import { inject, watch, type InjectionKey, type Ref } from "vue";

export type Notify = (message: string, kind?: "error" | "status") => void;
export const notificationKey: InjectionKey<Notify> = Symbol("application-notification");

/** Shared controls may run inside the application or in a standalone preview. */
export function useOperationNotices(message: Ref<string>, error: Ref<string>) {
  const notify = inject(notificationKey, undefined);
  watch(message, value => { if (value) notify?.(value); });
  watch(error, value => { if (value) notify?.(value, "error"); });
  return !!notify;
}
