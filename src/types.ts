export type Point = {
  x: number;
  y: number;
};

export type OverlayTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

export type LabelDefinition = {
  id: string;
  text: string;
  x: number;
  y: number;
};

export type MappingTemplate = {
  id: string;
  name: string;
  imageDataUrl: string;
  labels: LabelDefinition[];
  width: number;
  height: number;
  anchors: [Point, Point];
};

export type FloorPlanAsset = {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  width: number;
  height: number;
  centerPoint?: Point;
};

export type ProjectState = {
  id: string;
  floorPlan: FloorPlanAsset | null;
  mapping: MappingTemplate;
  transform: OverlayTransform;
  floorAnchors: [Point, Point];
};
