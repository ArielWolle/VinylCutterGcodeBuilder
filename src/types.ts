export interface FrameSettings {
  widthMm: number;
  heightMm: number;
}

export interface ItemTransform {
  /** Position in mm of the local (0,0) origin (bottom-left of the natural bbox) on the frame. */
  x: number;
  y: number;
  /** Scale multipliers applied on top of the natural size. 1 = imported size. */
  scaleX: number;
  scaleY: number;
  /** Rotation in degrees, clockwise, about the item's center. */
  rotation: number;
}

export interface FlattenedPath {
  /** Points in the item's local mm space (scale 1, no rotation, origin at natural bbox
   *  bottom-left, Y increases upward). */
  points: [number, number][];
  closed: boolean;
}

export interface SvgItem {
  id: string;
  name: string;
  /** Natural bounding-box size in mm at scale 1 (before user transform). */
  naturalWidthMm: number;
  naturalHeightMm: number;
  transform: ItemTransform;
  paths: FlattenedPath[];
  visible: boolean;
  locked: boolean;
}

/** How the head is actuated between travel and work moves. */
export type HeadActuationMode = "z" | "spindle";

/** Cut = drag-knife (blade swivel compensation + overcut). Draw = pen/marker/foil (no blade offset). */
export type CutMode = "cut" | "draw";

export interface MachineSettings {
  cutMode: CutMode;

  feedRateCutMmMin: number;
  feedRateTravelMmMin: number;

  headActuation: HeadActuationMode;
  /** Z height when tool/blade is lifted (mm). Used when headActuation === 'z'. */
  zUp: number;
  /** Z height when tool/blade is down and cutting (mm). Used when headActuation === 'z'. */
  zDown: number;
  /** Safe Z used at job start/end, clear of clamps/material (mm). Used when headActuation === 'z'. */
  safeZ: number;
  /** G-code emitted to engage the head, used when headActuation === 'spindle'. */
  spindleOnCode: string;
  /** G-code emitted to disengage the head, used when headActuation === 'spindle'. */
  spindleOffCode: string;

  /** Diameter of the swivelling drag-knife blade (mm). Used when cutMode === 'cut'. */
  toolDiameterMm: number;
  /** Extra distance (mm) to continue cutting past the loop start, to fully sever material. */
  overcutMm: number;
  /** Greedy nearest-neighbour path ordering + drag-knife blade-alignment optimisation. */
  optimizeToolpath: boolean;

  /** Number of times to repeat each cut/draw pass. */
  passes: number;
  /** Z change applied after each pass beyond the first (mm). Only used when headActuation === 'z'. */
  passHeightDeltaMm: number;

  originOffsetX: number;
  originOffsetY: number;
  invertY: boolean;
  startGcode: string;
  endGcode: string;
  decimals: number;
}

export type EditorTool = "select" | "pan" | "measure";

export interface LogEntry {
  id: number;
  ts: number;
  dir: "tx" | "rx" | "info" | "error";
  text: string;
}

export type JobStatus = "idle" | "running" | "paused" | "done" | "error" | "stopped";
