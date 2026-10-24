import { SnapshotRepository } from "../../platform/snapshot-repository";
import { sevenStepStateCodec } from "../../../packages/learning-modes/seven-step/state";

export class LocalRepository extends SnapshotRepository<ReturnType<typeof sevenStepStateCodec.empty>> {
  constructor() { super(sevenStepStateCodec); }
}
