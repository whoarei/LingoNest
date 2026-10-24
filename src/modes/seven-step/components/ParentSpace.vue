<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type UnwrapNestedRefs } from "vue";
import type { Ability } from "../../../../packages/learning-modes/seven-step/model";
import type { HistoryItem, LearningUI } from "../domain";
import { abilityLabels, answerText, attemptLabel, buildParentReport } from "../../../../packages/learning-modes/seven-step/reporting";
import Icon from "../../../components/AppIcon.vue";
import { useWorkspace } from "../../../application/workspace";
const props = defineProps<{ app: UnwrapNestedRefs<LearningUI>; active: boolean }>();
const tab = defineModel<"report" | "confirm">("tab", { required: true });
const workspace = useWorkspace();
const report = computed(() => buildParentReport(props.app.history, props.app.skills, props.app.exercises));
const ability = ref<Ability | "all">("all"), targetFilter = ref<"practiced" | "all">("practiced"), reviewFilter = ref<"pending" | "reviewed">("pending");
const reviewed = computed(() => props.app.history.filter(item => item.exercise.kind === "oral" && item.grade.source === "human"));
const reviewItems = computed(() => reviewFilter.value === "pending" ? [...props.app.pending].sort((a, b) => Number(a.hintLevel > 0) - Number(b.hintLevel > 0)) : reviewed.value);
const reportTargets = computed(() => report.value.targets.filter(item => (ability.value === "all" || item.exercise.target.ability === ability.value) && (targetFilter.value === "all" || item.attempts.length > 0)));
const heard = ref<string[]>([]), hearingId = ref<string | null>(null);
let playbackGeneration = 0;
const heardKey = (item: HistoryItem) => `${item.id}:${item.reviewRevision}`;
function stopPlayback() { playbackGeneration++; hearingId.value = null; void props.app.stopPlayback(); }
watch(() => `${props.app.learner?.id}:${props.app.course.id}`, () => { heard.value = []; stopPlayback(); });
watch(() => props.active, active => { if (!active) stopPlayback(); });
watch(tab, stopPlayback);
onBeforeUnmount(stopPlayback);
async function hear(item: HistoryItem) {
  if (!item.recordingPath || props.app.busy || hearingId.value) return;
  const generation = ++playbackGeneration; hearingId.value = item.id;
  const played = await props.app.playRecording(item.recordingPath);
  if (generation !== playbackGeneration) return;
  hearingId.value = null;
  if (played && props.active && !heard.value.includes(heardKey(item))) heard.value.push(heardKey(item));
}
async function review(item: HistoryItem, passed: boolean) {
  if (!heard.value.includes(heardKey(item))) return;
  const revision = item.reviewRevision, learnerId = props.app.learner?.id;
  await workspace.authorize("确认口语评价", async () => {
    if (props.app.learner?.id === learnerId) await props.app.reviewAttempt(item.id, passed, revision);
  });
}
function shortDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function reviewEvents(id: string) { return props.app.reviewLog.filter(event => event.attemptId === id); }
function showAbility(value: Ability) { ability.value = value; tab.value = "report"; }
</script>
<template>
  <main class="page parent-page">
    <section class="page-intro"><div><span class="eyebrow">七步学习</span><h1>{{ tab === 'confirm' ? '口语确认' : '学习报告' }}</h1><p>看见具体能力与作答依据，分清练过和学会。</p></div></section>
    <template v-if="tab === 'confirm'">
      <div class="parent-toolbar">
        <div class="segmented" aria-label="口语记录筛选">
          <button
            :class="{ active: reviewFilter === 'pending' }"
            @click="reviewFilter = 'pending'"
          >
            待确认 {{ app.pending.length }}</button
          ><button
            :class="{ active: reviewFilter === 'reviewed' }"
            @click="reviewFilter = 'reviewed'"
          >
            已确认 {{ reviewed.length }}
          </button>
        </div>
      </div>
      <p class="inline-note">
        优先回听独立尝试，示范练习可以稍后听。确认通过表示这次表达通过；掌握状态仍需要独立作答和跨日复测。
      </p>
      <section
        v-if="!reviewItems.length"
        class="section-panel empty-state compact-empty"
      >
        <Icon name="mic" :size="38" />
        <h3>
          {{
            reviewFilter === "pending"
              ? "目前没有等待确认的录音"
              : "还没有已确认的口语记录"
          }}
        </h3>
        <p>孩子提交的朗读与背诵会保留在这里。</p>
      </section>
      <article
        v-for="item in reviewItems"
        :key="item.id"
        class="section-panel parent-review-card"
        :data-attempt-id="item.id"
      >
        <div class="oral-review-title">
          <h2>{{ item.exercise.title }}</h2>
          <span class="tag" :class="item.grade.passed ? 'green' : 'amber'">{{
            attemptLabel(item)
          }}</span>
        </div>
        <p class="field-help">
          <span class="tag" :class="item.hintLevel ? 'amber' : 'green'">{{ item.hintLevel ? '提示练习' : '独立尝试' }}</span>
          {{ app.learner?.nickname }} · {{ app.course.subtitle }} · 提交于
          {{ shortDate(item.submittedAt)
          }}{{ item.hintLevel ? " · 使用过提示" : "" }}
        </p>
        <p class="review-reference" lang="en">{{ answerText(item, true) }}</p>
        <p v-if="item.hintLevel" class="inline-note">这条使用过示范，作为练习保留。确认通过后仍需独立尝试，孩子的练习完成页会提供入口。</p>
        <button
          v-if="item.recordingPath"
          class="button secondary compact"
          :disabled="app.busy || !!hearingId"
          @click="hear(item)"
        >
          <Icon
            :name="heard.includes(heardKey(item)) ? 'repeat' : 'play'"
            :size="17"
          />{{
            hearingId === item.id
              ? "正在回听…"
              : heard.includes(heardKey(item))
                ? "再听一次录音"
                : "先回听录音"
          }}
        </button>
        <p v-else class="inline-note">
          这条录音暂时无法回听，请让孩子重新录制后再确认。
        </p>
        <button
          v-if="hearingId === item.id"
          class="text-button"
          @click="stopPlayback"
        >
          停止回听
        </button>
        <p class="field-help">
          听完整段后，结合完整程度、词句是否正确和能否清楚听懂判断。设备没有自动评判发音。
        </p>
        <div class="review-actions">
          <button
            v-if="reviewFilter === 'pending' || item.grade.passed !== true"
            class="button primary compact"
            :disabled="
              app.busy || !!hearingId || !heard.includes(heardKey(item))
            "
            @click="review(item, true)"
          >
            {{ reviewFilter === "reviewed" ? "更正为通过" : "确认通过" }}
          </button>
          <button
            v-if="reviewFilter === 'pending' || item.grade.passed !== false"
            class="button secondary compact"
            :disabled="
              app.busy || !!hearingId || !heard.includes(heardKey(item))
            "
            @click="review(item, false)"
          >
            {{ reviewFilter === "reviewed" ? "更正为还需练习" : "还需要练习" }}
          </button>
        </div>
        <details v-if="reviewEvents(item.id).length" class="parent-evidence">
          <summary>查看 {{ reviewEvents(item.id).length }} 次确认记录</summary>
          <ol>
            <li v-for="event in reviewEvents(item.id)" :key="event.id">
              {{ shortDate(event.at) }} ·
              {{ event.passed ? "家长确认通过" : "家长确认还需练习" }}
            </li>
          </ol>
          <p class="field-help">
            更正会替换该次作答的有效评价，保留原确认记录。
          </p>
        </details>
      </article>
    </template>

    <template v-else-if="tab === 'report'">
      <section class="section-panel">
        <div class="section-heading"><h2>完成与掌握</h2></div>
        <div class="parent-report-summary">
          <div>
            <strong
              >{{ app.stats.completedStages }} / {{ app.stages.length }}</strong
            >
            <p>阶段任务完成</p>
          </div>
          <div>
            <strong
              >{{ app.stats.mastered }} / {{ report.targets.length }}</strong
            >
            <p>目标达到掌握门槛</p>
          </div>
        </div>
        <p class="field-help">
          一次通过、提示练习和待确认录音分别记录。没有有效测评时，保留“还未测试”或“尚无独立测评”。
        </p>
      </section>
      <section class="section-panel">
        <div class="section-heading"><h2>各项能力</h2></div>
        <div class="parent-abilities">
          <button
            v-for="item in report.abilities"
            :key="item.ability"
            :class="{ selected: ability === item.ability }"
            @click="ability = item.ability"
          >
            <strong>{{ item.label }}</strong
            ><span>已掌握 {{ item.mastered }} / {{ item.total }}</span
            ><small
              >已测 {{ item.measured }} 个目标{{
                item.pending ? ` · ${item.pending} 条待确认` : ""
              }}</small
            >
          </button>
        </div>
      </section>
      <section class="section-panel">
        <div class="section-heading">
          <h2>具体目标与作答依据</h2>
          <label class="sr-only" for="parent-ability">筛选能力</label
          ><select id="parent-ability" v-model="ability">
            <option value="all">全部能力</option>
            <option
              v-for="(label, value) in abilityLabels"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select>
        </div>
        <div class="segmented parent-target-filter" aria-label="目标记录范围">
          <button
            :class="{ active: targetFilter === 'practiced' }"
            @click="targetFilter = 'practiced'"
          >
            有作答记录
          </button>
          <button
            :class="{ active: targetFilter === 'all' }"
            @click="targetFilter = 'all'"
          >
            全部学习目标
          </button>
        </div>
        <div v-if="!reportTargets.length" class="empty-state compact-empty">
          <Icon name="leaf" :size="32" />
          <h3>这项能力还没有作答记录</h3>
          <p>
            开始练习后可以查看具体表现，也可以选择“全部学习目标”了解本课内容。
          </p>
        </div>
        <details
          v-for="item in reportTargets"
          :key="item.key"
          class="parent-target"
          :data-target-key="item.key"
        >
          <summary>
            <span
              ><strong>{{ item.title }}</strong
              ><small
                >{{ abilityLabels[item.exercise.target.ability] }} ·
                {{ item.skill?.evidenceCount || 0 }} 次有效记录</small
              ></span
            ><span
              class="tag"
              :class="
                item.skill?.status === 'mastered'
                  ? 'green'
                  : item.pending || item.skill?.latestPassed === false
                    ? 'amber'
                    : 'neutral'
              "
              >{{ item.label }}</span
            >
          </summary>
          <p v-if="!item.attempts.length" class="field-help">
            这个目标还没有作答记录，开始练习后才能了解表现。
          </p>
          <p v-else-if="!item.skill?.evidenceCount" class="field-help">
            提示作答、同轮重试或待确认录音不会直接形成独立掌握证据。
          </p>
          <p v-if="item.skill?.dueAt" class="field-help">
            下次复习时间：{{ shortDate(item.skill.dueAt)
            }}<template v-if="item.skill.eligibleAt">
              · 独立复测最早于 {{ shortDate(item.skill.eligibleAt) }}</template
            >
          </p>
          <div
            v-for="attempt in item.attempts"
            :key="attempt.id"
            class="parent-attempt"
          >
            <div class="parent-history-row">
              <small
                >{{ shortDate(attempt.submittedAt) }} ·
                {{
                  attempt.hintLevel
                    ? "提示练习"
                    : attempt.firstTest
                      ? "本轮首次作答"
                      : "本轮重试"
                }}{{
                  attempt.clockStatus === "suspect" ? " · 时间记录待核实" : ""
                }}</small
              ><span>{{ attemptLabel(attempt) }}</span>
            </div>
            <p><strong>孩子的作答：</strong>{{ answerText(attempt) }}</p>
            <p><strong>参考答案：</strong>{{ answerText(attempt, true) }}</p>
            <p class="field-help">{{ attempt.grade.feedback }}</p>
          </div>
        </details>
      </section>
    </template>

  </main>
</template>
