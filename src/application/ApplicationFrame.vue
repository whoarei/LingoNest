<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onScopeDispose, provide, reactive, ref, shallowRef, watch } from "vue";
import type { CatalogSnapshot, MaterialCourse } from "../../packages/learning-modes/catalog";
import type { ModeOverview } from "../../packages/learning-modes/contracts";
import { applicationServicesKey } from "./services";
import { type ModeSurface } from "./workspace";
import { createModeSelection, modeSelectionKey, modeSelectionView } from "../platform/mode-selection";
import { readModeOverview } from "../platform/mode-overview";
import { teachingModes } from "../modes/registry";
import { isAndroid, native } from "../native";
import { useSpeech, speechConfigurationKey } from "../platform/speech";
import { notificationKey } from "../platform/notifications";
import { useDialogFocus } from "../platform/dialog-focus";
import ModeHost from "../modes/ModeHost.vue";
import Icon from "../components/AppIcon.vue";
import CourseModeSettings from "../components/CourseModeSettings.vue";
import ContentSettings from "../components/ContentSettings.vue";
import SpeechSettings from "../components/SpeechSettings.vue";
import SourceImages from "../components/SourceImages.vue";
import SwipeCourseRow from "../components/SwipeCourseRow.vue";
import MaterialEditor from "./MaterialEditor.vue";
import CourseResources from "./CourseResources.vue";
import "./application.css";
type Page = "learn" | "courses" | "records" | "record" | "overview" | "settings" | "profiles" | "detail" | "material" | "plugin";
const services = inject(applicationServicesKey)!;
const selection = createModeSelection(teachingModes.modes, teachingModes.defaultModeId);
provide(modeSelectionKey, modeSelectionView(selection));
const directory = ref<CatalogSnapshot>({ learners: [], activeLearnerId: null, defaultCourseId: "", learningCourseIds: {}, courses: [] });
const noFlexGap = ref(false);
const overviews = shallowRef<Record<string, ModeOverview>>({});
const overviewErrors = ref<Record<string, string>>({});
const page = ref<Page>("learn"), parent = ref(false), ready = ref(false), busy = ref(false), error = ref(""), notice = ref("");
const initializing = ref(true);
const navigating = ref(false);
const exiting = ref(false);
const host = ref<InstanceType<typeof ModeHost> | null>(null);
const materialEditor = ref<InstanceType<typeof MaterialEditor> | null>(null);
const courseResources = ref<InstanceType<typeof CourseResources> | null>(null);
const editorKey = ref(0), editing = ref(false);
const pluginModeId = ref(selection.activeModeId.value), surface = ref<ModeSurface>("learning"), pluginCourseId = ref<string | null>(null);
const activation = ref(0);
const pluginReturnPage = ref<Page>("records");
const pluginReturnLabel = computed(() => ({ learn: "返回学习空间", overview: "返回家长概况", detail: "返回课程详情", courses: "返回课程列表", record: "返回作答详情" } as Partial<Record<Page, string>>)[pluginReturnPage.value] ?? "返回学习记录");
const managedId = ref<string | null>(null), detailTab = ref<"material" | "modes" | "resources">("modes");
const nickname = ref(""), rename = ref(""), creating = ref(false), deleted = ref(false), swipeId = ref<string | null>(null);
const recordMode = ref(""), recordCourse = ref("");
const recordPage = ref(1), recordPageSize = 50;
const selectedRecordKey = ref<{ learnerId: string | null; modeId: string; id: string } | null>(null);
const selectedRecord = computed(() => {
    const key = selectedRecordKey.value;
    if (!key || key.learnerId !== directory.value.activeLearnerId) return null;
    const record = overviews.value[key.modeId]?.records.find(item => item.id === key.id);
    return record ? { ...record, modeId: key.modeId } : null;
});
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string, kind: "error" | "status" = "status") {
    if (!message) return;
    if (kind === "error") error.value = message;
    else { error.value = ""; notice.value = message; }
}
provide(notificationKey, notify);
watch(notice, value => { clearTimeout(noticeTimer); if (value) noticeTimer = setTimeout(() => { notice.value = ""; }, 6500); });
onScopeDispose(() => clearTimeout(noticeTimer));
const returnPage = ref<Page>("learn"), exitPrompt = ref(false);
const returnLabel = computed(() => returnPage.value === "plugin"
    ? surface.value === "authoring" ? "返回内容准备" : surface.value === "confirm" ? `返回${confirmationLabel(pluginModeId.value) ?? "模式确认"}` : "返回学习报告"
    : ({ learn: "返回学习空间", courses: "返回课程列表", detail: "返回课程详情", profiles: "返回孩子档案", records: "返回学习记录", record: "返回作答详情" } as Partial<Record<Page, string>>)[returnPage.value] ?? "返回家长空间");
const pendingAction = shallowRef<null | (() => Promise<void>)>(null), actionLabel = ref(""), adultAnswer = ref("");
let finishAuthorization: (() => void) | undefined;
function cancelAuthorization() {
    pendingAction.value = null;
    const finish = finishAuthorization; finishAuthorization = undefined; finish?.();
}
const adultDialog = ref<HTMLElement | null>(null), exitDialog = ref<HTMLElement | null>(null), deleteDialog = ref<HTMLElement | null>(null);
const adultUnlocked = ref(false);
const deletion = ref<{
    kind: "learner" | "course";
    id: string;
    name: string;
} | null>(null), deleteName = ref("");
useDialogFocus(adultDialog, cancelAuthorization, () => true, () => !!pendingAction.value);
useDialogFocus(exitDialog, () => { exitPrompt.value = false; }, () => !exiting.value, () => exitPrompt.value);
useDialogFocus(deleteDialog, () => { deletion.value = null; }, () => !busy.value, () => !!deletion.value);
const speech = useSpeech({ courseId: "application-settings", courseVersion: "1", title: "英语小窝", assets: [] });
const speechSettings = reactive(speech);
provide(speechConfigurationKey, speech.configuration);
const learner = computed(() => directory.value.learners.find(item => item.id === directory.value.activeLearnerId));
const currentCourseId = computed(() => directory.value.learningCourseIds[learner.value?.id ?? ""] ?? directory.value.defaultCourseId);
const currentCourse = computed(() => directory.value.courses.find(item => item.id === currentCourseId.value));
const managed = computed(() => directory.value.courses.find(item => item.id === managedId.value) ?? null);
const modeTitle = computed(() => selection.modes.find(item => item.id === selection.activeModeId.value)?.title ?? "当前模式不可用");
const pluginVisible = computed(() => page.value === "learn" && !!learner.value || page.value === "plugin");
const focused = computed(() => pluginVisible.value && !!host.value?.adapter?.focused);
const locked = computed(() => initializing.value || busy.value || navigating.value || exiting.value || selection.busy.value || !!pendingAction.value || !!host.value?.adapter?.busy || !!courseResources.value?.busy);
const resources = computed(() => Object.values(overviews.value).flatMap(item => item.resources ?? []).filter(item => item.manifest.courseId === managedId.value));
const reading = computed(() => managed.value ?? currentCourse.value);
const reader = useSpeech(computed(() => overviews.value[selection.activeModeId.value]?.resources?.find(item => item.current && item.manifest.courseId === reading.value?.id)?.manifest ??
    { courseId: reading.value?.id ?? "application-reader", courseVersion: reading.value?.sourceRevision ?? "1", title: reading.value?.title ?? "教材原文", assets: [] }), speech.configuration);
const courses = computed(() => directory.value.courses.filter(item => !!item.archivedAt === (parent.value && deleted.value)));
watch([parent, () => directory.value.courses.some(item => item.archivedAt)], ([isParent, hasArchived]) => {
    if (!isParent || !hasArchived) deleted.value = false;
});
const filteredRecords = computed(() => Object.entries(overviews.value).flatMap(([modeId, overview]) => overview.records.map(item => ({ ...item, modeId })))
    .filter(item => (!recordMode.value || item.modeId === recordMode.value) && (!recordCourse.value || item.courseId === recordCourse.value))
    .sort((a, b) => b.at.localeCompare(a.at)));
const recordPageCount = computed(() => Math.max(1, Math.ceil(filteredRecords.value.length / recordPageSize)));
const records = computed(() => filteredRecords.value.slice((recordPage.value - 1) * recordPageSize, recordPage.value * recordPageSize));
watch([recordMode, recordCourse, () => learner.value?.id], () => { recordPage.value = 1; });
watch(recordPageCount, count => { recordPage.value = Math.min(recordPage.value, count); });
function changeRecordPage(delta: number) {
    recordPage.value = Math.max(1, Math.min(recordPageCount.value, recordPage.value + delta));
    window.scrollTo({ top: 0, behavior: "instant" });
}
const pendingCount = computed(() => Object.values(overviews.value).reduce((sum, overview) => sum + overview.pendingCount, 0));
const nav = computed(() => parent.value
    ? [{ id: "overview", label: "概况", icon: "home" }, { id: "courses", label: "课程", icon: "book" }, { id: "records", label: "记录", icon: "chart" }, { id: "settings", label: "设置", icon: "settings" }]
    : [{ id: "learn", label: "学习", icon: "leaf" }, { id: "courses", label: "课程", icon: "book" }, { id: "records", label: "记录", icon: "chart" }]);
const activeNav = computed(() => ["detail", "material"].includes(page.value) || page.value === "plugin" && surface.value === "authoring" ? "courses" : ["plugin", "record"].includes(page.value) ? "records" : page.value === "profiles" ? "settings" : page.value);
const statusLabels = { missing: "尚未准备", draft: "准备中", review: "待审核", ready: "已发布" };
function status(courseId: string, modeId = selection.activeModeId.value) { return overviews.value[modeId]?.courses.find(item => item.courseId === courseId)?.status ?? "missing"; }
function courseTitle(id: string) { return directory.value.courses.find(item => item.id === id)?.title || "历史课程"; }
function titleForMode(id: string) { return selection.modes.find(item => item.id === id)?.title ?? id; }
function supportsSurface(id: string, target: ModeSurface) { return teachingModes.modes.find(mode => mode.identity.id === id)?.surfaces.includes(target) ?? false; }
function confirmationLabel(id: string) { return teachingModes.modes.find(mode => mode.identity.id === id)?.confirmationLabel; }
function date(value: string) { return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
let refreshEpoch = 0, disposed = false;
async function refresh() {
    const epoch = ++refreshEpoch;
    const snapshot = await services.catalog.read();
    const results = await Promise.all(teachingModes.modes.map(async (mode) => {
        try {
            return { id: mode.identity.id, value: await readModeOverview(mode, snapshot.activeLearnerId, snapshot.courses), error: "" };
        }
        catch (failure) {
            return { id: mode.identity.id, value: undefined, error: failure instanceof Error ? failure.message : String(failure) };
        }
    }));
    if (disposed || epoch !== refreshEpoch)
        return;
    directory.value = snapshot;
    overviews.value = Object.fromEntries(results.filter(item => item.value).map(item => [item.id, item.value!]));
    overviewErrors.value = Object.fromEntries(results.filter(item => item.error).map(item => [item.id, item.error]));
    if (!selectedRecord.value) {
        selectedRecordKey.value = null;
        if (page.value === "record") page.value = "records";
        if (returnPage.value === "record") returnPage.value = "records";
    }
    rename.value = learner.value?.nickname ?? "";
}
async function prepareLeave() {
    await host.value?.prepareLeave();
    if (editing.value)
        await materialEditor.value?.prepareLeave();
    await courseResources.value?.prepareLeave();
    if (speech.courseGenerating.value)
        throw Error("请先暂停音频生成。");
    await speech.stop();
    await reader.stop();
}
async function perform(action: () => Promise<void>, prepare = true) {
    if (busy.value || selection.busy.value)
        return false;
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
        if (prepare)
            await prepareLeave();
        await action();
        await refresh();
        await host.value?.refresh();
        return true;
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
        return false;
    }
    finally {
        busy.value = false;
    }
}
async function go(target: Page, nextParent = target === "learn" ? false : parent.value) {
    if (navigating.value || busy.value || selection.busy.value || pendingAction.value)
        return;
    navigating.value = true;
    error.value = "";
    try {
        await prepareLeave();
        if (target === "settings" && page.value !== "settings")
            returnPage.value = page.value;
        if (ready.value)
            await refresh();
        await host.value?.refresh();
        if (target === "detail" && !managed.value) target = "courses";
        if (target === "record" && !selectedRecord.value) target = "records";
        if (target === "learn") {
            pluginModeId.value = selection.activeModeId.value;
            surface.value = "learning";
            pluginCourseId.value = null;
        }
        editing.value = false;
        parent.value = nextParent;
        page.value = target;
        swipeId.value = null;
        if (target === "learn" || target === "plugin")
            activation.value++;
        await nextTick();
        window.scrollTo({ top: 0, behavior: "instant" });
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
    }
    finally {
        navigating.value = false;
    }
}
async function authorize(label: string, action: () => Promise<void>) {
    if (pendingAction.value || busy.value || selection.busy.value)
        return;
    if (parent.value && adultUnlocked.value) {
        await action();
        return;
    }
    actionLabel.value = label;
    adultAnswer.value = "";
    const completed = new Promise<void>(resolve => { finishAuthorization = resolve; });
    pendingAction.value = action;
    await nextTick();
    document.querySelector<HTMLInputElement>("#frame-adult-answer")?.focus();
    await completed;
}
async function confirmAdult() {
    if (adultAnswer.value.trim() !== "12" || !pendingAction.value)
        return;
    const action = pendingAction.value;
    const finish = finishAuthorization; finishAuthorization = undefined;
    pendingAction.value = null;
    adultUnlocked.value = true;
    try {
        await action();
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
    }
    finally { finish?.(); }
}
async function enterParent(target: Page = "overview") {
    const enter = async () => { await go(target, true); };
    if (parent.value)
        await enter();
    else
        await authorize("进入家长空间", enter);
}
async function openPlugin(modeId: string, target: ModeSurface, courseId = currentCourseId.value) {
    try { teachingModes.requireSurface(modeId, target); }
    catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure); return; }
    const open = async (nextParent = parent.value) => {
        if (navigating.value || busy.value || selection.busy.value)
            return;
        navigating.value = true;
        error.value = "";
        try {
            await prepareLeave();
            if (page.value !== "plugin") pluginReturnPage.value = page.value;
            pluginModeId.value = modeId;
            surface.value = target;
            pluginCourseId.value = courseId;
            managedId.value = courseId;
            editing.value = false;
            parent.value = nextParent;
            page.value = "plugin";
            activation.value++;
            await nextTick();
            window.scrollTo({ top: 0, behavior: "instant" });
        }
        catch (failure) {
            error.value = failure instanceof Error ? failure.message : String(failure);
        }
        finally {
            navigating.value = false;
        }
    };
    if ((target === "authoring" || target === "confirm") && !parent.value)
        await authorize("进入家长空间", async () => { await open(true); });
    else
        await open();
}
async function openParent(target?: ModeSurface) {
    if (target)
        await openPlugin(pluginModeId.value, target, pluginCourseId.value ?? currentCourseId.value);
    else
        await enterParent();
}
async function openSettings() {
    if (parent.value)
        await go("settings");
    else
        await authorize("进入家长设置", async () => { await go("settings", true); });
}
async function selectCourse(id: string) {
    if (!learner.value)
        return;
    const learnerId = learner.value.id;
    if (await perform(() => services.catalog.assignCourse(learnerId, id)))
        await go("learn");
}
async function selectLearner(id: string) { await perform(() => services.catalog.selectLearner(id)); }
async function createLearner() {
    const name = nickname.value.trim();
    if (!name)
        return;
    await authorize("创建孩子档案", async () => {
        if (await perform(async () => { await services.catalog.addLearner(name); })) {
            nickname.value = "";
            creating.value = false;
        }
    });
}
async function renameLearner() {
    const id = learner.value?.id, name = rename.value.trim();
    if (!id || !name)
        return;
    await authorize("修改孩子昵称", async () => { await perform(() => services.catalog.renameLearner(id, name)); });
}
async function showCourse(item: MaterialCourse) { managedId.value = item.id; detailTab.value = "modes"; await go("detail"); }
async function openMaterial(create = false) {
    await go("material");
    if (page.value !== "material")
        return;
    if (create)
        managedId.value = null;
    editorKey.value++;
    editing.value = parent.value;
    if (!parent.value && managedId.value === currentCourseId.value && pluginModeId.value === selection.activeModeId.value) {
        try {
            await host.value?.adapter?.readMaterial?.();
        }
        catch (failure) {
            error.value = failure instanceof Error ? failure.message : String(failure);
        }
    }
}
function savedMaterial(id: string) { managedId.value = id; void refresh(); }
async function editMaterial() { managedId.value = pluginCourseId.value ?? currentCourseId.value; await openMaterial(); }
async function playMaterial(line: string) {
    const text = line.replace(/^[A-Za-z][A-Za-z .'-]{0,35}:\s+/, "");
    try {
        if (!(await reader.play(text)))
            error.value = "原文朗读未完成，请检查语音设置或本课音频。";
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
    }
}
function requestDelete(kind: "learner" | "course", id: string, name: string) { deletion.value = { kind, id, name }; deleteName.value = ""; }
async function confirmDelete() {
    const target = deletion.value;
    if (!target || deleteName.value !== target.name)
        return;
    if (await perform(async () => {
        try { await (target.kind === "learner" ? services.catalog.deleteLearner(target.id) : services.catalog.purgeCourse(target.id)); }
        catch (failure) {
            // A durable deletion can have committed some owners before failing.
            await refresh().catch(() => {});
            await host.value?.refresh().catch(() => {});
            throw failure;
        }
    })) {
        deletion.value = null;
        notice.value = "已彻底删除。";
        if (page.value === "detail")
            page.value = "courses";
    }
}
async function exitPractice() {
    if (exiting.value || busy.value || navigating.value || selection.busy.value) return;
    exiting.value = true;
    error.value = "";
    try {
        await host.value?.exit();
        exitPrompt.value = false;
        await refresh();
    }
    catch (failure) {
        error.value = failure instanceof Error ? failure.message : String(failure);
    }
    finally { exiting.value = false; }
}
async function handleBack() {
    if (busy.value || navigating.value || exiting.value || selection.busy.value) return;
    if (pendingAction.value) {
        cancelAuthorization();
        return;
    }
    if (deletion.value) {
        deletion.value = null;
        return;
    }
    if (exitPrompt.value) {
        exitPrompt.value = false;
        return;
    }
    if (busy.value || selection.busy.value)
        return;
    const image = document.querySelector<HTMLButtonElement>(".image-backdrop .image-close");
    if (image) {
        image.click();
        return;
    }
    if (pluginVisible.value && await host.value?.handleBack())
        return;
    if (focused.value) {
        if (host.value?.adapter?.completed) await exitPractice();
        else exitPrompt.value = true;
        return;
    }
    if (page.value === "record") { await go("records"); return; }
    if (page.value === "settings") {
        await go(returnPage.value);
        return;
    }
    if (page.value === "plugin") { await go(pluginReturnPage.value); return; }
    if (page.value === "material") {
        await go(parent.value ? "detail" : "courses");
        return;
    }
    if (page.value === "detail") {
        await go("courses");
        return;
    }
    if (parent.value) {
        if (page.value !== "overview")
            await go("overview");
        else
            await go("learn", false);
        return;
    }
    if (page.value !== "learn")
        await go("learn");
    else if (isAndroid) {
        await prepareLeave();
        await native.exitApp();
    }
}
onScopeDispose(selection.beforeSwitch(prepareLeave));
watch(selection.activeModeId, id => {
    pluginModeId.value = id; surface.value = "learning"; pluginCourseId.value = null;
    if (page.value === "settings" && returnPage.value === "plugin") returnPage.value = "learn";
    void refresh();
});
watch(parent, value => {
    if (!value)
        adultUnlocked.value = false;
});
watch(() => learner.value?.id, (id, previous) => {
    if (previous && previous !== id) adultUnlocked.value = false;
});
let backListener: {
    remove(): Promise<void>;
} | undefined;
let backBusy = false;
onMounted(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;top:-9999px";
    probe.append(document.createElement("div"), document.createElement("div"));
    document.body.appendChild(probe);
    noFlexGap.value = probe.scrollHeight !== 1;
    probe.remove();
    if (isAndroid)
        void native.addListener("backButton", () => {
            if (backBusy)
                return;
            backBusy = true;
            void handleBack().catch(failure => { error.value = String(failure instanceof Error ? failure.message : failure); }).finally(() => { backBusy = false; });
        }).then(handle => {
            if (disposed)
                void handle.remove();
            else
                backListener = handle;
        }).catch(() => { });
});
onScopeDispose(() => { disposed = true; refreshEpoch++; cancelAuthorization(); void backListener?.remove(); });
async function initialize() {
    initializing.value = true;
    error.value = "";
    try {
        await selection.load();
        pluginModeId.value = selection.activeModeId.value;
        await refresh();
        ready.value = true;
    }
    catch (failure) {
        error.value = "无法读取本机数据：" + (failure instanceof Error ? failure.message : String(failure));
    }
    finally { initializing.value = false; }
}
void initialize();
</script>

<template>
  <div class="lingonest-app" :class="{ 'no-flex-gap': noFlexGap }" :aria-busy="initializing || busy || selection.busy.value">
    <header v-if="!focused" class="application-topbar">
      <button class="application-brand" :disabled="locked" @click="parent ? go('overview') : go('learn')">
        <span class="application-logo">
          <Icon name="leaf" :size="24" />
        </span>
        <span>
          <strong>LingoNest<span>.</span></strong>
          <small>{{ parent ? '家长空间' : '英语小窝' }}</small>
        </span>
      </button>
      <div class="frame-actions">
        <button v-if="learner" class="frame-profile" :title="learner.nickname" :disabled="locked" @click="enterParent('profiles')">{{ learner.nickname }}</button>
        <button class="frame-link" :disabled="locked" @click="parent ? go('learn', false) : enterParent()">{{ parent ? '返回学习空间' : '家长空间' }}</button>
      </div>
    </header>
    <header v-else class="application-focusbar">
      <button class="frame-button secondary" :disabled="locked" @click="host?.adapter?.completed ? exitPractice() : exitPrompt = true">{{ host?.adapter?.completed ? '返回学习空间' : '保存并退出' }}</button>
      <span>{{ currentCourse?.title }}</span>
    </header>
    <p v-if="error" class="frame-error frame-global-message" role="alert">
      {{ error }}
      <button v-if="focused" class="frame-link" @click="openSettings">请家长处理</button>
      <button class="frame-link" @click="error = ''">关闭提示</button>
    </p>
    <p v-else-if="notice" class="frame-note frame-global-message" role="status">{{ notice }}</p>
    <p v-if="busy || selection.busy.value" class="frame-save-progress" role="status">{{ selection.busy.value ? '正在保存进度并切换模式…' : '正在保存，请稍候…' }}</p>
    <fieldset class="application-body" :disabled="!!pendingAction || !!deletion || exitPrompt || exiting || selection.busy.value">
      <main v-if="!ready && page !== 'settings'" class="frame-page">
        <h1>{{ error ? '暂时无法读取本机数据' : '正在整理你的小窝' }}</h1>
        <p>已有课程与学习记录保留。</p>
        <button v-if="error" class="frame-button" @click="openSettings">打开设置</button>
      </main>
      <main v-else-if="page === 'learn' && !learner" class="frame-page frame-welcome">
        <Icon name="book" :size="56" />
        <h1>让英语，在小窝里慢慢长大。</h1>
        <p>先建立孩子档案，课程和学习记录保存在本机。</p>
        <form @submit.prevent="createLearner">
          <label for="first-nickname">先给自己起个昵称</label>
          <input id="first-nickname" v-model="nickname" maxlength="16" required placeholder="例如：小树" />
          <button class="frame-button" :disabled="locked || !nickname.trim()">建立我的小窝</button>
        </form>
      </main>
      <section v-if="ready && page === 'learn' && learner && !focused" class="application-context">
        <div>
          <span class="frame-caption">正在学习 ·{{ learner.nickname }} <span class="frame-badge">{{ modeTitle }}</span></span>
          <h1 :title="currentCourse?.title">{{ currentCourse?.title }}</h1>
          <p class="context-course-subtitle" :title="currentCourse?.subtitle">
            {{ currentCourse?.subtitle }}
          </p>
        </div>
        <button class="frame-link" :disabled="locked" @click="go('courses')">换一课</button>
      </section>
      <section v-if="page === 'plugin'" class="application-context">
        <div>
          <span class="frame-caption">{{ parent ? '家长空间' : '学习记录' }}·{{ titleForMode(pluginModeId) }}</span>
          <h1>{{ courseTitle(pluginCourseId || '') }}</h1>
        </div>
        <button v-if="pluginReturnPage !== 'learn' || !parent" class="frame-link" :disabled="locked" @click="go(pluginReturnPage)">{{ pluginReturnLabel }}</button>
      </section>
      <ModeHost
        v-if="ready && selection.ready.value"
        ref="host"
        :mode-id="pluginModeId"
        :surface="surface"
        :course-id="pluginCourseId"
        :visible="pluginVisible"
        :parent="parent"
        :activation="activation"
        :authorize="authorize"
        :open-parent="openParent"
        :open-settings="openSettings"
        :edit-material="editMaterial"
        :notify="notify"
      />
      <main v-if="ready && page === 'overview'" class="frame-page">
        <div class="frame-page-heading">
          <div>
            <span class="frame-caption">家长空间</span>
            <h1>{{ learner ? learner.nickname + '的学习小窝' : '准备好下一次学习' }}</h1>
          </div>
          <button class="frame-button secondary" @click="go('profiles')">管理孩子档案</button>
        </div>
        <div class="frame-overview">
          <div>
            <span>当前学习模式</span>
            <strong>{{ modeTitle }}</strong>
          </div>
          <div>
            <span>课程教材</span>
            <strong>{{ directory.courses.filter(item => !item.archivedAt).length }}门</strong>
          </div>
          <div>
            <span>当前孩子的作答记录</span>
            <strong>{{ Object.values(overviews).reduce((sum, item) => sum + item.records.length, 0) }}次</strong>
          </div>
        </div>
        <div class="frame-actions">
          <button class="frame-button" @click="go('courses')">管理课程</button>
          <button class="frame-button secondary" @click="go('records')">查看学习记录</button>
        </div>
        <section class="frame-section">
          <h2>模式报告与待办</h2>
          <div v-for="mode in selection.modes" :key="mode.id" class="frame-list-row">
            <div>
              <strong>{{ mode.title }}</strong>
              <p>{{ overviewErrors[mode.id] || (overviews[mode.id]?.pendingCount ? `${overviews[mode.id]?.pendingCount} 条待确认` : '查看本模式的学习情况') }}</p>
            </div>
            <div class="frame-actions">
              <button v-if="supportsSurface(mode.id, 'report')" class="frame-link" @click="openPlugin(mode.id, 'report')">学习报告</button>
              <button v-if="supportsSurface(mode.id, 'confirm')" class="frame-link" @click="openPlugin(mode.id, 'confirm')">{{ confirmationLabel(mode.id) }}</button>
            </div>
          </div>
          <p v-if="!pendingCount" class="frame-caption">各模式分别解释学习完成与能力掌握。</p>
        </section>
      </main>
      <main v-if="ready && page === 'courses'" class="frame-page">
        <div class="frame-page-heading">
          <div>
            <span class="frame-caption">共同教材目录</span>
            <h1>{{ parent ? '课程管理' : '我的课程' }}</h1>
          </div>
          <button v-if="parent && !deleted" class="frame-button" :disabled="locked" @click="openMaterial(true)">新建课程</button>
        </div>
        <div v-if="parent" class="frame-actions">
          <button class="frame-link" :aria-pressed="!deleted" @click="deleted = false">课程列表</button>
          <button
            v-if="directory.courses.some(item => item.archivedAt)"
            class="frame-link"
            :aria-pressed="deleted"
            @click="deleted = true"
          >已删除（{{ directory.courses.filter(item => item.archivedAt).length }}）</button>
        </div>
        <p class="frame-caption">{{ parent ? '教材由各模式共用，学习内容分别准备。左滑可以删除自建课程。' : '当前学习方式：' + modeTitle }}</p>
        <p v-if="overviewErrors[selection.activeModeId.value]" role="alert">当前模式状态读取失败：{{ overviewErrors[selection.activeModeId.value] }}</p>
        <div class="application-course-list">
          <SwipeCourseRow
            v-for="item in courses"
            :key="item.id"
            :title="item.title || '未命名课程草稿'"
            :removable="parent && !item.builtin && !deleted"
            :disabled="locked"
            :open="swipeId === item.id"
            @update:open="swipeId = $event ? item.id : null"
            @remove="perform(() => services.catalog.archiveCourse(item.id))"
          >
            <div class="frame-course-row">
              <button class="frame-course-entry" :disabled="locked" @click="parent ? showCourse(item) : selectCourse(item.id)">
                <span class="frame-book">
                  <Icon name="book" :size="24" />
                </span>
                <span>
                  <strong>{{ item.title || '未命名课程草稿' }}</strong>
                  <small>{{ item.subtitle || '自建课程' }}{{ item.id === currentCourseId ? ' · 当前学习' : '' }}</small>
                  <span v-if="!deleted" class="frame-badge">{{ statusLabels[status(item.id)] }}</span>
                </span>
              </button>
              <button v-if="!parent && !deleted" class="frame-link" @click="managedId = item.id; openMaterial()">阅读教材</button>
              <div v-if="deleted && parent" class="frame-actions">
                <button
                  class="frame-link"
                  :disabled="locked"
                  aria-label="恢复课程"
                  @click="perform(() => services.catalog.restoreCourse(item.id))"
                >恢复</button>
                <button
                  class="frame-link danger-text"
                  :disabled="locked"
                  @click="requestDelete('course', item.id, item.title || '未命名课程草稿')"
                >彻底删除</button>
              </div>
            </div>
          </SwipeCourseRow>
        </div>
        <p v-if="!courses.length" class="frame-note">{{ deleted ? '这里没有已删除的课程。' : '还没有课程，可以请家长添加教材。' }}</p>
      </main>
      <main v-if="ready && page === 'detail'" class="frame-page">
        <div class="frame-page-heading">
          <h1>{{ managed?.title || '课程详情' }}</h1>
          <button class="frame-link" @click="go('courses')">返回课程列表</button>
        </div>
        <p>{{ managed?.subtitle }}</p>
        <nav class="frame-tabs" aria-label="课程详情">
          <button
            :aria-current="detailTab === 'material' ? 'page' : undefined"
            :disabled="locked"
            @click="detailTab = 'material'"
          >教材</button>
          <button :aria-current="detailTab === 'modes' ? 'page' : undefined" :disabled="locked" @click="detailTab = 'modes'">学习模式</button>
          <button
            :aria-current="detailTab === 'resources' ? 'page' : undefined"
            :disabled="locked"
            @click="detailTab = 'resources'"
          >资源</button>
        </nav>
        <section v-if="managed && detailTab === 'material'">
          <SourceImages :images="[...managed.images, ...managed.supplementImages]" />
          <p class="frame-source">{{ managed.sourceText }}</p>
          <button class="frame-button secondary" @click="openMaterial()">{{ managed.sourceEditable ? '编辑教材' : '查看教材' }}</button>
        </section>
        <section v-else-if="managed && detailTab === 'resources'">
          <SourceImages :images="[...managed.images, ...managed.supplementImages]" />
          <CourseResources ref="courseResources" :resources="resources" :authorize="authorize" @settings="openSettings" />
        </section>
        <section v-else-if="managed">
          <div v-for="mode in selection.modes" :key="mode.id" class="frame-list-row">
            <div>
              <strong>{{ mode.title }}</strong>
              <p>
                {{ overviewErrors[mode.id] || statusLabels[status(managed.id, mode.id)] }}
                <span v-if="overviews[mode.id]?.courses.find(item => item.courseId === managed?.id)?.pending">· 新候选待审核</span>
              </p>
            </div>
            <button v-if="supportsSurface(mode.id, 'authoring')" class="frame-button secondary" :disabled="locked" @click="openPlugin(mode.id, 'authoring', managed.id)">{{ detailTab === 'resources' ? '准备课程音频' : '准备／查看内容' }}</button>
          </div>
        </section>
        <button
          v-if="managed && !managed.builtin && parent"
          class="frame-link danger-text"
          @click="perform(async () => { await services.catalog.archiveCourse(managed!.id); page = 'courses'; })"
        >删除课程</button>
      </main>
      <main v-if="ready && page === 'material'" class="frame-page">
        <button class="frame-link" @click="go(parent ? 'detail' : 'courses')">返回{{ parent && managed ? '课程详情' : '课程列表' }}</button>
        <MaterialEditor
          v-if="parent && editing"
          :key="editorKey"
          ref="materialEditor"
          :material="managed"
          :authorize="authorize"
          @saved="savedMaterial"
        />
        <section v-else-if="managed || currentCourse">
          <h1>{{ (managed || currentCourse)?.title }}</h1>
          <SourceImages :images="[...((managed || currentCourse)?.images ?? []), ...((managed || currentCourse)?.supplementImages ?? [])]" />
          <article
            v-for="(line, index) in reading?.sourceText.split(/\r?\n/).filter(line => line.trim())"
            :key="index"
            class="frame-material-turn"
          >
            <p class="frame-source">{{ line }}</p>
            <button class="frame-button secondary" @click="playMaterial(line)">听这一段</button>
          </article>
        </section>
      </main>
      <main v-if="ready && page === 'records'" class="frame-page">
        <span class="frame-caption">学习记录</span>
        <h1>每一步，都记得</h1>
        <div class="frame-actions frame-filters">
          <label>
            学习模式
            <select v-model="recordMode" aria-label="学习模式">
              <option value="">全部模式</option>
              <option v-for="mode in selection.modes" :key="mode.id" :value="mode.id">{{ mode.title }}</option>
            </select>
          </label>
          <label>
            课程
            <select v-model="recordCourse" aria-label="课程">
              <option value="">全部课程</option>
              <option v-for="item in directory.courses" :key="item.id" :value="item.id">{{ item.title }}</option>
            </select>
          </label>
        </div>
        <section class="frame-section">
          <h2>查看模式报告</h2>
          <div class="frame-actions">
            <button
              v-for="mode in selection.modes"
              :key="mode.id"
              class="frame-button secondary"
              :disabled="!supportsSurface(mode.id, 'report')"
              @click="openPlugin(mode.id, 'report', recordCourse || currentCourseId)"
            >{{ mode.title }}报告</button>
          </div>
        </section>
        <p v-for="(message, id) in overviewErrors" :key="id" class="frame-error" role="alert">{{ titleForMode(String(id)) }}记录暂不可读：{{ message }}</p>
        <div v-for="item in records" :key="item.modeId + ':' + item.id" class="frame-list-row">
          <div>
            <strong>{{ item.title }}</strong>
            <p v-if="item.outcome"><span class="frame-badge">{{ item.outcome }}</span> {{ item.summary }}</p>
            <p>{{ date(item.at) }}·{{ courseTitle(item.courseId) }}·{{ titleForMode(item.modeId) }}</p>
          </div>
          <button class="frame-link" @click="selectedRecordKey = { learnerId: directory.activeLearnerId, modeId: item.modeId, id: item.id }; go('record')">查看作答</button>
        </div>
        <p v-if="!records.length" class="frame-note">当前筛选下还没有作答记录。已有记录按孩子、课程和模式分别保存。</p>
        <nav v-if="recordPageCount > 1" class="frame-actions frame-pagination" aria-label="记录分页">
          <button class="frame-button secondary" :disabled="recordPage === 1 || locked" @click="changeRecordPage(-1)">上一页</button>
          <span role="status">第 {{ recordPage }} / {{ recordPageCount }} 页 · 共 {{ filteredRecords.length }} 条</span>
          <button class="frame-button secondary" :disabled="recordPage === recordPageCount || locked" @click="changeRecordPage(1)">下一页</button>
        </nav>
      </main>
      <main v-if="ready && page === 'record' && selectedRecord" class="frame-page frame-record-detail">
        <div class="frame-page-heading"><div><span class="frame-caption">{{ titleForMode(selectedRecord.modeId) }} · 作答详情</span><h1>{{ selectedRecord.title }}</h1></div><button class="frame-link" @click="go('records')">返回学习记录</button></div>
        <p>{{ courseTitle(selectedRecord.courseId) }} · {{ date(selectedRecord.at) }}</p>
        <p><span class="frame-badge">{{ selectedRecord.outcome || '已保存' }}</span> {{ selectedRecord.summary }}</p>
        <section v-for="(detail, index) in selectedRecord.details" :key="index" class="frame-section"><h2>{{ detail.label }}</h2><p class="frame-record-value">{{ detail.value }}</p></section>
        <button class="frame-button secondary" @click="openPlugin(selectedRecord.modeId, 'report', selectedRecord.courseId)">查看模式报告</button>
      </main>
      <main v-if="page === 'settings'" class="frame-page shared-content">
        <div class="frame-page-heading">
          <div>
            <span class="frame-caption">统一应用设置</span>
            <h1>小窝设置</h1>
          </div>
          <button class="frame-link" @click="go(returnPage)">{{ returnLabel }}</button>
        </div>
        <section class="frame-section">
          <h2>孩子档案</h2>
          <button class="frame-button secondary" @click="go('profiles')">管理孩子档案</button>
        </section>
        <CourseModeSettings :selection="selection" :authorize="authorize" />
        <SpeechSettings :speech="speechSettings" />
        <ContentSettings />
        <section class="frame-section">
          <h2>本机数据维护</h2>
          <button v-if="!ready" class="frame-button secondary" :disabled="initializing" @click="initialize">重新读取应用数据</button>
          <p v-if="services.cleanupStatus.pending" role="status">{{ services.cleanupStatus.pending }} 项删除任务尚未完成，相关课程或档案暂停使用，可重试或在下次启动时继续。</p>
          <p v-if="services.cleanupStatus.error" role="alert">{{ services.cleanupStatus.error }}</p>
          <button class="frame-button secondary" :disabled="locked" @click="perform(() => services.retryCleanup())">重试本机资源清理</button>
        </section>
        <p class="frame-caption">课程、学习内容与历史记录保存在本机。切换模式保留各自进度。</p>
      </main>
      <main v-if="ready && page === 'profiles'" class="frame-page shared-content">
        <h1>孩子档案</h1>
        <p>每个孩子有独立的学习记录。</p>
        <div v-for="item in directory.learners" :key="item.id" class="frame-list-row">
          <div>
            <strong>{{ item.nickname }}</strong>
            <span v-if="item.id === learner?.id" class="frame-badge">当前孩子</span>
          </div>
          <button class="frame-button secondary" :disabled="locked" @click="selectLearner(item.id)">切换档案</button>
        </div>
        <button class="frame-link" :disabled="locked || directory.learners.length >= 8" @click="creating = !creating">新建孩子档案</button>
        <form v-if="creating || !directory.learners.length" @submit.prevent="createLearner">
          <label>
            孩子昵称
            <input v-model="nickname" maxlength="16" required />
          </label>
          <button class="frame-button" :disabled="locked || !nickname.trim()">创建档案</button>
        </form>
        <form v-if="learner" @submit.prevent="renameLearner">
          <label>
            修改昵称
            <input v-model="rename" maxlength="16" required />
          </label>
          <button class="frame-button secondary" :disabled="locked">保存昵称</button>
        </form>
        <button
          v-if="learner"
          class="frame-link danger-text"
          :disabled="locked"
          @click="requestDelete('learner', learner.id, learner.nickname)"
        >删除当前档案</button>
      </main>
    </fieldset>
    <nav v-if="ready && !focused" class="application-navigation" :aria-label="parent ? '家长导航' : '主导航'">
      <button
        v-for="item in nav"
        :key="item.id"
        :aria-current="activeNav === item.id ? 'page' : undefined"
        :disabled="locked || !!deletion"
        @click="go(item.id as Page)"
      >
        <Icon :name="item.icon as any" :size="21" />
        <span>{{ item.label }}</span>
      </button>
    </nav>
    <div v-if="pendingAction" class="frame-modal-backdrop">
      <form
        ref="adultDialog"
        class="frame-modal shared-content"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="frame-adult-title"
        @submit.prevent="confirmAdult"
      >
        <h2 id="frame-adult-title">请家长确认</h2>
        <p>{{ actionLabel }}· 7 + 5 = ?</p>
        <label for="frame-adult-answer">7加5的答案</label>
        <input id="frame-adult-answer" v-model="adultAnswer" inputmode="numeric" autocomplete="off" />
        <div class="frame-actions">
          <button class="frame-button" :disabled="adultAnswer.trim() !== '12'">确认并继续</button>
          <button type="button" class="frame-button secondary" @click="cancelAuthorization">取消操作</button>
        </div>
        <p class="frame-caption">用于防止误触，不是身份认证。</p>
      </form>
    </div>
    <div v-if="exitPrompt" class="frame-modal-backdrop">
      <section ref="exitDialog" class="frame-modal" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="frame-exit-title">
        <h2 id="frame-exit-title">先休息一下吗？</h2>
        <p>保存当前进度后退出，未提交的答案不会被记为答错。</p>
        <div class="frame-actions">
          <button class="frame-button secondary" :disabled="exiting" @click="exitPrompt = false">继续练习</button>
          <button class="frame-button" :disabled="locked" @click="exitPractice">保存进度并退出</button>
        </div>
      </section>
    </div>
    <div v-if="deletion" class="frame-modal-backdrop">
      <form
        ref="deleteDialog"
        class="frame-modal shared-content"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-labelledby="frame-delete-title"
        @submit.prevent="confirmDelete"
      >
        <h2 id="frame-delete-title">彻底删除「{{ deletion.name }}」？</h2>
        <p>相关模式的内容或该孩子的学习记录会一并清理，此操作无法在应用内恢复。</p>
        <label>
          输入名称确认
          <input v-model="deleteName" autocomplete="off" />
        </label>
        <div class="frame-actions">
          <button type="button" class="frame-button secondary" @click="deletion = null">保留数据</button>
          <button class="frame-button danger" :disabled="deleteName !== deletion.name || busy">确认删除</button>
        </div>
      </form>
    </div>
  </div>
</template>
