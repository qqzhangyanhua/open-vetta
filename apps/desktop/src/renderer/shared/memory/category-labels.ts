import type { TFunction } from "i18next";
import type { MemoryCategory } from "@/shared/memory";

export function memoryCategoryLabels(t: TFunction<"chat">): Record<MemoryCategory, string> {
	return {
		identity: t("memoryReview.categories.identity"),
		family: t("memoryReview.categories.family"),
		location: t("memoryReview.categories.location"),
		work: t("memoryReview.categories.work"),
		preference: t("memoryReview.categories.preference"),
		interest: t("memoryReview.categories.interest"),
		other: t("memoryReview.categories.other"),
	};
}
