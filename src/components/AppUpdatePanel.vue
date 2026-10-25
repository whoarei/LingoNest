<script setup lang="ts">
import type { UnwrapNestedRefs } from "vue";
import type { createAppUpdate } from "../platform/app-update";
import { releasePage } from "../platform/app-update";
defineProps<{ updates: UnwrapNestedRefs<ReturnType<typeof createAppUpdate>>; prepareInstall: () => Promise<void> }>();
const size = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";
</script>

<template>
  <section class="app-update-panel" aria-label="版本与更新">
    <p>当前版本 {{ updates.currentVersion }}</p>
    <p v-if="updates.unsupportedReason">{{ updates.unsupportedReason }}</p>
    <button class="frame-button secondary" :disabled="updates.busy" @click="updates.check()">{{ updates.checking ? '正在检查更新…' : '检查更新' }}</button>
    <div v-if="updates.available && updates.latest" class="frame-section">
      <h2>新版本 {{ updates.latest.versionName }}</h2>
      <p>安装包 {{ size(updates.latest.size) }}</p>
      <p v-if="!updates.compatible">此更新需要 Android API {{ updates.latest.minSdkVersion }} 或更高版本。</p>
      <h3>更新说明</h3>
      <p class="update-notes">{{ updates.latest.notes }}</p>
      <template v-if="updates.downloading">
        <progress :value="updates.received" :max="updates.latest.size" aria-label="更新下载进度" />
        <p v-if="updates.received >= updates.latest.size" role="status">下载完成，正在校验安装包…</p>
        <p v-else role="status">已下载 {{ size(updates.received) }} / {{ size(updates.latest.size) }}</p>
        <button class="frame-button secondary" @click="updates.cancel()">取消下载</button>
      </template>
      <div v-else class="frame-actions">
        <button v-if="!updates.downloaded" class="frame-button" :disabled="updates.busy || !updates.compatible" @click="updates.download()">下载更新</button>
        <button v-else class="frame-button" :disabled="updates.busy || !updates.compatible" @click="updates.install(prepareInstall)">{{ updates.installing ? '正在准备安装…' : '安装更新' }}</button>
        <button v-if="updates.downloaded" class="frame-button secondary" :disabled="updates.busy" @click="updates.download()">重新下载</button>
      </div>
    </div>
    <p v-if="updates.message" role="status">{{ updates.message }}</p>
    <p v-if="updates.error" class="frame-error" role="alert">{{ updates.error }}</p>
    <p class="frame-caption">下载由你确认，安装由 Android 系统确认。安装前会保存当前进度。</p>
    <p class="frame-caption">若系统询问本次安装并显示“记住我的选择”，请保持未勾选。是否支持每次询问由手机系统决定。</p>
    <template v-if="updates.info?.supported && updates.info.sdkVersion >= 26">
      <p class="frame-caption">之前开启的长期安装来源权限需在系统设置中手动关闭。</p>
      <button class="frame-button secondary" :disabled="updates.busy" @click="updates.openInstallSettings()">管理安装来源权限</button>
    </template>
    <a :href="releasePage" target="_blank" rel="noopener noreferrer">前往 GitHub 发布页</a>
  </section>
</template>

<style scoped>
.update-notes { white-space: pre-wrap; overflow-wrap: break-word; overflow-wrap: anywhere; }
progress { width: 100%; max-width: 480px; height: 18px; accent-color: #254e3d; }
</style>
