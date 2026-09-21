/** Joins conditional class names without a runtime dependency. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter((value): value is string => typeof value === "string").join(" ");
}
