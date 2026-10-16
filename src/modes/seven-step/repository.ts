import { SnapshotRepository } from "../../platform/snapshot-repository";
import { sevenStepStateCodec } from "../../../packages/learning-modes/seven-step/state";

/** Same native store, browser key, revision checks and v1/v2 payloads as 0.1.14. */
export class LocalRepository extends SnapshotRepository<
  ReturnType<typeof sevenStepStateCodec.empty>
> {
  constructor() {
    super(sevenStepStateCodec, { nativeLegacy: true });
  }
}
