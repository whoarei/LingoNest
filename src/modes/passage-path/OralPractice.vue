<script setup lang="ts">
import type { PassageQuestion, PassageResponse } from "../../../packages/learning-modes/passage-path/model";
defineProps<{ question: Extract<PassageQuestion, { kind: "speak" }>; response: PassageResponse; recording: boolean; disabled: boolean; microphoneDenied: boolean }>();
defineEmits<{ record: []; hear: []; rate: [value: "ready" | "again"]; settings: [] }>();
</script>
<template>
  <section class="passage-oral" aria-label="口语练习">
    <p>先说给同伴听，再回听自己的录音。自评帮助安排练习，不自动判断发音对错。</p>
    <ul><li v-for="criterion in question.criteria" :key="criterion">{{ criterion }}</li></ul>
    <button :disabled="disabled" @click="$emit('record')">{{ recording ? '结束录音并保存' : response.oral ? '重新录制' : '开始录音' }}</button>
    <p v-if="recording" role="status">正在录音，请说出完整回应。</p>
    <template v-if="response.oral && !recording">
      <button :disabled="disabled" @click="$emit('hear')">回听我的录音</button>
      <p v-if="!response.oral.listened">请完整回听，再选择自己的感受。</p>
      <fieldset :disabled="disabled || !response.oral.listened"><legend>回听后的自评</legend>
        <label class="passage-check"><input type="radio" name="oral-rating" value="ready" :checked="response.oral.selfRating === 'ready'" @change="$emit('rate', 'ready')" />我能说清楚</label>
        <label class="passage-check"><input type="radio" name="oral-rating" value="again" :checked="response.oral.selfRating === 'again'" @change="$emit('rate', 'again')" />还想再练一练</label>
      </fieldset>
    </template>
    <p v-if="microphoneDenied" class="passage-note">麦克风未获允许。请家长在设备设置中开启权限，再继续这道口语题。<button @click="$emit('settings')">请家长开启麦克风</button></p>
  </section>
</template>
