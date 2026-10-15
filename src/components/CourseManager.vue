<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  toRef,
  watch,
  type UnwrapNestedRefs,
} from "vue";
import type { LearningUI } from "../domain";
import {
  buildCoursePackage,
  courseStatusLabels,
  mergeVocabulary,
  modelVocabulary,
  modelSource,
  newCourse,
  parseModelJSON,
  sourceTurns,
  starterRecord,
  validateRecipe,
  type CourseRecord,
  type SourceImage,
} from "../course-library";
import {
  contentNative,
  contentRequest,
  coursePrompt,
  recognitionPrompt,
  vocabularyPrompt,
} from "../content";
import { useSpeech } from "../useSpeech";
import { makeCourseAudioSpec } from "../course-speech";
import { isAndroid } from "../native";
import { abilityLabels } from "../parent-report";
import Icon from "./AppIcon.vue";
import CourseAudioPanel from "./CourseAudioPanel.vue";
import SourceImages from "./SourceImages.vue";
import SwipeCourseRow from "./SwipeCourseRow.vue";
import VocabularyList from "./VocabularyList.vue";
const props = defineProps<{
  app: UnwrapNestedRefs<LearningUI>;
  active: boolean;
  authorize: (label: string, action: () => Promise<void>) => Promise<void>;
}>();
const emit = defineEmits<{ settings: [] }>();
const courseId = defineModel<string | null>("courseId", { required: true });
const clone = (value: CourseRecord) =>
  JSON.parse(JSON.stringify(value)) as CourseRecord;
const record = ref<CourseRecord>(
  clone(
    props.app.courses.find(
      (item) => item.id === (courseId.value ?? props.app.course.id),
    ) || starterRecord,
  ),
);
const audioSpec = computed(() => {
  const pack = record.value.package ?? starterRecord.package!;
  return makeCourseAudioSpec(pack.course, pack.exercises);
});
const speech = useSpeech(audioSpec, toRef(props.app.speech, "configuration"));
const audio = reactive(speech);
const job = ref(false),
  error = ref(""),
  message = ref(""),
  reviewed = ref(false),
  recognizedText = ref("");
const recognizedMetadata = ref({ title: "", subtitle: "" });
const vocabularyList = ref<InstanceType<typeof VocabularyList> | null>(null);
const checkedOriginal = ref(false);
watch(
  () => [record.value.title, record.value.subtitle, record.value.sourceText],
  () => { checkedOriginal.value = false; },
);
const removing = ref(false),
  listTab = ref<"active" | "deleted">("active"),
  swipeId = ref<string | null>(null),
  lastDeletedId = ref<string | null>(null);
let jobEpoch = 0,
  saveTimer: ReturnType<typeof setTimeout> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
function courseFeedback(text: string) {
  props.app.notice = "";
  message.value = text;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    if (message.value === text) message.value = "";
  }, 2800);
}
watch(listTab, () => {
  message.value = "";
});
const published = computed(() => record.value.status === "published");
const steps = ["原文校对", "重点词汇", "生成课程", "审核课程", "音频准备"];
const stepIndex = computed(() =>
  ["source", "vocabulary", "generation", "review", "published"].indexOf(
    record.value.status,
  ),
);
const preview = computed(() => {
  if (!record.value.recipe) return null;
  try {
    return buildCoursePackage(record.value);
  } catch {
    return null;
  }
});
const canSave = computed(() => !job.value && !props.app.busy);
watch(
  () => props.app.deletedCourses.length,
  (count) => {
    if (!count && listTab.value === "deleted") listTab.value = "active";
  },
);
async function persist(): Promise<boolean> {
  clearTimeout(saveTimer);
  if (removing.value || !courseId.value) return true;
  if (published.value) return true;
  const snapshot = clone(record.value);
  snapshot.updatedAt = new Date().toISOString();
  try {
    if (snapshot.status === "review")
      snapshot.package = buildCoursePackage(snapshot);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
    return false;
  }
  const saved = await props.app.saveCourse(snapshot);
  if (saved) message.value = "草稿已保存，可以稍后继续。";
  return saved;
}
watch(
  record,
  () => {
    if (courseId.value && !published.value && !removing.value) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        void persist();
      }, 600);
    }
  },
  { deep: true },
);
async function select(id: string) {
  if (job.value || speech.courseGenerating.value) return;
  if (!(await persist())) return;
  const next = props.app.courses.find((item) => item.id === id);
  if (!next) return;
  record.value = clone(next);
  courseId.value = id;
  error.value = "";
  message.value = "";
  reviewed.value = false;
  checkedOriginal.value = false;
  recognizedText.value = "";
  recognizedMetadata.value = { title: "", subtitle: "" };
  await nextTick();
  window.scrollTo({ top: 0, behavior: "instant" });
}
async function create() {
  await props.authorize("新建课程", async () => {
    if (!(await persist())) return;
    const next = newCourse();
    if (await props.app.saveCourse(next)) {
      record.value = next;
      courseId.value = next.id;
      error.value = "";
      message.value = "";
      checkedOriginal.value = false;
      recognizedText.value = "";
      recognizedMetadata.value = { title: "", subtitle: "" };
      await nextTick();
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  });
}
async function handleBack(): Promise<boolean> {
  if (!courseId.value) {
    if (swipeId.value) {
      swipeId.value = null;
      return true;
    }
    if (listTab.value === "deleted") {
      listTab.value = "active";
      return true;
    }
    return false;
  }
  if (removing.value) return true;
  if (job.value) abort();
  if (speech.courseGenerating.value) await speech.cancelCourse();
  if (!(await persist())) return true;
  clearTimeout(saveTimer);
  courseId.value = null;
  await speech.stop();
  await nextTick();
  window.scrollTo({ top: 0, behavior: "instant" });
  return true;
}
defineExpose({ handleBack });
async function remove(id: string) {
  if (!canSave.value || removing.value || speech.courseGenerating.value) return;
  if (courseId.value === id && !(await persist())) return;
  removing.value = true;
  clearTimeout(saveTimer);
  abort();
  await speech.stop();
  try {
    if (await props.app.deleteCourse(id)) {
      if (courseId.value === id) {
        courseId.value = null;
        record.value = clone(starterRecord);
      }
      swipeId.value = null;
      lastDeletedId.value = id;
      courseFeedback("已移到已删除。");
      await nextTick();
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  } finally {
    removing.value = false;
  }
}
async function restore(id: string) {
  if (!canSave.value || removing.value) return;
  removing.value = true;
  try {
    if (await props.app.restoreCourse(id)) {
      courseFeedback("课程已恢复。");
      if (lastDeletedId.value === id) lastDeletedId.value = null;
    }
  } finally {
    removing.value = false;
  }
}
async function purge(id: string) {
  if (!canSave.value || removing.value || speech.courseGenerating.value) return;
  removing.value = true;
  try {
    if (await props.app.purgeCourse(id)) {
      if (lastDeletedId.value === id) lastDeletedId.value = null;
      courseFeedback(
        props.app.pendingCourseCleanupCount
          ? "已删除，资源清理待重试。"
          : "已彻底删除。",
      );
    }
  } finally {
    removing.value = false;
  }
}
async function perform(action: (current: () => boolean) => Promise<void>) {
  if (job.value) return;
  const token = ++jobEpoch,
    id = record.value.id;
  job.value = true;
  error.value = "";
  message.value = "";
  const current = () => token === jobEpoch && record.value.id === id;
  try {
    if (!(await persist())) return;
    await action(current);
  } catch (failure) {
    if (current())
      error.value =
        failure instanceof Error ? failure.message : String(failure);
  } finally {
    if (current()) job.value = false;
  }
}
function abort() {
  jobEpoch++;
  job.value = false;
  if (isAndroid) void contentNative.cancelRequest().catch(() => {});
}
watch(
  () => props.active,
  (active) => {
    if (!active) {
      abort();
      if (!published.value) void persist();
      if (speech.courseGenerating.value) void speech.cancelCourse();
    } else {
      void speech.refreshCourse().catch(() => {});
    }
  },
);
onBeforeUnmount(() => {
  clearTimeout(feedbackTimer);
  abort();
  clearTimeout(saveTimer);
  if (!published.value) void persist();
  if (speech.courseGenerating.value) void speech.cancelCourse();
});
async function addImage(vocabulary: boolean, mode: "camera" | "gallery") {
  if (!isAndroid) {
    error.value = "拍照和相册导入请使用 Android 应用。";
    return;
  }
  await perform(async (current) => {
    const images = vocabulary
      ? record.value.vocabularyImages
      : record.value.images;
    if (images.length >= 6) throw new Error("每组最多添加 6 张图片。");
    const image = await contentNative.pickImage({ mode });
    if (!current() || image.cancelled) return;
    images.push({ path: image.path, rotation: image.rotation });
    await persist();
  });
}
async function recognize(vocabulary: boolean) {
  const images = vocabulary
    ? record.value.vocabularyImages
    : record.value.images;
  if (!images.length) return;
  await props.authorize(vocabulary ? "识别教材词汇表" : "识别课文图片", () =>
    perform(async (current) => {
      const raw = await contentRequest(
        "recognition",
        recognitionPrompt(vocabulary),
        images,
      );
      if (!current()) return;
      if (vocabulary)
        record.value.vocabulary = mergeVocabulary(
          record.value.vocabulary,
          modelVocabulary(raw, "photo"),
        );
      else {
        const result = modelSource(raw);
        recognizedMetadata.value = {
          title: result.title,
          subtitle: result.subtitle,
        };
        if (!record.value.title.trim()) record.value.title = result.title;
        if (!record.value.subtitle.trim()) record.value.subtitle = result.subtitle;
        checkedOriginal.value = false;
        if (record.value.sourceText.trim()) recognizedText.value = result.text;
        else {
          record.value.sourceText = result.text;
          recognizedText.value = "";
        }
      }
      await persist();
    }),
  );
}
async function confirmSource() {
  await props.authorize("确认本课原文", async () => {
    try {
      if (!record.value.title.trim()) throw new Error("请填写课程标题。");
      if (
        !checkedOriginal.value ||
        /\[待校对\]|�/.test(record.value.sourceText)
      )
        throw new Error("请对照原图处理待校对内容，并确认原文。");
      sourceTurns(record.value.sourceText);
      record.value.status = "vocabulary";
      await persist();
    } catch (failure) {
      error.value =
        failure instanceof Error ? failure.message : String(failure);
    }
  });
}
async function generateWords() {
  await props.authorize("生成重点词汇建议", () =>
    perform(async (current) => {
      const raw = await contentRequest(
        "generation",
        vocabularyPrompt(record.value.sourceText),
      );
      if (!current()) return;
      record.value.vocabulary = mergeVocabulary(
        record.value.vocabulary,
        modelVocabulary(raw, "auto"),
      );
      await persist();
    }),
  );
}
async function confirmWords() {
  await props.authorize("确认本课重点词汇", async () => {
    const words = record.value.vocabulary.filter((word) => word.selected);
    if (
      !words.length ||
      words.some((word) => !word.term.trim() || !word.meaning.trim())
    ) {
      error.value = "请选择重点词汇，并补齐选中词汇的词条和释义。";
      await vocabularyList.value?.focusIncomplete();
      return;
    }
    const next = clone(record.value);
    next.status = "generation";
    next.vocabulary = next.vocabulary.filter((word) => word.term.trim());
    if (await props.app.saveCourse(next)) {
      record.value = next;
      error.value = "";
    }
  });
}
async function generateCourse() {
  await props.authorize("生成本课学习内容", () =>
    perform(async (current) => {
      const turns = sourceTurns(record.value.sourceText);
      const raw = await contentRequest(
        "generation",
        coursePrompt(
          record.value,
          turns.map((turn) => turn.text),
        ),
      );
      if (!current()) return;
      const result = parseModelJSON(raw);
      validateRecipe(result, turns);
      const next = clone(record.value);
      next.recipe = result;
      next.package = buildCoursePackage(next);
      next.status = "review";
      if (await props.app.saveCourse(next)) {
        record.value = next;
        reviewed.value = false;
      }
    }),
  );
}
async function publish() {
  await props.authorize("审核并启用课程", async () => {
    if (!reviewed.value) return;
    try {
      const next = clone(record.value);
      next.package = buildCoursePackage(next);
      next.status = "published";
      next.updatedAt = new Date().toISOString();
      if (await props.app.saveCourse(next)) {
        record.value = next;
        message.value = "课程已启用，可以准备音频并交给孩子学习。";
      }
    } catch (failure) {
      error.value =
        failure instanceof Error ? failure.message : String(failure);
    }
  });
}
async function backTo(status: "source" | "vocabulary") {
  if (!canSave.value || published.value) return;
  record.value.status = status;
  record.value.recipe = null;
  record.value.package = null;
  reviewed.value = false;
  checkedOriginal.value = false;
  await persist();
}
</script>
<template>
  <div class="course-manager">
    <section v-if="!courseId" class="section-panel course-library-page">
      <div class="course-library-toolbar">
        <div class="course-list-tabs" aria-label="课程列表分类">
          <button
            class="text-button"
            :aria-pressed="listTab === 'active'"
            @click="
              listTab = 'active';
              swipeId = null;
            "
          >
            课程列表
          </button>
          <button
            v-if="app.deletedCourses.length"
            class="text-button"
            :aria-pressed="listTab === 'deleted'"
            @click="
              listTab = 'deleted';
              swipeId = null;
            "
          >
            已删除（{{ app.deletedCourses.length }}）
          </button>
        </div>
        <button
          v-if="listTab === 'active'"
          class="button primary compact"
          :disabled="
            !canSave || audio.courseGenerating || app.courses.length > 30
          "
          @click="create"
        >
          <Icon name="plus" :size="17" />新建课程
        </button>
      </div>
      <p class="field-help">
        {{
          listTab === "active"
            ? "左滑删除，可在已删除中恢复。"
            : "彻底删除后无法恢复。"
        }}
      </p>
      <div v-if="listTab === 'active'" class="course-list">
        <SwipeCourseRow
          v-for="item in app.courses"
          :key="item.id"
          :title="item.title || '未命名课程草稿'"
          :removable="item.id !== starterRecord.id"
          :disabled="!canSave || removing || audio.courseGenerating"
          :open="swipeId === item.id"
          @update:open="swipeId = $event ? item.id : null"
          @remove="remove(item.id)"
        >
          <button
            class="course-list-entry"
            :class="{ selected: record.id === item.id }"
            :disabled="!canSave || removing || audio.courseGenerating"
            @click="select(item.id)"
          >
            <span
              ><strong>{{ item.title || "未命名课程草稿" }}</strong
              ><small
                >{{ item.subtitle || "自建课程"
                }}{{
                  item.id === app.course.id ? " · 当前孩子正在学习" : ""
                }}</small
              ></span
            ><span
              class="tag"
              :class="item.status === 'published' ? 'green' : 'amber'"
              >{{ courseStatusLabels[item.status] }}</span
            >
          </button>
        </SwipeCourseRow>
      </div>
      <div v-else class="deleted-course-list">
        <article
          v-for="item in app.deletedCourses"
          :key="item.id"
          class="deleted-course-row"
        >
          <div class="deleted-course-copy">
            <strong :title="item.title || '未命名课程草稿'">{{
              item.title || "未命名课程草稿"
            }}</strong>
            <small
              >{{
                new Date(item.deletedAt!).toLocaleDateString("zh-CN", {
                  month: "2-digit",
                  day: "2-digit",
                })
              }}
              删除</small
            >
          </div>
          <div class="deleted-course-actions">
            <button
              class="text-button"
              aria-label="恢复课程"
              :disabled="!canSave || removing"
              @click="restore(item.id)"
            >
              恢复
            </button>
            <button
              class="text-button danger-text"
              :disabled="!canSave || removing || audio.courseGenerating"
              @click="purge(item.id)"
            >
              彻底删除
            </button>
          </div>
        </article>
      </div>
    </section>
    <div v-else class="course-detail-toolbar">
      <button
        class="text-button"
        :disabled="removing || app.busy"
        @click="handleBack"
      >
        <Icon name="arrow" :size="17" />返回课程列表
      </button>
      <button
        v-if="record.id !== starterRecord.id"
        class="text-button danger-text"
        :disabled="!canSave || removing || audio.courseGenerating"
        @click="remove(record.id)"
      >
        删除课程
      </button>
    </div>
    <p v-if="error" class="inline-note speech-error" role="alert">
      {{ error
      }}<button class="text-button" @click="emit('settings')">
        检查模型配置
      </button>
    </p>
    <p v-if="message" class="inline-note" role="status">
      {{ message
      }}<button
        v-if="
          lastDeletedId &&
          app.deletedCourses.some((item) => item.id === lastDeletedId)
        "
        class="text-button"
        :disabled="removing || app.busy"
        @click="restore(lastDeletedId)"
      >
        撤销删除
      </button>
    </p>
    <button
      v-if="app.pendingCourseCleanupCount"
      class="text-button"
      :disabled="app.busy"
      @click="app.retryCourseCleanup"
    >
      重试课程资源清理
    </button>
    <div v-if="courseId" class="course-detail-page">
      <p v-if="job" class="inline-note" role="status">
        正在处理，请稍候。草稿已保存。<button
          class="text-button"
          @click="abort"
        >
          停止处理
        </button>
      </p>
      <section v-if="!published" class="section-panel">
        <ol class="course-steps" aria-label="新建课程步骤">
          <li
            v-for="(label, index) in steps"
            :key="label"
            :class="{
              active: index === stepIndex,
              completed: index < stepIndex,
            }"
          >
            {{ index + 1 }}. {{ label }}
          </li>
        </ol>
        <fieldset class="speech-fields" :disabled="job">
          <template v-if="record.status === 'source'">
            <h2>识别并确认原文</h2>
            <label for="course-title">课程标题</label
            ><input
              id="course-title"
              v-model="record.title"
              maxlength="100"
              placeholder="例如：My Family"
            />
            <p
              v-if="recognizedMetadata.title && recognizedMetadata.title !== record.title"
              class="field-help"
            >
              图片识别标题：{{ recognizedMetadata.title }}
              <button
                type="button"
                class="text-button"
                @click="record.title = recognizedMetadata.title; checkedOriginal = false"
              >采用识别标题</button>
            </p>
            <label for="course-subtitle">教材或单元（可选）</label
            ><input
              id="course-subtitle"
              v-model="record.subtitle"
              maxlength="120"
              placeholder="例如：Unit 2 · Lesson 1"
            />
            <p
              v-if="recognizedMetadata.subtitle && recognizedMetadata.subtitle !== record.subtitle"
              class="field-help"
            >
              图片识别教材或单元：{{ recognizedMetadata.subtitle }}
              <button
                type="button"
                class="text-button"
                @click="record.subtitle = recognizedMetadata.subtitle; checkedOriginal = false"
              >采用识别教材或单元</button>
            </p>
            <p class="field-help">
              识别后自动补全空白标题和教材信息，可直接修改。图片未提供的信息留空，请核对后再确认。
            </p>
            <div class="speech-actions">
              <button
                type="button"
                class="button secondary compact"
                @click="addImage(false, 'camera')"
              >
                拍摄课文</button
              ><button
                type="button"
                class="button secondary compact"
                @click="addImage(false, 'gallery')"
              >
                选择课文图片
              </button>
            </div>
            <SourceImages
              :images="record.images"
              editable
              :disabled="job"
              @change="record.images = $event"
            />
            <button
              v-if="record.images.length"
              class="button secondary compact"
              @click="recognize(false)"
            >
              识别课文图片
            </button>
            <div v-if="recognizedText" class="inline-note">
              <h3>新的识别结果</h3>
              <textarea
                v-model="recognizedText"
                rows="8"
                maxlength="6000"
                aria-label="新的识别结果"
              /><button
                class="text-button"
                @click="
                  record.sourceText = recognizedText;
                  recognizedText = '';
                  checkedOriginal = false;
                "
              >
                采用识别结果替换当前草稿</button
              ><button class="text-button" @click="recognizedText = ''">
                保留当前原文
              </button>
            </div>
            <label for="course-source">文章或课文原文</label
            ><textarea
              id="course-source"
              v-model="record.sourceText"
              rows="10"
              placeholder="可以直接填入英语文章。每段换行；对话可以使用 Alice: Hello! 的格式。"
            />
            <p class="field-help">
              {{ record.sourceText.length }} / 6000 个字符。 每段不超过 2000
              个字符。请检查角色、顺序、标点和遗漏。图片内容只在点击识别时发送到已配置的服务。
            </p>
            <p
              v-if="/\[待校对\]|�/.test(record.sourceText)"
              class="inline-note"
            >
              原文含待校对标记，请处理后再确认。
            </p>
            <label class="checkbox-label"
              ><input v-model="checkedOriginal" type="checkbox" /><span
                >已检查标题、教材或单元及原文内容、角色与顺序，确认可以用于学习。</span
              ></label
            >
            <div class="speech-actions">
              <button
                class="button primary compact"
                :disabled="
                  !checkedOriginal ||
                  !record.title.trim() ||
                  !record.sourceText.trim() ||
                  app.busy
                "
                @click="confirmSource"
              >
                确认原文，整理重点词汇</button
              ><button
                class="button secondary compact"
                :disabled="app.busy"
                @click="persist"
              >
                保存草稿
              </button>
            </div>
          </template>
          <template v-else-if="record.status === 'vocabulary'">
            <h2>整理并确认重点词汇</h2>
            <p class="field-help">
              原文已确认。可以识别教材词汇表，也可以由应用根据课文建议词汇；两种来源合并去重，确认后用于出题。
            </p>
            <div class="speech-actions">
              <button
                class="button secondary compact"
                @click="addImage(true, 'camera')"
              >
                拍摄词汇表</button
              ><button
                class="button secondary compact"
                @click="addImage(true, 'gallery')"
              >
                选择词汇表图片</button
              ><button class="button primary compact" @click="generateWords">
                应用生成重点词汇
              </button>
            </div>
            <SourceImages
              :images="record.vocabularyImages"
              editable
              :disabled="job"
              @change="record.vocabularyImages = $event"
            /><button
              v-if="record.vocabularyImages.length"
              class="button secondary compact"
              @click="recognize(true)"
            >
              识别教材词汇表
            </button>
            <VocabularyList ref="vocabularyList" v-model="record.vocabulary" />
            <div class="speech-actions">
              <button
                class="button primary compact"
                :disabled="
                  app.busy || !record.vocabulary.some((word) => word.selected)
                "
                @click="confirmWords"
              >
                确认词汇，继续生成课程</button
              ><button
                class="button secondary compact"
                @click="backTo('source')"
              >
                返回原文校对</button
              ><button class="text-button" @click="persist">
                保存词汇草稿
              </button>
            </div>
          </template>
          <template v-else-if="record.status === 'generation'">
            <h2>生成学习内容</h2>
            <p>
              已确认原文和
              {{ record.vocabulary.filter((word) => word.selected).length }}
              个重点词汇。接下来生成逐段释义、理解题和情境应用题，并整理拼写、句型、朗读、回忆和默写练习。
            </p>
            <p class="field-help">
              生成后先由家长审核，启用前孩子不会进入这门课程。
            </p>
            <div class="speech-actions">
              <button class="button primary compact" @click="generateCourse">
                生成本课学习内容</button
              ><button
                class="button secondary compact"
                @click="backTo('vocabulary')"
              >
                返回重点词汇
              </button>
            </div>
          </template>
          <template v-else-if="record.status === 'review' && record.recipe">
            <h2>审核学习内容</h2>
            <p class="inline-note">
              以下释义、问题和解释为应用生成内容，请检查准确性。确认后的原文保持原样。
            </p>
            <article
              v-for="(turn, index) in sourceTurns(record.sourceText)"
              :key="turn.id"
              class="course-word"
            >
              <p lang="en">{{ turn.text }}</p>
              <label :for="`translation-${index}`"
                >第 {{ index + 1 }} 段释义</label
              ><textarea
                :id="`translation-${index}`"
                v-model="record.recipe.translations[index]"
                rows="2"
                maxlength="2000"
              />
            </article>
            <article
              v-for="(item, index) in record.recipe.comprehension"
              :key="index"
              class="course-word"
            >
              <h3>理解题 {{ index + 1 }}</h3>
              <label :for="`question-${index}`">问题 {{ index + 1 }}</label
              ><textarea
                :id="`question-${index}`"
                v-model="item.question"
                rows="2"
                maxlength="1000"
              />
              <div v-for="(_, option) in item.options" :key="option">
                <label :for="`option-${index}-${option}`"
                  >选项 {{ option + 1 }}</label
                ><input
                  :id="`option-${index}-${option}`"
                  v-model="item.options[option]"
                  maxlength="500"
                />
              </div>
              <label :for="`correct-${index}`">正确选项 {{ index + 1 }}</label
              ><select
                :id="`correct-${index}`"
                v-model.number="item.answerIndex"
              >
                <option v-for="(option, i) in item.options" :key="i" :value="i">
                  {{ i + 1 }}. {{ option }}
                </option></select
              ><label :for="`explanation-${index}`">解释 {{ index + 1 }}</label
              ><textarea
                :id="`explanation-${index}`"
                v-model="item.explanation"
                rows="2"
                maxlength="1000"
              />
            </article>
            <article
              v-for="(item, index) in record.recipe.applications"
              :key="index"
              class="course-word"
            >
              <h3>情境应用 {{ index + 1 }}</h3>
              <label :for="`application-${index}`"
                >应用任务 {{ index + 1 }}</label
              ><textarea
                :id="`application-${index}`"
                v-model="item.prompt"
                rows="2"
                maxlength="1000"
              /><label :for="`answers-${index}`"
                >可接受答案 {{ index + 1 }}（每行一个）</label
              ><textarea
                :id="`answers-${index}`"
                :value="item.answers.join('\n')"
                @input="
                  item.answers = ($event.target as HTMLTextAreaElement).value
                    .split('\n')
                    .filter((answer) => answer.trim())
                "
                rows="2"
              /><label :for="`application-hint-${index}`"
                >应用提示 {{ index + 1 }}</label
              ><textarea
                :id="`application-hint-${index}`"
                v-model="item.explanation"
                rows="2"
                maxlength="1000"
              />
            </article>
            <details v-if="preview" class="parent-evidence">
              <summary>预览 {{ preview.exercises.length }} 道学习任务</summary>
              <article
                v-for="exercise in preview.exercises"
                :key="exercise.id"
                class="parent-attempt"
              >
                <strong
                  >{{ exercise.stageId }} ·
                  {{ abilityLabels[exercise.target.ability] }} ·
                  {{ exercise.title }}</strong
                >
                <p>{{ exercise.prompt }}</p>
                <p>
                  参考：{{
                    exercise.acceptedAnswers.join(" / ") ||
                    exercise.options
                      ?.filter((option) =>
                        exercise.correctOptionIds?.includes(option.id),
                      )
                      .map((option) => option.text)
                      .join(" / ") ||
                    exercise.correctTokenIds
                      ?.map(
                        (id) =>
                          exercise.tokens?.find((token) => token.id === id)
                            ?.text,
                      )
                      .join(" ")
                  }}
                </p>
              </article>
            </details>
            <label class="checkbox-label"
              ><input v-model="reviewed" type="checkbox" /><span
                >已核对释义、重点词汇、题目和答案，确认可以交给孩子学习。</span
              ></label
            >
            <div class="speech-actions">
              <button
                class="button primary compact"
                :disabled="!reviewed || !preview || app.busy"
                @click="publish"
              >
                审核通过，启用课程</button
              ><button class="button secondary compact" @click="generateCourse">
                重新生成学习内容</button
              ><button class="text-button" @click="backTo('vocabulary')">
                返回重点词汇
              </button>
            </div>
          </template>
        </fieldset>
      </section>
      <template v-else-if="record.package">
        <section class="section-panel">
          <div class="section-heading">
            <div>
              <h2>{{ record.title }}</h2>
              <p class="field-help">
                {{ record.subtitle }} ·
                {{
                  record.id === starterRecord.id
                    ? "内置课程"
                    : "自建课程 · 已审核"
                }}
              </p>
            </div>
            <span
              class="tag"
              :class="
                record.id === app.course.id && !app.confirmed
                  ? 'amber'
                  : 'green'
              "
              >{{
                record.id === app.course.id
                  ? app.confirmed
                    ? "本档案已核对"
                    : "等待核对"
                  : "可学习"
              }}</span
            >
          </div>
          <button
            class="button primary compact"
            :disabled="
              !app.learner ||
              app.busy ||
              audio.courseGenerating ||
              record.id === app.course.id
            "
            @click="
              authorize('指定孩子的学习课程', async () => {
                await app.assignCourse(record.id);
              })
            "
          >
            {{
              record.id === app.course.id
                ? "当前孩子正在学习"
                : "设为当前孩子的学习课程"
            }}
          </button>
          <p class="field-help">
            浏览和准备音频保持孩子当前课程；点击指定学习课程后，首页才切换，原课程进度保留。
          </p>
        </section>
        <CourseAudioPanel
          :speech="audio"
          :authorize="authorize"
          @settings="emit('settings')"
        />
        <section class="section-panel">
          <div class="section-heading"><h2>课程原文与重点词汇</h2></div>
          <SourceImages :images="record.images" />
          <ol class="parent-transcript">
            <li v-for="turn in record.package.course.turns" :key="turn.id">
              <small>对话 {{ turn.block }} · {{ turn.speaker }}</small>
              <p lang="en">{{ turn.text }}</p>
              <p class="field-help">{{ turn.translation }}</p>
            </li>
          </ol>
          <div v-if="record.vocabulary.length">
            <h3>已确认重点词汇</h3>
            <div
              v-for="word in record.vocabulary.filter((item) => item.selected)"
              :key="word.term"
              class="parent-history-row"
            >
              <strong>{{ word.term }}</strong
              ><span>{{ word.meaning }}</span>
            </div>
          </div>
          <form
            v-if="record.id === app.course.id && !app.confirmed"
            class="confirm-course"
            @submit.prevent="
              authorize('确认本课原文', () => app.confirmCourse())
            "
          >
            <label class="checkbox-label"
              ><input v-model="checkedOriginal" type="checkbox" /><span
                >我是陪伴学习的家长，已对照原图核对上述课文。</span
              ></label
            ><button
              class="button primary"
              :disabled="!checkedOriginal || app.busy"
            >
              确认课文，准备学习
            </button>
          </form>
        </section>
      </template>
    </div>
  </div>
</template>
