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

const ROTATION_SNAP = Math.PI / 12; // 15°
const snapAngle = (radians: number) => Math.round(radians / ROTATION_SNAP) * ROTATION_SNAP;

const formatDegrees = (rotation: number) => `${((rotation * 180) / Math.PI).toFixed(1)}deg`;
const getFloorPlanCenter = (project: ProjectState): Point =>
  project.floorPlan?.centerPoint ?? {
    x: (project.floorPlan?.width ?? 0) / 2,
    y: (project.floorPlan?.height ?? 0) / 2,
  };

type NumberFieldProps = {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
};

// Number box paired with a slider. Holds a draft string while focused so
// typing (including decimals) isn't clobbered by the rounded committed value.
function NumberField({ value, onCommit, min, max, step, unit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? String(value);

  return (
    <span className="control-value">
      <input
        className="control-number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={display}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(parsed)) {
            onCommit(parsed);
          }
        }}
        onBlur={() => setDraft(null)}
      />
      {unit ? <span className="control-unit">{unit}</span> : null}
    </span>
  );
}

function App() {
  const [project, setProject] = useState<ProjectState>(() => loadProject());
  const [error, setError] = useState<string | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [snapRotation, setSnapRotation] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const floorPlanInputRef = useRef<HTMLInputElement | null>(null);
  const mappingInputRef = useRef<HTMLInputElement | null>(null);
  const overlayImageRef = useRef<HTMLImageElement | null>(null);
  const floorImageRef = useRef<HTMLImageElement | null>(null);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  const projectRef = useRef(project);
  const historyRef = useRef<{ past: ProjectState[]; future: ProjectState[] }>({
    past: [],
    future: [],
  });
  const commitTimerRef = useRef<number | null>(null);
  const activePointersRef = useRef<Map<number, Point>>(new Map());
  const pinchRef = useRef<{ dist: number; mid: Point; angle: number } | null>(null);

  const canExport = Boolean(project.floorPlan);

  useEffect(() => {
    projectRef.current = project;
    saveProject(project);
  }, [project]);

  const HISTORY_LIMIT = 50;

  // Snapshot the pre-change state, coalescing a burst of rapid edits (a drag,
  // a slider sweep, a zoom) into a single undo step.
  const recordHistory = () => {
    const history = historyRef.current;
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
    } else {
      history.past.push(projectRef.current);
      if (history.past.length > HISTORY_LIMIT) {
        history.past.shift();
      }
      history.future = [];
      setCanUndo(true);
      setCanRedo(false);
    }
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
    }, 500);
  };

  const clearHistory = () => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    historyRef.current = { past: [], future: [] };
    setCanUndo(false);
    setCanRedo(false);
  };

  const undo = () => {
    const history = historyRef.current;
    if (history.past.length === 0) {
      return;
    }
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const previous = history.past.pop()!;
    history.future.unshift(projectRef.current);
    setProject(previous);
    setCanUndo(history.past.length > 0);
    setCanRedo(true);
  };

  const redo = () => {
    const history = historyRef.current;
    if (history.future.length === 0) {
      return;
    }
    const next = history.future.shift()!;
    history.past.push(projectRef.current);
    setProject(next);
    setCanUndo(true);
    setCanRedo(history.future.length > 0);
  };

  // Decode the overlay image only when its source actually changes.
  useEffect(() => {
    let cancelled = false;
    void loadImageElement(project.mapping.imageDataUrl).then((image) => {
      if (!cancelled) {
        overlayImageRef.current = image;
        drawPreview();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.mapping.imageDataUrl]);

  // Decode the floor plan only when the plan changes.
  useEffect(() => {
    if (!project.floorPlan) {
      floorImageRef.current = null;
      return;
    }
    let cancelled = false;
    void loadImageElement(project.floorPlan.dataUrl).then((image) => {
      if (!cancelled) {
        floorImageRef.current = image;
        drawPreview();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.floorPlan]);

  // Cheap redraw on every transform/anchor/mapping change — no image decode.
  useEffect(() => {
    drawPreview();
  }, [project.transform, project.floorAnchors, project.mapping]);

  // Wheel-to-zoom needs a non-passive native listener so preventDefault works
  // (React routes onWheel through a passive listener). The ref keeps state fresh.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return;
    }
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  }, [project.floorPlan]);

  // Arrow keys nudge the overlay (Shift = bigger step); [ and ] rotate it.
  useEffect(() => {
    if (!project.floorPlan) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      switch (event.key) {
        case "ArrowLeft":
          updateTransform({ x: project.transform.x - step });
          break;
        case "ArrowRight":
          updateTransform({ x: project.transform.x + step });
          break;
        case "ArrowUp":
          updateTransform({ y: project.transform.y - step });
          break;
        case "ArrowDown":
          updateTransform({ y: project.transform.y + step });
          break;
        case "[":
          if (snapRotation) {
            updateTransform({ rotation: snapAngle(project.transform.rotation) - ROTATION_SNAP });
          } else {
            nudgeRotation(event.shiftKey ? -5 : -1);
          }
          break;
        case "]":
          if (snapRotation) {
            updateTransform({ rotation: snapAngle(project.transform.rotation) + ROTATION_SNAP });
          } else {
            nudgeRotation(event.shiftKey ? 5 : 1);
          }
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [project.floorPlan, project.transform, snapRotation]);

  const overlayLabels = useMemo(() => project.mapping.labels, [project.mapping.labels]);

  const updateProject = (updater: (current: ProjectState) => ProjectState) => {
    recordHistory();
    setProject((current) => updater(current));
  };

  // Add Undo/Redo wiring through a ref so the global listener stays current.
  const historyKeyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  historyKeyRef.current = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    } else if (key === "y") {
      event.preventDefault();
      redo();
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => historyKeyRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

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
      setActiveStep(2);
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
    const adjusted =
      snapRotation && partial.rotation !== undefined
        ? { ...partial, rotation: snapAngle(partial.rotation) }
        : partial;
    updateProject((current) => ({
      ...current,
      transform: normalizeTransform({
        ...current.transform,
        ...adjusted,
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

  const handleResetPlacement = () => {
    if (!project.floorPlan) {
      return;
    }
    const floorPlanCenter = getFloorPlanCenter(project);
    updateTransform({
      ...createInitialState().transform,
      x: floorPlanCenter.x,
      y: floorPlanCenter.y,
    });
  };

  const getCanvasPointFromClient = (clientX: number, clientY: number): Point | null => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point | null =>
    getCanvasPointFromClient(event.clientX, event.clientY);

  // The canvas is drawn at the plan's native resolution but displayed much
  // smaller on phones, so grow the tap radius to stay finger-friendly.
  const getHitRadius = () => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return 24;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) {
      return 24;
    }
    return Math.max(24, (canvas.width / rect.width) * 22);
  };

  const getActivePinch = () => {
    const points = Array.from(activePointersRef.current.values());
    if (points.length < 2) {
      return null;
    }
    const a = getCanvasPointFromClient(points[0].x, points[0].y);
    const b = getCanvasPointFromClient(points[1].x, points[1].y);
    if (!a || !b) {
      return null;
    }
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  };

  // Scroll/pinch to zoom, centred on the cursor so the point under it stays put.
  wheelHandlerRef.current = (event: WheelEvent) => {
    if (!project.floorPlan) {
      return;
    }
    event.preventDefault();
    const point = getCanvasPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const factor = Math.exp(-event.deltaY * 0.0015);
    updateProject((current) => {
      const zoomed = normalizeTransform({
        ...current.transform,
        scale: current.transform.scale * factor,
      });
      const ratio = zoomed.scale / current.transform.scale;
      return {
        ...current,
        transform: normalizeTransform({
          ...zoomed,
          x: point.x + (current.transform.x - point.x) * ratio,
          y: point.y + (current.transform.y - point.y) * ratio,
        }),
      };
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    previewCanvasRef.current?.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Two fingers down → pinch to zoom/rotate; suspend any single-finger drag.
    if (activePointersRef.current.size >= 2) {
      setDragTarget(null);
      pinchRef.current = getActivePinch();
      return;
    }

    const point = getCanvasPoint(event);
    if (!point) {
      return;
    }
    const radius = getHitRadius();

    const floorIndex = findNearbyPoint(point, project.floorAnchors, radius);
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
    const mappingIndex = findNearbyPoint(point, transformedAnchors, radius);
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
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    // Pinch gesture: scale + rotate about the midpoint, and pan with it.
    if (activePointersRef.current.size >= 2 && pinchRef.current) {
      const next = getActivePinch();
      if (!next) {
        return;
      }
      const prev = pinchRef.current;
      const ratio = prev.dist === 0 ? 1 : next.dist / prev.dist;
      const dAngle = next.angle - prev.angle;
      const cos = Math.cos(dAngle);
      const sin = Math.sin(dAngle);
      updateProject((current) => {
        const relX = current.transform.x - prev.mid.x;
        const relY = current.transform.y - prev.mid.y;
        const rawRotation = current.transform.rotation + dAngle;
        return {
          ...current,
          transform: normalizeTransform({
            ...current.transform,
            scale: current.transform.scale * ratio,
            rotation: snapRotation ? snapAngle(rawRotation) : rawRotation,
            x: prev.mid.x + (relX * cos - relY * sin) * ratio + (next.mid.x - prev.mid.x),
            y: prev.mid.y + (relX * sin + relY * cos) * ratio + (next.mid.y - prev.mid.y),
          }),
        };
      });
      pinchRef.current = next;
      return;
    }

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

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      previewCanvasRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // pointer was never captured; ignore.
    }
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      setDragTarget(null);
    }
  };

  const resetProject = () => {
    setProject(createInitialState());
    setError(null);
    setBusyMessage(null);
    setActiveStep(1);
    clearHistory();
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

  const goToStep = (step: 1 | 2 | 3) => {
    if (step !== 1 && !project.floorPlan) {
      return;
    }
    setActiveStep((current) => (current === step ? current : step));
  };

  const placeSummary = project.floorPlan
    ? `${project.transform.scale.toFixed(2)}× · ${formatDegrees(project.transform.rotation)}`
    : "Upload a plan first";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="eyebrow">Anjali Vastu Consultation Studio</span>
          <h1>Vastu Floor Overlay</h1>
        </div>
        <div className="topbar-right">
          <div className="topbar-actions">
            <button
              className="ghost-button"
              onClick={undo}
              type="button"
              disabled={!canUndo}
              title="Undo (Ctrl/Cmd+Z)"
            >
              ↺ Undo
            </button>
            <button
              className="ghost-button"
              onClick={redo}
              type="button"
              disabled={!canRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
            >
              ↻ Redo
            </button>
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
        </div>
      </header>

      <main className="workspace-grid">
        <section className="controls-column">
          <div className="steps">
            <div className={`step${activeStep === 1 ? " step--active" : ""}`}>
              <button className="step-header" type="button" onClick={() => goToStep(1)}>
                <span className="step-number">01</span>
                <span className="step-title">Client Plan</span>
                {activeStep !== 1 ? (
                  <span className="step-summary">
                    {project.floorPlan ? project.floorPlan.fileName : "Waiting for upload"}
                  </span>
                ) : null}
              </button>
              {activeStep === 1 ? (
                <div className="step-body">
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
                  <p className="hint">
                    Save the uploaded scale as this browser's default, or revert to the built-in scale at any time.
                  </p>
                </div>
              ) : null}
            </div>

            <div className={`step${activeStep === 2 ? " step--active" : ""}`}>
              <button
                className="step-header"
                type="button"
                onClick={() => goToStep(2)}
                disabled={!project.floorPlan}
              >
                <span className="step-number">02</span>
                <span className="step-title">Compass Placement</span>
                {activeStep !== 2 ? <span className="step-summary">{placeSummary}</span> : null}
              </button>
              {activeStep === 2 ? (
                <div className="step-body">
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
                    <button
                      className="ghost-button"
                      onClick={handleResetPlacement}
                      type="button"
                      disabled={!project.floorPlan}
                    >
                      Reset placement
                    </button>
                  </div>
                  <p className="hint">
                    Scroll over the canvas to zoom, drag to move, and use arrow keys to nudge (hold Shift for larger steps; <kbd>[</kbd> / <kbd>]</kbd> to rotate).
                  </p>
                  <div className="control-grid">
                    <label>
                      <div className="control-head">
                        <span className="control-title">Horizontal offset</span>
                        <NumberField
                          value={Math.round(project.transform.x)}
                          onCommit={(value) => updateTransform({ x: value })}
                          min={-5000}
                          max={5000}
                          step={1}
                          unit="px"
                        />
                      </div>
                      <input
                        type="range"
                        min={-400}
                        max={2000}
                        value={project.transform.x}
                        onChange={(event) => updateTransform({ x: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <div className="control-head">
                        <span className="control-title">Vertical offset</span>
                        <NumberField
                          value={Math.round(project.transform.y)}
                          onCommit={(value) => updateTransform({ y: value })}
                          min={-5000}
                          max={5000}
                          step={1}
                          unit="px"
                        />
                      </div>
                      <input
                        type="range"
                        min={-400}
                        max={2000}
                        value={project.transform.y}
                        onChange={(event) => updateTransform({ y: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <div className="control-head">
                        <span className="control-title">Scale</span>
                        <NumberField
                          value={Number(project.transform.scale.toFixed(2))}
                          onCommit={(value) => updateTransform({ scale: value })}
                          min={0.1}
                          max={8}
                          step={0.01}
                          unit="×"
                        />
                      </div>
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
                      <div className="control-head">
                        <span className="control-title">Rotation</span>
                        <NumberField
                          value={Math.round((project.transform.rotation * 180) / Math.PI)}
                          onCommit={(value) => updateTransform({ rotation: (value * Math.PI) / 180 })}
                          min={-180}
                          max={180}
                          step={1}
                          unit="°"
                        />
                      </div>
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
                      <div className="control-head">
                        <span className="control-title">Opacity</span>
                        <NumberField
                          value={Math.round(project.transform.opacity * 100)}
                          onCommit={(value) => updateTransform({ opacity: value / 100 })}
                          min={10}
                          max={100}
                          step={1}
                          unit="%"
                        />
                      </div>
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
                  <label className="snap-toggle">
                    <input
                      type="checkbox"
                      checked={snapRotation}
                      onChange={(event) => setSnapRotation(event.target.checked)}
                    />
                    <span>Snap rotation to 15°</span>
                  </label>
                </div>
              ) : null}
            </div>

            <div className={`step${activeStep === 3 ? " step--active" : ""}`}>
              <button
                className="step-header"
                type="button"
                onClick={() => goToStep(3)}
                disabled={!project.floorPlan}
              >
                <span className="step-number">03</span>
                <span className="step-title">Save Output</span>
                {activeStep !== 3 ? (
                  <span className="step-summary">{canExport ? "Ready to export" : "Upload a plan first"}</span>
                ) : null}
              </button>
              {activeStep === 3 ? (
                <div className="step-body">
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
                  <p className="hint">Downloads the reviewed layout exactly as it appears on the canvas.</p>
                </div>
              ) : null}
            </div>
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
            <p className="hint">Green points mark the floor plan. Amber points mark the vastu scale.</p>
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
                  onPointerCancel={handlePointerUp}
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

const findNearbyPoint = (
  point: Point,
  anchors: [Point, Point],
  radius = 24,
): 0 | 1 | null => {
  if (Math.hypot(point.x - anchors[0].x, point.y - anchors[0].y) < radius) {
    return 0;
  }
  if (Math.hypot(point.x - anchors[1].x, point.y - anchors[1].y) < radius) {
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
