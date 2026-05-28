import { readFileSync } from "node:fs";

const CONFIG_PATH = new URL("../config/ieq9_targeted_extraction_config.json", import.meta.url);
const DEFAULT_FOOTER_PATTERN =
  "Copyright\\s+\\d{4}-\\d{4}\\s+Integrative\\s+Enneagram\\s+Solutions[\\s\\S]*?\\b\\d+\\s+of\\s+42\\b";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asPageNumberArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .map((entry) => Math.floor(entry));
}

function asStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function toPageMap(value) {
  const source = asObject(value);
  return Object.fromEntries(
    Object.entries(source).map(([key, pages]) => [String(key), asPageNumberArray(pages)]),
  );
}

function toHeaderMap(value) {
  const source = asObject(value);
  return Object.fromEntries(
    Object.entries(source).map(([key, headers]) => [String(key), asStringArray(headers)]),
  );
}

function loadConfig() {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const safe = asObject(raw);
  return {
    sectionPageMap: toPageMap(safe.section_page_map),
    developmentExerciseContextPages: toPageMap(safe.development_exercise_context_pages),
    sectionHeaderTitles: toHeaderMap(safe.section_header_titles),
    footerPatternSource:
      typeof safe.footer_pattern === "string" && safe.footer_pattern.trim()
        ? safe.footer_pattern
        : DEFAULT_FOOTER_PATTERN,
    outputSchema: asObject(safe.output_schema),
  };
}

const config = loadConfig();

export const TARGETED_SECTION_PAGE_MAP = config.sectionPageMap;
export const TARGETED_DEVELOPMENT_CONTEXT_PAGE_MAP = config.developmentExerciseContextPages;
export const TARGETED_SECTION_HEADER_TITLES = config.sectionHeaderTitles;
export const TARGETED_FOOTER_PATTERN = new RegExp(config.footerPatternSource, "gi");
export const ieq9_targeted_sections_schema = config.outputSchema;
