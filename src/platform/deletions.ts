import type { CourseAudioManifest, SnapshotCodec } from "../../packages/learning-modes/contracts";
import { MutationQueue, SharedSnapshot } from "./shared-snapshot";

export interface DeletionTarget { kind: "course" | "learner"; id: string }
export type OwnedResource = { kind: "image" | "recording"; path: string }
  | { kind: "audio"; course: CourseAudioManifest }
  | { kind: "learner-recordings"; learnerId: string };
export interface DeletionParticipant {
  id: string;
  prepare(target: DeletionTarget): Promise<OwnedResource[]>;
  remove(target: DeletionTarget): Promise<void>;
  retained(): Promise<OwnedResource[]>;
}
export interface DeletionPlan {
  id: string;
  target: DeletionTarget;
  participants: string[];
  removed: string[];
  resources: OwnedResource[];
  cleaned: string[];
}
export interface DeletionState { formatVersion: 1; plans: DeletionPlan[]; completed: DeletionTarget[] }
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
const validTarget = (value: unknown): value is DeletionTarget => !!value && typeof value === "object" &&
  ["course", "learner"].includes((value as DeletionTarget).kind) && validId((value as DeletionTarget).id);
export const targetKey = (target: DeletionTarget) => JSON.stringify([target.kind, target.id]);
export function resourceKey(resource: OwnedResource): string {
  if (resource.kind === "audio") return JSON.stringify(["audio", resource.course.courseId, resource.course.courseVersion,
    resource.course.assets.map(asset => [asset.id, asset.text])]);
  if (resource.kind === "learner-recordings") return JSON.stringify([resource.kind, resource.learnerId]);
  return JSON.stringify([resource.kind, resource.path]);
}
function validResource(value: unknown): value is OwnedResource {
  if (!value || typeof value !== "object") return false;
  const resource = value as OwnedResource;
  if (resource.kind === "image") return typeof resource.path === "string" && /^course-images\/[a-f0-9-]{36}\.jpg$/.test(resource.path);
  if (resource.kind === "recording") return typeof resource.path === "string" && /^recordings\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.m4a$/.test(resource.path);
  if (resource.kind === "learner-recordings") return typeof resource.learnerId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(resource.learnerId);
  if (resource.kind !== "audio") return false;
  const course = resource.course;
  return !!course && /^user\.[a-f0-9]{32}$/.test(course.courseId) && validId(course.courseVersion) && typeof course.title === "string" &&
    course.title.length > 0 && course.title.length <= 200 && Array.isArray(course.assets) && course.assets.length > 0 && course.assets.length <= 512 &&
    course.assets.every(asset => asset && validId(asset.id) && typeof asset.text === "string" && asset.text.length > 0 && asset.text.length <= 3000) &&
    new Set(course.assets.map(asset => asset.id)).size === course.assets.length && new Set(course.assets.map(asset => asset.text)).size === course.assets.length;
}
export const deletionStateCodec: SnapshotCodec<DeletionState> = {
  storageKey: "lingonest.deletions.v1",
  empty: () => ({ formatVersion: 1, plans: [], completed: [] }),
  decode(payload) {
    const value = JSON.parse(payload) as DeletionState;
    const fail = () => { throw Error("删除协调记录不受支持，原数据保留，请勿继续删除。"); };
    if (!value || value.formatVersion !== 1 || !Array.isArray(value.plans) || value.plans.length > 300 ||
      !Array.isArray(value.completed) || value.completed.length > 10000 || !value.completed.every(validTarget)) fail();
    const targets = new Set(value.completed.map(targetKey)), planIds = new Set<string>();
    if (targets.size !== value.completed.length) fail();
    for (const plan of value.plans) {
      if (!plan || !validId(plan.id) || planIds.has(plan.id) || !validTarget(plan.target) || targets.has(targetKey(plan.target)) ||
        !Array.isArray(plan.participants) || !plan.participants.length || !plan.participants.every(validId) ||
        new Set(plan.participants).size !== plan.participants.length || !Array.isArray(plan.removed) || !plan.removed.every(id => plan.participants.includes(id)) ||
        new Set(plan.removed).size !== plan.removed.length || !Array.isArray(plan.resources) || plan.resources.length > 100000 ||
        !plan.resources.every(validResource) || !Array.isArray(plan.cleaned) || !plan.cleaned.every(key => typeof key === "string") ||
        new Set(plan.resources.map(resourceKey)).size !== plan.resources.length || new Set(plan.cleaned).size !== plan.cleaned.length ||
        plan.cleaned.some(key => !plan.resources.some(resource => resourceKey(resource) === key)) || plan.cleaned.length && plan.removed.length !== plan.participants.length) fail();
      targets.add(targetKey(plan.target)); planIds.add(plan.id);
    }
    return value;
  },
};

/** Data owners interpret their own payloads. The coordinator only manages durable work. */
export class DeletionCoordinator {
  private loaded = false;
  constructor(readonly state: SharedSnapshot<DeletionState>, private readonly queue: MutationQueue,
    private readonly participants: DeletionParticipant[], private readonly clean: (resource: OwnedResource) => Promise<void>) {
    if (new Set(participants.map(participant => participant.id)).size !== participants.length) throw Error("删除参与者重复。");
  }
  async load() { await this.state.load(); this.loaded = true; }
  async refresh() { await this.state.refresh(); this.loaded = true; }
  pendingTargets(): DeletionTarget[] { return this.loaded ? this.state.snapshot().plans.map(plan => ({ ...plan.target })) : []; }
  dataRemoved(target: DeletionTarget): boolean {
    if (!this.loaded) return false;
    const state = this.state.snapshot();
    const plan = state.plans.find(item => targetKey(item.target) === targetKey(target));
    return state.completed.some(item => targetKey(item) === targetKey(target)) || !!plan && plan.removed.length === plan.participants.length;
  }
  isBlocked(target: DeletionTarget): boolean {
    if (!this.loaded) return false;
    const state = this.state.snapshot();
    return [...state.completed, ...state.plans.map(plan => plan.target)].some(item => targetKey(item) === targetKey(target));
  }
  request(target: DeletionTarget): Promise<void> {
    return this.queue.run(async () => {
      await this.state.refresh();
      const state = this.state.snapshot();
      if (state.completed.some(item => targetKey(item) === targetKey(target))) return;
      let plan = state.plans.find(item => targetKey(item.target) === targetKey(target));
      if (!plan) {
        if (!validTarget(target)) throw Error("删除对象无效。");
        const resources = (await Promise.all(this.participants.map(participant => participant.prepare(target)))).flat();
        const identity = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
        plan = { id: `delete-${identity}`, target: { ...target }, participants: this.participants.map(participant => participant.id),
          removed: [], resources: [...new Map(resources.map(resource => [resourceKey(resource), resource])).values()], cleaned: [] };
        await this.state.update(value => { value.plans.push(plan!); });
      }
      await this.finish(plan.id);
    });
  }
  resume(): Promise<void> {
    return this.queue.run(async () => {
      await this.state.refresh();
      for (const plan of this.state.snapshot().plans) await this.finish(plan.id);
    });
  }
  private async finish(planId: string) {
    let plan = this.state.snapshot().plans.find(plan => plan.id === planId)!;
    const owners = plan.participants.map(id => {
      const participant = this.participants.find(item => item.id === id);
      if (!participant) throw Error(`需要原模式 ${id} 完成删除，现有数据保留。`);
      return participant;
    });
    for (const participant of owners) {
      if (plan.removed.includes(participant.id)) continue;
      await participant.remove(plan.target);
      await this.state.update(value => { value.plans.find(item => item.id === planId)!.removed.push(participant.id); });
      plan = this.state.snapshot().plans.find(plan => plan.id === planId)!;
    }
    const retained = (await Promise.all(this.participants.map(participant => participant.retained()))).flat();
    const keys = new Set(retained.map(resourceKey));
    for (const resource of plan.resources) {
      const key = resourceKey(resource);
      if (plan.cleaned.includes(key)) continue;
      const directoryRetained = resource.kind === "learner-recordings" && retained.some(item => item.kind === "recording" && item.path.startsWith(`recordings/${resource.learnerId}/`));
      if (!keys.has(key) && !directoryRetained) await this.clean(resource);
      await this.state.update(value => { value.plans.find(item => item.id === planId)!.cleaned.push(key); });
    }
    await this.state.update(value => {
      value.completed.push({ ...plan.target }); value.plans = value.plans.filter(item => item.id !== planId);
    });
  }
}
