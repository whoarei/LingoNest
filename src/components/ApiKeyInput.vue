<script setup lang="ts">
import { ref, watch } from "vue";
import Icon from "./AppIcon.vue";

defineProps<{ id: string; label: string; placeholder: string; inputLabel?: string }>();
const value = defineModel<string>({ required: true });
const visible = ref(false);
watch(value, key => { if (!key) visible.value = false; });
</script>

<template>
  <div class="api-key-input">
    <input
      :id="id"
      :aria-label="inputLabel"
      v-model="value"
      :type="visible ? 'text' : 'password'"
      :placeholder="placeholder"
      autocomplete="new-password"
      autocapitalize="none"
      :spellcheck="false"
      style="padding-right: 58px; margin: 0"
    />
    <button
      class="api-key-toggle"
      type="button"
      :aria-label="`${visible ? '隐藏' : '显示'}${label}`"
      :title="visible ? '隐藏密钥' : '显示密钥'"
      :aria-controls="id"
      :aria-pressed="visible"
      @click="visible = !visible"
    ><Icon :name="visible ? 'eye-off' : 'eye'" /></button>
  </div>
</template>

<style scoped>
.api-key-input { position: relative; min-width: 0; margin: 8px 0 18px; }
.api-key-toggle {
  position: absolute; top: 4px; right: 4px; bottom: 4px;
  display: flex; align-items: center; justify-content: center;
  min-width: 44px; min-height: 44px; padding: 8px;
  border: 0; border-radius: 8px; background: transparent;
  color: #254e3d; font: inherit; font-size: 14px; cursor: pointer;
}
.api-key-toggle:focus-visible { outline: 2px solid #254e3d; outline-offset: -2px; }
</style>
