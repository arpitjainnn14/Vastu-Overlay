import { useEffect, useMemo, useRef, useState } from "react";
import { applyTransform, computeTransformFromAnchors, getImageCenter, normalizeTransform } from "./geometry";
import { DEFAULT_MAPPING_TEMPLATE } from "./defaultMapping";
import { fileToFloorPlan, fileToMappingTemplate } from "./fileUtils";
import { exportCanvasAsJpeg, exportCanvasAsPdf } from "./exportUtils";
import {
  clearDefaultMapping,
  createInitialState,
  loadDefaultMapping,
  loadProject,
  saveDefaultMapping,
  saveProject,
} from "./storage";
import type { LabelDefinition, OverlayTransform, Point, ProjectState } from "./types";

type DragTarget =
  | { type: "overlay" }
  | { type: "floor-anchor"; index: 0 | 1 }
  | { type: "mapping-anchor"; index: 0 | 1 };

const formatDegrees = (rotation: number) => `${((rotation * 180) / Math.PI).toFixed(1)}deg`;
const getFloorPlanCenter = (project: ProjectState): Point =>
  project.floorPlan?.centerPoint ?? {
    x: (project.floorPlan?.width ?? 0) / 2,
    y: (project.floorPlan?.height ?? 0) / 2,
  };

function App() {
  const [project, setProject] = useState<ProjectState>(() => loadProject());
  const [error, setError] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const floorPlanInputRef = useRef<HTMLInputElement | null>(null);
  const mappingInputRef = useRef<HTMLInputElement | null>(null);
  const overlayImageRef = useRef<HTMLImageElement | null>(null);
  const floorImageRef = useRef<HTMLImageElement | null>(null);

  const canExport = Boolean(project.floorPlan);

  useEffect(() => {
    saveProject(project);
  }, [project]);

  useEffect(() => {
    const loadImages = async () => {
      overlayImageRef.current = await loadImageElement(project.mapping.imageDataUrl);
      floorImageRef.current = project.floorPlan
        ? await loadImageElement(project.floorPlan.dataUrl)
        : null;
      drawPreview();
    };

    void loadImages();
  }, [project.floorPlan, project.mapping, project.transform, project.floorAnchors]);

  const overlayLabels = useMemo(() => project.mapping.labels, [project.mapping.labels]);

  const updateProject = (updater: (current: ProjectState) => ProjectState) => {
    setProject((current) => updater(current));
  };

  const handleFloorPlanUpload = async (file: File) => {
    try {
      setBusyMessage("Preparing floor plan...");
      setError(null);
      const floorPlan = await fileToFloorPlan(file);
      const centerPoint = floorPlan.centerPoint ?? {
        x: floorPlan.width / 2,
        y: floorPlan.height / 2,
      };
      updateProject((current) => ({
        ...current,
        floorPlan,
        transform: normalizeTransform({
          ...createInitialState().transform,
          x: centerPoint.x,
          y: centerPoint.y,
        }),
        floorAnchors: [
          { x: floorPlan.width * 0.3, y: floorPlan.height * 0.2 },
          { x: floorPlan.width * 0.3, y: floorPlan.height * 0.8 },
        ],
      }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to load floor plan.");
    } finally {
      setBusyMessage(null);
    }
  };

  const handleMappingUpload = async (file: File) => {
    try {
      setBusyMessage("Loading vastu mapping image...");
      setError(null);
      const mapping = await fileToMappingTemplate(file);
      updateProject((current) => ({
        ...current,
        mapping,
      }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to load mapping image.");
    } finally {
      setBusyMessage(null);
    }
  };

  const handleSaveMappingAsDefault = () => {
    saveDefaultMapping(project.mapping);
    setBusyMessage("Current scale saved as the default for this device.");
    window.setTimeout(() => setBusyMessage(null), 2200);
  };

  const handleResetDefaultMapping = () => {
    clearDefaultMapping();
    const defaultMapping = loadDefaultMapping();
    updateProject((current) => ({
      ...current,
      mapping: defaultMapping,
    }));
    setBusyMessage("Default scale reset to the built-in preset.");
    window.setTimeout(() => setBusyMessage(null), 2200);
  };

  const drawPreview = () => {
    const canvas = previewCanvasRef.current;
    const floorImage = floorImageRef.current;
    const overlayImage = overlayImageRef.current;

    if (!canvas || !floorImage || !overlayImage || !project.floorPlan) {
      return;
    }

    canvas.width = project.floorPlan.width;
    canvas.height = project.floorPlan.height;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(floorImage, 0, 0, canvas.width, canvas.height);

    context.save();
    context.globalAlpha = project.transform.opacity;
    context.translate(project.transform.x, project.transform.y);
    context.rotate(project.transform.rotation);
    context.scale(project.transform.scale, project.transform.scale);
    context.drawImage(
      overlayImage,
      -project.mapping.width / 2,
      -project.mapping.height / 2,
      project.mapping.width,
      project.mapping.height,
    );
    context.restore();

    if (project.mapping.id !== DEFAULT_MAPPING_TEMPLATE.id && overlayLabels.length > 0) {
      drawLabels(context, overlayLabels, project.transform, project.mapping.width, project.mapping.height);
    }
    const floorPlanCenter = getFloorPlanCenter(project);
    drawCenterMarker(context, {
      x: floorPlanCenter.x,
      y: floorPlanCenter.y,
    });
    drawAnchors(context, project.floorAnchors, "#0b5d1e");
    drawAnchors(
      context,
      project.mapping.anchors.map((anchor) =>
        applyTransform(anchor, project.transform, {
          width: project.mapping.width,
          height: project.mapping.height,
        }),
      ) as [Point, Point],
      "#983000",
    );
  };

  const updateTransform = (partial: Partial<OverlayTransform>) => {
    updateProject((current) => ({
      ...current,
      transform: normalizeTransform({
        ...current.transform,
        ...partial,
      }),
    }));
  };

  const handleAutoAlign = () => {
    updateProject((current) => ({
      ...current,
      transform: {
        ...computeTransformFromAnchors(current.mapping.anchors, current.floorAnchors, {
          width: current.mapping.width,
          height: current.mapping.height,
        }),
        opacity: current.transform.opacity,
      },
    }));
  };

  const handleCenterOverlay = () => {
    if (!project.floorPlan) {
      return;
    }

    const floorPlanCenter = getFloorPlanCenter(project);
    const fitScale =
      Math.min(
        project.floorPlan.width / project.mapping.width,
        project.floorPlan.height / project.mapping.height,
      ) * 0.72;

    updateTransform({
      x: floorPlanCenter.x,
      y: floorPlanCenter.y,
      scale: fitScale,
    });
  };

  const nudgeRotation = (deltaDegrees: number) => {
    updateTransform({
      rotation: project.transform.rotation + (deltaDegrees * Math.PI) / 180,
    });
  };

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    const floorIndex = findNearbyPoint(point, project.floorAnchors);
    if (floorIndex !== null) {
      setDragTarget({ type: "floor-anchor", index: floorIndex });
      return;
    }

    const transformedAnchors = project.mapping.anchors.map((anchor) =>
      applyTransform(anchor, project.transform, {
        width: project.mapping.width,
        height: project.mapping.height,
      }),
    ) as [Point, Point];
    const mappingIndex = findNearbyPoint(point, transformedAnchors);
    if (mappingIndex !== null) {
      setDragTarget({ type: "mapping-anchor", index: mappingIndex });
      return;
    }

    if (pointInsideOverlay(point, project.mapping.width, project.mapping.height, project.transform)) {
      setDragOffset({
        x: point.x - project.transform.x,
        y: point.y - project.transform.y,
      });
      setDragTarget({ type: "overlay" });
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragTarget) {
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }

    if (dragTarget.type === "overlay") {
      updateTransform({ x: point.x - dragOffset.x, y: point.y - dragOffset.y });
      return;
    }

    if (dragTarget.type === "floor-anchor") {
      updateProject((current) => {
        const floorAnchors = [...current.floorAnchors] as [Point, Point];
        floorAnchors[dragTarget.index] = point;
        return { ...current, floorAnchors };
      });
      return;
    }

    const inversePoint = invertPoint(point, project.transform, {
      width: project.mapping.width,
      height: project.mapping.height,
    });
    updateProject((current) => {
      const anchors = [...current.mapping.anchors] as [Point, Point];
      anchors[dragTarget.index] = inversePoint;
      return {
        ...current,
        mapping: {
          ...current.mapping,
          anchors,
        },
      };
    });
  };

  const handlePointerUp = () => {
    setDragTarget(null);
  };

  const resetProject = () => {
    setProject(createInitialState());
    setError(null);
    setBusyMessage(null);
    if (floorPlanInputRef.current) {
      floorPlanInputRef.current.value = "";
    }
    if (mappingInputRef.current) {
      mappingInputRef.current.value = "";
    }
  };

  const exportImage = async (type: "jpeg" | "pdf") => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return;
    }

    try {
      setBusyMessage(`Exporting ${type.toUpperCase()}...`);
      if (type === "jpeg") {
        await exportCanvasAsJpeg(canvas, "vastu-overlay.jpeg");
      } else {
        await exportCanvasAsPdf(canvas, "vastu-overlay.pdf");
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed.");
    } finally {
      setBusyMessage(null);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-copy">
          <div className="topbar-badge-row">
            <p className="eyebrow">Anjali Vastu Consultation Studio</p>
          </div>
          <h1>Vastu floor plan review for clear client guidance.</h1>
          <p className="lede">
            Present each layout with a composed, accurate overlay so direction and placement can be explained with confidence.
          </p>
        </div>
        <div className="topbar-meta">
          <div className="meta-block">
            <span className="meta-label">Current plan</span>
            <span className="meta-value">
              {project.floorPlan ? project.floorPlan.fileName : "Waiting for upload"}
            </span>
          </div>
          <div className="meta-block">
            <span className="meta-label">Default scale</span>
            <span className="meta-value">{project.mapping.name}</span>
          </div>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="controls-column">
          <div className="controls-shell">
            <section className="panel">
              <div className="section-head compact-head">
                <span className="section-step">01</span>
                <div className="section-copy">
                  <h2>Client Plan</h2>
                  <p className="hint">Open the floor plan for this consultation and keep the default vastu scale ready.</p>
                </div>
              </div>
              <label className="file-field">
                <span>Floor plan image or PDF</span>
                <input
                  ref={floorPlanInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleFloorPlanUpload(file);
                    }
                  }}
                />
              </label>
              <label className="file-field">
                <span>Custom vastu mapping image</span>
                <input
                  ref={mappingInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleMappingUpload(file);
                    }
                  }}
                />
              </label>
              <div className="button-row">
                <button className="secondary-button" onClick={handleSaveMappingAsDefault} type="button">
                  Save this scale as default
                </button>
                <button className="ghost-button" onClick={handleResetDefaultMapping} type="button">
                  Use built-in default scale
                </button>
                <button className="ghost-button" onClick={resetProject} type="button">
                  New consultation
                </button>
              </div>
              <div className="hint">
                `Save this scale as default` keeps the currently uploaded scale as her preset on this browser. `Use built-in default scale` removes that saved preset and switches back to the app's built-in scale.
              </div>
            </section>

            <section className="panel">
              <div className="section-head compact-head">
                <span className="section-step">02</span>
                <div className="section-copy">
                  <h2>Compass Placement</h2>
                  <p className="hint">
                    Rotate and place the scale so the plan can be explained naturally during the consultation.
                  </p>
                </div>
              </div>
              <div className="button-row">
                <button className="primary-button" onClick={handleAutoAlign} type="button">
                  Match anchors
                </button>
                <button
                  className="secondary-button"
                  onClick={handleCenterOverlay}
                  type="button"
                  disabled={!project.floorPlan}
                >
                  Center scale on plan
                </button>
                <button className="secondary-button" onClick={() => nudgeRotation(-90)} type="button">
                  Rotate -90°
                </button>
                <button className="secondary-button" onClick={() => nudgeRotation(90)} type="button">
                  Rotate +90°
                </button>
              </div>
              <div className="control-grid">
                <label>
                  <span className="control-title">Horizontal offset</span>
                  <input
                    type="range"
                    min={-400}
                    max={2000}
                    value={project.transform.x}
                    onChange={(event) => updateTransform({ x: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span className="control-title">Vertical offset</span>
                  <input
                    type="range"
                    min={-400}
                    max={2000}
                    value={project.transform.y}
                    onChange={(event) => updateTransform({ y: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span className="control-title">Scale</span>
                  <input
                    type="range"
                    min={0.1}
                    max={3}
                    step={0.01}
                    value={project.transform.scale}
                    onChange={(event) => updateTransform({ scale: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span className="control-title">Rotation</span>
                  <input
                    type="range"
                    min={-3.14}
                    max={3.14}
                    step={0.01}
                    value={project.transform.rotation}
                    onChange={(event) => updateTransform({ rotation: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span className="control-title">Opacity</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.01}
                    value={project.transform.opacity}
                    onChange={(event) => updateTransform({ opacity: Number(event.target.value) })}
                  />
                </label>
              </div>
              <div className="stats">
                <div className="stat-block">
                  <span className="stat-label">Rotation</span>
                  <span className="stat-value">{formatDegrees(project.transform.rotation)}</span>
                </div>
                <div className="stat-block">
                  <span className="stat-label">Scale</span>
                  <span className="stat-value">{project.transform.scale.toFixed(2)}x</span>
                </div>
                <div className="stat-block">
                  <span className="stat-label">Opacity</span>
                  <span className="stat-value">{Math.round(project.transform.opacity * 100)}%</span>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="section-head compact-head">
                <span className="section-step">03</span>
                <div className="section-copy">
                  <h2>Save Output</h2>
                  <p className="hint">Download the reviewed layout exactly as it appears on screen.</p>
                </div>
              </div>
              <div className="button-row">
                <button
                  className="primary-button"
                  onClick={() => void exportImage("jpeg")}
                  type="button"
                  disabled={!canExport}
                >
                  Export JPEG
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void exportImage("pdf")}
                  type="button"
                  disabled={!canExport}
                >
                  Export PDF
                </button>
              </div>
            </section>
          </div>

          {(busyMessage || error) ? (
            <div className="message-stack">
              {busyMessage ? <div className="status">{busyMessage}</div> : null}
              {error ? <div className="error">{error}</div> : null}
            </div>
          ) : null}
        </section>

        <section className="preview-column">
          <div className="preview-header">
            <div className="preview-title">
              <p className="preview-kicker">Consultation View</p>
              <h2>Floor plan presentation canvas</h2>
              <p className="hint">Green points mark the floor plan. Amber points mark the vastu scale.</p>
            </div>
            <div className="preview-meta">
              <span>{canExport ? "Ready to export" : "Upload a plan to begin"}</span>
              <span>
                {project.floorPlan ? `${project.floorPlan.width} × ${project.floorPlan.height}` : "No canvas yet"}
              </span>
            </div>
          </div>

          <div className="workspace">
            {project.floorPlan ? (
              <div className="canvas-frame">
                <canvas
                  aria-label="Overlay preview canvas"
                  className="preview-canvas"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  ref={previewCanvasRef}
                />
              </div>
            ) : (
              <div className="empty-state">
                <h2>Upload a floor plan to begin</h2>
                <p>The interactive preview appears here once the first file is loaded.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

const loadImageElement = async (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

const findNearbyPoint = (point: Point, anchors: [Point, Point]): 0 | 1 | null => {
  if (Math.hypot(point.x - anchors[0].x, point.y - anchors[0].y) < 24) {
    return 0;
  }
  if (Math.hypot(point.x - anchors[1].x, point.y - anchors[1].y) < 24) {
    return 1;
  }
  return null;
};

const invertPoint = (
  point: Point,
  transform: OverlayTransform,
  size: { width: number; height: number },
): Point => {
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  const cos = Math.cos(-transform.rotation);
  const sin = Math.sin(-transform.rotation);
  const center = getImageCenter(size.width, size.height);

  return {
    x: center.x + (dx * cos - dy * sin) / transform.scale,
    y: center.y + (dx * sin + dy * cos) / transform.scale,
  };
};

const pointInsideOverlay = (
  point: Point,
  width: number,
  height: number,
  transform: OverlayTransform,
) => {
  const inverse = invertPoint(point, transform, { width, height });
  return inverse.x >= 0 && inverse.y >= 0 && inverse.x <= width && inverse.y <= height;
};

const drawLabels = (
  context: CanvasRenderingContext2D,
  labels: LabelDefinition[],
  transform: OverlayTransform,
  width: number,
  height: number,
) => {
  context.save();
  context.font = "700 24px Georgia, serif";
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const label of labels) {
    const point = applyTransform({ x: label.x, y: label.y }, transform, { width, height });
    context.fillStyle = "rgba(80, 49, 0, 0.96)";
    context.strokeStyle = "rgba(255,255,255,0.9)";
    context.lineWidth = 5;
    context.strokeText(label.text, point.x, point.y);
    context.fillText(label.text, point.x, point.y);
  }

  context.restore();
};

const drawAnchors = (
  context: CanvasRenderingContext2D,
  anchors: [Point, Point],
  color: string,
) => {
  context.save();
  context.strokeStyle = color;
  context.fillStyle = "#ffffff";
  context.lineWidth = 3;

  for (const anchor of anchors) {
    context.beginPath();
    context.arc(anchor.x, anchor.y, 11, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.beginPath();
    context.moveTo(anchor.x - 18, anchor.y);
    context.lineTo(anchor.x + 18, anchor.y);
    context.moveTo(anchor.x, anchor.y - 18);
    context.lineTo(anchor.x, anchor.y + 18);
    context.stroke();
  }

  context.restore();
};

const drawCenterMarker = (context: CanvasRenderingContext2D, point: Point) => {
  context.save();
  context.strokeStyle = "rgba(28, 78, 145, 0.92)";
  context.fillStyle = "#ffffff";
  context.lineWidth = 2;

  context.beginPath();
  context.arc(point.x, point.y, 9, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(point.x - 16, point.y);
  context.lineTo(point.x + 16, point.y);
  context.moveTo(point.x, point.y - 16);
  context.lineTo(point.x, point.y + 16);
  context.stroke();

  context.restore();
};

export default App;
