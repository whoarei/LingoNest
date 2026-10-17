import type { InjectionKey } from "vue";
import type { CatalogPort } from "../../packages/learning-modes/catalog";
export const catalogKey: InjectionKey<CatalogPort> = Symbol("shared-material-catalog");
