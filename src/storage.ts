import { DEFAULT_MAPPING_TEMPLATE } from "./defaultMapping";
import type { MappingTemplate, ProjectState } from "./types";

const STORAGE_KEY = "vastu-overlay-project";
const DEFAULT_MAPPING_KEY = "vastu-overlay-default-mapping";
const STUDIO_NAME_KEY = "vastu-overlay-studio-name";
const DEFAULT_STUDIO_NAME = "Anjali Vastu Studio";

export const loadStudioName = (): string => {
  if (typeof window === "undefined") {
    return DEFAULT_STUDIO_NAME;
  }
  return window.localStorage.getItem(STUDIO_NAME_KEY) ?? DEFAULT_STUDIO_NAME;
};

export const saveStudioName = (name: string): void => {
  window.localStorage.setItem(STUDIO_NAME_KEY, name);
};

const loadStoredDefaultMapping = (): MappingTemplate | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(DEFAULT_MAPPING_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as MappingTemplate;
  } catch {
    return null;
  }
};

export const loadDefaultMapping = (): MappingTemplate =>
  loadStoredDefaultMapping() ?? DEFAULT_MAPPING_TEMPLATE;

export const saveDefaultMapping = (mapping: MappingTemplate) => {
  window.localStorage.setItem(DEFAULT_MAPPING_KEY, JSON.stringify(mapping));
};

export const clearDefaultMapping = () => {
  window.localStorage.removeItem(DEFAULT_MAPPING_KEY);
};

export const createInitialState = (): ProjectState => ({
  id: crypto.randomUUID(),
  floorPlan: null,
  mapping: loadDefaultMapping(),
  transform: {
    x: 80,
    y: 80,
    scale: 0.55,
    rotation: 0,
    opacity: 0.72,
  },
  floorAnchors: [
    { x: 240, y: 140 },
    { x: 240, y: 540 },
  ],
});

export const loadProject = (): ProjectState => {
  if (typeof window === "undefined") {
    return createInitialState();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createInitialState();
  }

  try {
    const parsed = JSON.parse(raw) as ProjectState;
    const currentDefaultMapping = loadDefaultMapping();

    if (parsed.mapping.id === DEFAULT_MAPPING_TEMPLATE.id || parsed.mapping.id === currentDefaultMapping.id) {
      return {
        ...parsed,
        mapping: currentDefaultMapping,
      };
    }

    return parsed;
  } catch {
    return createInitialState();
  }
};

export const saveProject = (project: ProjectState) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
};
