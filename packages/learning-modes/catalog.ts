import type { LearnerProfile, SourceImage } from "./contracts";

/** Materials and identities only. Publication and teaching state belong to modes. */
export interface MaterialCourse {
  id: string;
  title: string;
  subtitle: string;
  sourceText: string;
  images: SourceImage[];
  supplementImages: SourceImage[];
  sourceRevision: string;
  archivedAt: string | null;
  builtin: boolean;
  /** Material owner's editing permission; publication checks still run on writes. */
  sourceEditable?: boolean;
}
export interface CatalogSnapshot {
  learners: LearnerProfile[];
  activeLearnerId: string | null;
  defaultCourseId: string;
  learningCourseIds: Record<string, string>;
  courses: MaterialCourse[];
}
export interface CatalogSelection {
  activeLearnerId: string | null;
  learnerIds: string[];
  defaultCourseId: string;
  learningCourseIds: Record<string, string>;
  availableCourseIds: string[];
}
export interface MaterialInput {
  title: string;
  subtitle: string;
  sourceText: string;
  images: SourceImage[];
  supplementImages: SourceImage[];
}
export interface CatalogPort {
  read(): Promise<CatalogSnapshot>;
  selection(): CatalogSelection;
  addLearner(nickname: string): Promise<string>;
  renameLearner(learnerId: string, nickname: string): Promise<void>;
  selectLearner(learnerId: string): Promise<void>;
  assignCourse(learnerId: string, courseId: string): Promise<void>;
  createMaterial(input: MaterialInput): Promise<string>;
  updateMaterial(courseId: string, input: MaterialInput): Promise<void>;
  archiveCourse(courseId: string): Promise<void>;
  restoreCourse(courseId: string): Promise<void>;
  purgeCourse(courseId: string): Promise<void>;
  deleteLearner(learnerId: string): Promise<void>;
}
