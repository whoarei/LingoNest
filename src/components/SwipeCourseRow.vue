<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
const props = defineProps<{
  removable: boolean;
  disabled: boolean;
  open: boolean;
  title: string;
}>();
const emit = defineEmits<{ remove: []; "update:open": [value: boolean] }>();
const root = ref<HTMLElement | null>(null),
  offset = ref(0),
  dragging = ref(false);
let pointer: number | null = null,
  startX = 0,
  startY = 0,
  startOffset = 0;
let direction: "pending" | "horizontal" | "vertical" = "pending";
let suppressUntil = 0;
// Mouse drags can end outside the row; keep the next gesture usable without capturing vertical scrolling.
function cancel(event: PointerEvent) {
  if (event.pointerId === pointer) reset();
}
onMounted(() => {
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerup", up);
  window.removeEventListener("pointercancel", cancel);
});
watch(
  () => props.open,
  (open) => {
    if (!dragging.value) offset.value = open ? -88 : 0;
  },
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) reset();
  },
);
function reset() {
  pointer = null;
  dragging.value = false;
  offset.value = 0;
  emit("update:open", false);
}
function down(event: PointerEvent) {
  if (
    !props.removable ||
    props.disabled ||
    !event.isPrimary ||
    event.button !== 0 ||
    pointer !== null ||
    (event.target as HTMLElement).closest(".swipe-delete")
  )
    return;
  pointer = event.pointerId;
  startX = event.clientX;
  startY = event.clientY;
  startOffset = offset.value;
  direction = "pending";
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  const dx = event.clientX - startX,
    dy = event.clientY - startY;
  if (direction === "pending") {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
    if (Math.abs(dy) >= Math.abs(dx) || (dx > 0 && !startOffset)) {
      direction = "vertical";
      return;
    }
    direction = "horizontal";
    dragging.value = true;
    root.value?.setPointerCapture(event.pointerId);
  }
  if (direction !== "horizontal") {
    if (direction === "vertical") suppressUntil = Date.now() + 350;
    return;
  }
  event.preventDefault();
  offset.value = Math.max(-220, Math.min(0, startOffset + dx));
}
function up(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  pointer = null;
  if (direction !== "horizontal") {
    if (direction === "vertical") suppressUntil = Date.now() + 350;
    return;
  }
  dragging.value = false;
  suppressUntil = Date.now() + 350;
  const threshold = Math.min(
    150,
    Math.max(105, (root.value?.clientWidth ?? 300) * 0.4),
  );
  if (-offset.value >= threshold) {
    reset();
    emit("remove");
  } else {
    const open = -offset.value > 38;
    offset.value = open ? -88 : 0;
    emit("update:open", open);
  }
}
function click(event: MouseEvent) {
  if ((event.target as HTMLElement).closest(".swipe-delete")) return;
  if (Date.now() < suppressUntil) {
    event.preventDefault();
    event.stopPropagation();
  } else if (offset.value) {
    event.preventDefault();
    event.stopPropagation();
    reset();
  }
}
</script>
<template>
  <div
    ref="root"
    class="swipe-course-row"
    :class="{ dragging }"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="cancel"
    @click.capture="click"
  >
    <div
      class="swipe-course-content"
      :style="{ transform: `translateX(${offset}px)` }"
    >
      <slot />
    </div>
    <button
      v-if="removable"
      class="swipe-delete"
      :aria-label="`删除课程：${title}`"
      :disabled="disabled"
      @focus="
        offset = -88;
        emit('update:open', true);
      "
      @click.stop="
        reset();
        emit('remove');
      "
    >
      删除
    </button>
  </div>
</template>
<style scoped>
.swipe-course-row { position:relative; overflow:hidden; border-radius:13px; touch-action:pan-y; }
.swipe-course-content { position:relative; z-index:1; background:#f7f6f0; transition:transform .18s ease; }
.dragging .swipe-course-content { transition:none; }
.swipe-delete { position:absolute; right:0; top:0; bottom:0; width:88px; background:#a84f3a; color:white; border:0; border-radius:0 13px 13px 0; font:inherit; cursor:pointer; }
@media(prefers-reduced-motion:reduce) { .swipe-course-content { transition:none; } }
</style>
