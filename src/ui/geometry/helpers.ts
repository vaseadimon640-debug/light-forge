import { engineeringToThree, resolveComposition, type XYZ } from '../../geometry/resolve.ts';
import { resolvedCompositionSchema, type ResolvedComposition, type ResolvedValue } from '../../geometry/result.ts';
import {
  compositionSchema,
  type Axis,
  type Canopy,
  type Composition,
  type Element,
  type Point,
  type Shape,
} from '../../geometry/schema.ts';

export type GeometryFieldIssue = {
  path: (string | number)[];
  message: string;
};

export type CameraPreset = 'iso' | 'top' | 'front' | 'side';
export type LightVisualMode = 'off' | 'auto' | 'down' | 'up' | 'both' | 'diffuse';

export type VisualMaterialPreset = {
  id: string;
  label: string;
  color: string;
  metalness: number;
  roughness: number;
  swatch: string;
};

export const visualMaterialPresets: VisualMaterialPreset[] = [
  { id: 'satinBrass', label: 'Сатиновая латунь', color: '#c5a463', metalness: 0.82, roughness: 0.34, swatch: '#c5a463' },
  { id: 'brushedBrass', label: 'Шлифованная латунь', color: '#b8944f', metalness: 0.88, roughness: 0.28, swatch: '#b8944f' },
  { id: 'antiqueBrass', label: 'Состаренная латунь', color: '#876d43', metalness: 0.72, roughness: 0.48, swatch: '#876d43' },
  { id: 'brushedBronze', label: 'Бронза', color: '#6b5542', metalness: 0.76, roughness: 0.42, swatch: '#6b5542' },
  { id: 'matteBlack', label: 'Матовый чёрный', color: '#2b3033', metalness: 0.22, roughness: 0.68, swatch: '#2b3033' },
  { id: 'satinNickel', label: 'Сатиновый никель', color: '#b7bdc0', metalness: 0.84, roughness: 0.32, swatch: '#b7bdc0' },
  { id: 'white', label: 'Матовый белый', color: '#ecece8', metalness: 0.08, roughness: 0.62, swatch: '#ecece8' },
];

export const shapeLabels: Record<Shape['type'], string> = {
  ring: 'Кольцо',
  arc: 'Дуга',
  linear: 'Линейный профиль',
  envelope: 'Габаритная оболочка',
};

export const datumLabels: Record<Element['position']['lowest']['datum'], string> = {
  floor: 'От чистового пола',
  ceiling: 'От чистового потолка',
  tabletop: 'От столешницы',
};

export const suspensionTypeLabels: Record<Composition['suspensions'][number]['type'], string> = {
  loadBearingCable: 'Несущий трос',
  decorativeStrap: 'Декоративный ремень',
};

export const qualityLabels: Record<ResolvedValue['quality'], string> = {
  specified: 'По данным',
  estimated: 'Оценка',
  unknown: 'Неизвестно',
};

export function mmToMeters(mm: number): number {
  return mm / 1000;
}

/** Converts right-handed engineering mm coordinates to Three.js metres via Codex's engineeringToThree. */
export function toThreeMetres(point: XYZ): [number, number, number] {
  const mapped = engineeringToThree(point);
  return [mapped.x / 1000, mapped.y / 1000, mapped.z / 1000];
}

export function formatMm(value: ResolvedValue | undefined): string {
  if (!value || value.valueMm === null) return 'Неизвестно';
  const rounded = Math.round(value.valueMm * 10) / 10;
  return `${rounded} мм`;
}

export function formatAxisNum(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 10) / 10} мм`;
}

/**
 * Purely visual display layout derived from Codex's ResolvedComposition.
 * NEVER fabricates or mutates canonical coordinates: every staged axis is explicitly flagged.
 */
export type VisualElementPlacement = {
  id: string;
  displayXMm: number;
  displayYMm: number;
  displayLowestZMm: number;
  displayYawDeg: number;
  xStaged: boolean;
  yStaged: boolean;
  zMode: 'world' | 'relative-tabletop-staged' | 'relative-ceiling-staged' | 'staged-default';
  hasStagedAny: boolean;
};

export type VisualSceneLayout = {
  displayCeilingMm: number;
  ceilingIsReal: boolean;
  displayTabletopMm: number | null;
  tabletopIsReal: boolean;
  tabletopIsReferenceOnly: boolean;
  elements: Record<string, VisualElementPlacement>;
  canopies: Record<string, { displayXMm: number; displayYMm: number; displayBottomZMm: number; xStaged: boolean; yStaged: boolean; zStaged: boolean }>;
  boundsCenterThree: [number, number, number];
  boundsRadiusMetres: number;
};

export function computeVisualLayout(resolved: ResolvedComposition): VisualSceneLayout {
  const ceilingIsReal = resolved.site.ceilingFromFloorMm !== undefined;
  const tabletopIsReal = resolved.site.tabletopFromFloorMm !== undefined;
  const needsTabletopReference =
    !tabletopIsReal && resolved.elements.some(el => el.lowest.aboveTabletop.valueMm !== null);

  // Reference height ONLY used visually to position tabletop-relative fixtures when tabletopFromFloorMm is unknown
  const displayTabletopMm = tabletopIsReal
    ? resolved.site.tabletopFromFloorMm!.value
    : needsTabletopReference
      ? 750
      : null;

  const maxNeededCeiling = Math.max(
    3000,
    ...resolved.elements.map(el => {
      if (el.highest.fromFloor.valueMm !== null) return el.highest.fromFloor.valueMm + 500;
      if (el.highest.aboveTabletop.valueMm !== null && displayTabletopMm !== null) {
        return displayTabletopMm + el.highest.aboveTabletop.valueMm + 800;
      }
      return 3000;
    }),
  );
  const displayCeilingMm = ceilingIsReal ? resolved.site.ceilingFromFloorMm!.value : maxNeededCeiling;

  // Stage elements that lack known X/Y along a neat horizontal row so they don't collapse onto (0, 0)
  const stagedElements = resolved.elements.filter(
    el => el.origin.x.valueMm === null || el.origin.y.valueMm === null,
  );
  const gapMm = 320;
  const totalStagedWidth =
    stagedElements.reduce((sum, el) => sum + el.geometry.widthMm, 0) +
    Math.max(0, stagedElements.length - 1) * gapMm;
  let cursorX = -totalStagedWidth / 2;
  const stagedXMap = new Map<string, number>();
  for (const el of stagedElements) {
    stagedXMap.set(el.id, cursorX + el.geometry.widthMm / 2);
    cursorX += el.geometry.widthMm + gapMm;
  }

  const elements: Record<string, VisualElementPlacement> = {};
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = 0;
  let maxZ = displayCeilingMm;

  for (const el of resolved.elements) {
    const xStaged = el.origin.x.valueMm === null;
    const yStaged = el.origin.y.valueMm === null;
    const displayXMm = xStaged ? (stagedXMap.get(el.id) ?? 0) : el.origin.x.valueMm!;
    const displayYMm = yStaged ? 0 : el.origin.y.valueMm!;
    const displayYawDeg = el.yawDeg?.value ?? 0;

    let displayLowestZMm: number;
    let zMode: VisualElementPlacement['zMode'];
    if (el.lowest.fromFloor.valueMm !== null) {
      displayLowestZMm = el.lowest.fromFloor.valueMm;
      zMode = 'world';
    } else if (el.lowest.aboveTabletop.valueMm !== null && displayTabletopMm !== null) {
      displayLowestZMm = displayTabletopMm + el.lowest.aboveTabletop.valueMm;
      zMode = 'relative-tabletop-staged';
    } else if (el.lowest.belowCeiling.valueMm !== null) {
      displayLowestZMm = displayCeilingMm - el.lowest.belowCeiling.valueMm;
      zMode = 'relative-ceiling-staged';
    } else {
      displayLowestZMm = 1600;
      zMode = 'staged-default';
    }

    elements[el.id] = {
      id: el.id,
      displayXMm,
      displayYMm,
      displayLowestZMm,
      displayYawDeg,
      xStaged,
      yStaged,
      zMode,
      hasStagedAny: xStaged || yStaged || zMode !== 'world',
    };

    const halfW = el.geometry.widthMm / 2;
    const halfD = el.geometry.depthMm / 2;
    minX = Math.min(minX, displayXMm - halfW);
    maxX = Math.max(maxX, displayXMm + halfW);
    minY = Math.min(minY, displayYMm - halfD);
    maxY = Math.max(maxY, displayYMm + halfD);
    minZ = Math.min(minZ, displayLowestZMm);
    maxZ = Math.max(maxZ, displayLowestZMm + el.geometry.heightMm);
  }

  const canopies: VisualSceneLayout['canopies'] = {};
  for (const canopy of resolved.canopies) {
    const xStaged = canopy.origin.x.valueMm === null;
    const yStaged = canopy.origin.y.valueMm === null;
    const zStaged = canopy.origin.z.valueMm === null;
    const displayXMm = xStaged ? 0 : canopy.origin.x.valueMm!;
    const displayYMm = yStaged ? 0 : canopy.origin.y.valueMm!;
    const displayBottomZMm = zStaged ? displayCeilingMm - canopy.dropMm.value : canopy.origin.z.valueMm!;
    canopies[canopy.id] = { displayXMm, displayYMm, displayBottomZMm, xStaged, yStaged, zStaged };
    minX = Math.min(minX, displayXMm - 300);
    maxX = Math.max(maxX, displayXMm + 300);
    minY = Math.min(minY, displayYMm - 300);
    maxY = Math.max(maxY, displayYMm + 300);
  }

  if (!Number.isFinite(minX)) {
    minX = -1000;
    maxX = 1000;
    minY = -1000;
    maxY = 1000;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const elementMidZ = Number.isFinite(minZ) && Number.isFinite(maxZ) ? (minZ + maxZ) / 2 : 1600;
  const focusZ = Math.max(1050, Math.min(elementMidZ, displayCeilingMm * 0.5));
  const spanX = Math.max(1800, maxX - minX);
  const spanY = Math.max(1600, maxY - minY);
  const spanZ = Math.max(2200, Math.min(displayCeilingMm, (maxZ - Math.min(minZ, displayTabletopMm ?? 0)) * 1.45));
  const boundsRadiusMetres = Math.hypot(spanX, spanY, spanZ) / 2000;

  return {
    displayCeilingMm,
    ceilingIsReal,
    displayTabletopMm,
    tabletopIsReal,
    tabletopIsReferenceOnly: needsTabletopReference,
    elements,
    canopies,
    boundsCenterThree: toThreeMetres({ x: cx, y: cy, z: focusZ }),
    boundsRadiusMetres,
  };
}

export function formatFormulaTerm(term: {
  offsetMm: number;
  variables: Partial<Record<'ceilingFromFloorMm' | 'tabletopFromFloorMm', number>>;
}): string {
  const parts: string[] = [];
  const ceilingCoef = term.variables.ceilingFromFloorMm ?? 0;
  const tableCoef = term.variables.tabletopFromFloorMm ?? 0;
  if (ceilingCoef !== 0) {
    parts.push(ceilingCoef === 1 ? 'H_потолка' : ceilingCoef === -1 ? '−H_потолка' : `${ceilingCoef}·H_потолка`);
  }
  if (tableCoef !== 0) {
    const label = tableCoef === 1 ? 'H_стола' : tableCoef === -1 ? '−H_стола' : `${tableCoef}·H_стола`;
    parts.push(parts.length > 0 && tableCoef > 0 ? `+ ${label}` : label);
  }
  const offset = Math.round(term.offsetMm * 10) / 10;
  if (offset !== 0 || parts.length === 0) {
    if (parts.length > 0 && offset > 0) parts.push(`+ ${offset}`);
    else if (parts.length > 0 && offset < 0) parts.push(`− ${Math.abs(offset)}`);
    else parts.push(`${offset}`);
  }
  return `${parts.join(' ')} мм`;
}

export function formatSuspensionFormula(
  suspension: ResolvedComposition['suspensions'][number],
): string {
  const segLines = suspension.formula.segments.map((seg, idx) => {
    const dx = 'missing' in seg.x ? `ΔX(${seg.x.missing})` : formatFormulaTerm(seg.x);
    const dy = 'missing' in seg.y ? `ΔY(${seg.y.missing})` : formatFormulaTerm(seg.y);
    const dz = formatFormulaTerm(seg.z);
    return `Отр.${idx + 1}: [ΔX=${dx}; ΔY=${dy}; ΔZ=${dz}]`;
  });
  const allowanceText = suspension.formula.allowanceMm
    ? `+ припуск ${suspension.formula.allowanceMm.value} мм`
    : '+ припуск (не указан)';
  return `${segLines.join(' → ')} ${allowanceText}`;
}

export function translateMissingKey(key: string): string {
  if (key === 'tabletopFromFloorMm') return 'Отметка столешницы от пола (tabletopFromFloorMm)';
  if (key === 'ceilingFromFloorMm') return 'Отметка потолка от пола (ceilingFromFloorMm)';
  if (key === 'allowanceMm') return 'Монтажный припуск подвеса (allowanceMm)';
  if (key === 'attachmentAboveCanopyExit') return 'Точка крепления выше выхода основания (ошибка высоты)';
  if (key.endsWith('.x')) return `Координата X (${key})`;
  if (key.endsWith('.y')) return `Координата Y (${key})`;
  if (key.endsWith('.z')) return `Координата Z (${key})`;
  return key;
}

export function collectMissingInputs(resolved: ResolvedComposition): string[] {
  const items = new Set<string>();
  if (!resolved.site.ceilingFromFloorMm) items.add('Высота потолка от пола (site.ceilingFromFloorMm)');
  if (!resolved.site.tabletopFromFloorMm) {
    const usesTabletop = resolved.elements.some(el => el.lowest.aboveTabletop.valueMm !== null);
    if (usesTabletop) {
      items.add('Высота столешницы от пола (site.tabletopFromFloorMm) — без неё неизвестны отметки от пола и длины подвесов');
    }
  }
  for (const el of resolved.elements) {
    if (el.origin.x.valueMm === null || el.origin.y.valueMm === null) {
      items.add(`${el.name} (${el.id}): координаты X/Y в плане не заданы`);
    }
    if (el.shape.type === 'envelope') {
      items.add(`${el.name} (${el.id}): задана только габаритная оболочка (envelope), детальный профиль не подтверждён`);
    }
    for (const att of el.attachments) {
      if (att.world.x.valueMm === null || att.world.y.valueMm === null || att.world.z.valueMm === null) {
        items.add(`${el.name} · точка «${att.label}»: мировые координаты не определены (проверьте X/Y, yawDeg и отметку)`);
      }
    }
  }
  if (resolved.canopies.length === 0) {
    items.add('Потолочные основания (canopies) не заданы');
  }
  if (resolved.suspensions.length === 0) {
    items.add('Подвесы / тросы / ремни (suspensions) не заданы — окончательные длины не рассчитываются');
  }
  for (const s of resolved.suspensions) {
    if (s.cutLength.quality === 'unknown') {
      for (const m of s.cutLength.missing) {
        items.add(`Подвес ${s.id}: ${translateMissingKey(m)}`);
      }
    }
  }
  return [...items];
}

export type ElementPairDistance = {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  centerDistanceMm: number | null;
  deltaZLowestMm: number | null;
};

/** Computes distances ONLY from real resolved coordinates — returns null when XY or Z is unknown. */
export function computeElementDistances(resolved: ResolvedComposition): ElementPairDistance[] {
  const pairs: ElementPairDistance[] = [];
  for (let i = 0; i < resolved.elements.length; i++) {
    for (let j = i + 1; j < resolved.elements.length; j++) {
      const a = resolved.elements[i];
      const b = resolved.elements[j];
      const centerDistanceMm =
        a.origin.x.valueMm !== null &&
        a.origin.y.valueMm !== null &&
        b.origin.x.valueMm !== null &&
        b.origin.y.valueMm !== null
          ? Math.round(Math.hypot(b.origin.x.valueMm - a.origin.x.valueMm, b.origin.y.valueMm - a.origin.y.valueMm) * 10) / 10
          : null;
      const zA = a.lowest.fromFloor.valueMm ?? a.lowest.aboveTabletop.valueMm;
      const zB = b.lowest.fromFloor.valueMm ?? b.lowest.aboveTabletop.valueMm;
      const sameBasis =
        (a.lowest.fromFloor.valueMm !== null && b.lowest.fromFloor.valueMm !== null) ||
        (a.lowest.aboveTabletop.valueMm !== null && b.lowest.aboveTabletop.valueMm !== null);
      const deltaZLowestMm = sameBasis && zA !== null && zB !== null ? Math.round(Math.abs(zB - zA) * 10) / 10 : null;
      pairs.push({
        fromId: a.id,
        fromName: a.name,
        toId: b.id,
        toName: b.name,
        centerDistanceMm,
        deltaZLowestMm,
      });
    }
  }
  return pairs;
}

const axisVal = (value: number, source: Axis['source'] = 'user'): Axis => ({ value, source });
const makePoint = (x: number, y: number, z: number): Point => ({
  x: axisVal(x),
  y: axisVal(y),
  z: axisVal(z),
});

export function createDefaultShape(type: Shape['type']): Shape {
  if (type === 'ring') {
    return {
      type: 'ring',
      outerDiameterMm: axisVal(800),
      innerDiameterMm: axisVal(740),
      profileHeightMm: axisVal(45),
    };
  }
  if (type === 'arc') {
    return {
      type: 'arc',
      chordMm: axisVal(700),
      riseMm: axisVal(180),
      radialThicknessMm: axisVal(30),
      depthMm: axisVal(55),
    };
  }
  if (type === 'linear') {
    return {
      type: 'linear',
      lengthMm: axisVal(1200),
      widthMm: axisVal(50),
      heightMm: axisVal(65),
    };
  }
  return {
    type: 'envelope',
    intendedShape: 'arc',
    widthMm: axisVal(800),
    depthMm: axisVal(60),
    heightMm: axisVal(600),
  };
}

export function addElementToComposition(
  composition: Composition,
  shapeType: Shape['type'],
): { composition: Composition; elementId: string } {
  const index = composition.elements.length + 1;
  const id = `${shapeType}-${crypto.randomUUID().slice(0, 6)}`;
  const datum: Element['position']['lowest']['datum'] =
    composition.site.tabletopFromFloorMm !== undefined
      ? 'tabletop'
      : composition.site.ceilingFromFloorMm !== undefined
        ? 'ceiling'
        : 'floor';
  const offsetMm = datum === 'ceiling' ? -1200 : datum === 'tabletop' ? 1000 : 1800;

  const element: Element = {
    id,
    name: `${shapeLabels[shapeType]} ${index}`,
    shape: createDefaultShape(shapeType),
    position: {
      xy: { x: axisVal((index - 1) * 450), y: axisVal(0) },
      lowest: { datum, offsetMm: axisVal(offsetMm) },
      yawDeg: axisVal(0),
    },
    attachments: [{ id: 'att-1', label: 'Крепление 1', point: makePoint(0, 0, 45) }],
  };
  return {
    composition: { ...composition, elements: [...composition.elements, element] },
    elementId: id,
  };
}

export function removeElementFromComposition(composition: Composition, elementId: string): Composition {
  if (composition.elements.length <= 1) return composition;
  return {
    ...composition,
    elements: composition.elements.filter(el => el.id !== elementId),
    suspensions: composition.suspensions.filter(s => s.to.elementId !== elementId),
  };
}

export function addCanopyToComposition(
  composition: Composition,
  footprintType: Canopy['footprint']['type'],
): { composition: Composition; canopyId: string } {
  const index = composition.canopies.length + 1;
  const id = `canopy-${crypto.randomUUID().slice(0, 6)}`;
  const drop = 60;
  const canopy: Canopy = {
    id,
    name: footprintType === 'round' ? `Круглое основание ${index}` : `Линейное основание ${index}`,
    footprint:
      footprintType === 'round'
        ? { type: 'round', diameterMm: axisVal(240) }
        : { type: 'rectangular', widthMm: axisVal(600), depthMm: axisVal(120) },
    dropMm: axisVal(drop),
    position: { x: axisVal(0), y: axisVal(0) },
    yawDeg: axisVal(0),
    ceilingFixings: [{ id: 'fix-1', label: 'Крепление к потолку', point: makePoint(0, 0, drop) }],
    exits: [{ id: 'exit-1', label: 'Выход 1', point: makePoint(0, 0, 0) }],
  };
  return {
    composition: { ...composition, canopies: [...composition.canopies, canopy] },
    canopyId: id,
  };
}

export function removeCanopyFromComposition(composition: Composition, canopyId: string): Composition {
  return {
    ...composition,
    canopies: composition.canopies.filter(c => c.id !== canopyId),
    suspensions: composition.suspensions.filter(s => s.from.canopyId !== canopyId),
  };
}

export function removeElementAttachmentFromComposition(
  composition: Composition,
  elementId: string,
  attachmentId: string,
): { composition: Composition; removedSuspensions: number } {
  const remainingSuspensions = composition.suspensions.filter(
    s => !(s.to.elementId === elementId && s.to.attachmentId === attachmentId),
  );
  const removedSuspensions = composition.suspensions.length - remainingSuspensions.length;
  return {
    composition: {
      ...composition,
      elements: composition.elements.map(el =>
        el.id === elementId
          ? { ...el, attachments: el.attachments.filter(att => att.id !== attachmentId) }
          : el,
      ),
      suspensions: remainingSuspensions,
    },
    removedSuspensions,
  };
}

export function removeCanopyExitFromComposition(
  composition: Composition,
  canopyId: string,
  exitId: string,
): { composition: Composition; removedSuspensions: number } {
  const remainingSuspensions = composition.suspensions.filter(
    s => !(s.from.canopyId === canopyId && s.from.exitId === exitId),
  );
  const removedSuspensions = composition.suspensions.length - remainingSuspensions.length;
  return {
    composition: {
      ...composition,
      canopies: composition.canopies.map(c =>
        c.id === canopyId
          ? { ...c, exits: c.exits.filter(ex => ex.id !== exitId) }
          : c,
      ),
      suspensions: remainingSuspensions,
    },
    removedSuspensions,
  };
}

export function switchCanopyFootprint(
  canopy: Canopy,
  nextType: Canopy['footprint']['type'],
): Canopy {
  if (canopy.footprint.type === nextType) return canopy;
  if (nextType === 'rectangular' && canopy.footprint.type === 'round') {
    const d = canopy.footprint.diameterMm;
    return {
      ...canopy,
      footprint: {
        type: 'rectangular',
        widthMm: { ...d },
        depthMm: { ...d },
      },
    };
  }
  if (nextType === 'round' && canopy.footprint.type === 'rectangular') {
    const candidates: Array<{ value: number; sources: Axis['source'][] }> = [
      { value: canopy.footprint.widthMm.value, sources: [canopy.footprint.widthMm.source] },
      { value: canopy.footprint.depthMm.value, sources: [canopy.footprint.depthMm.source] },
    ];
    for (const anchor of [...canopy.exits, ...canopy.ceilingFixings]) {
      const radius = Math.hypot(anchor.point.x.value, anchor.point.y.value);
      if (radius > 0) {
        candidates.push({
          value: Math.ceil(radius * 2),
          sources: [anchor.point.x.source, anchor.point.y.source],
        });
      }
    }
    const base = candidates.reduce((max, item) => Math.max(max, item.value), 0);
    const determiningSources = candidates
      .filter(item => item.value === base)
      .flatMap(item => item.sources);
    const source: Axis['source'] = determiningSources.includes('estimated')
      ? 'estimated'
      : determiningSources.includes('user')
        ? 'user'
        : 'documentation';
    return {
      ...canopy,
      footprint: {
        type: 'round',
        diameterMm: { value: base, source },
      },
    };
  }
  return canopy;
}

export function removeSuspensionGuidePoint(
  suspension: Composition['suspensions'][number],
  guideIndex: number,
): Composition['suspensions'][number] {
  if (suspension.routing.type !== 'guided') return suspension;
  const remaining = suspension.routing.guides.filter((_, idx) => idx !== guideIndex);
  return {
    ...suspension,
    routing: remaining.length > 0 ? { type: 'guided', guides: remaining } : { type: 'straight' },
  };
}

export function cloneCompositionWithNewId(composition: Composition, nextName?: string): Composition {
  const base = composition.id.replace(/-[a-f0-9]{6}$/, '').slice(0, 56) || 'composition';
  const id = `${base}-${crypto.randomUUID().slice(0, 6)}`;
  return {
    ...composition,
    id,
    name: nextName ?? composition.name,
  };
}

export function addSuspensionToComposition(
  composition: Composition,
  type: Composition['suspensions'][number]['type'],
): { composition: Composition; suspensionId: string | null } {
  const canopy = composition.canopies.find(c => c.exits.length > 0);
  const element = composition.elements.find(el => el.attachments.length > 0);
  if (!canopy || !element) return { composition, suspensionId: null };
  const id = `${type === 'loadBearingCable' ? 'cable' : 'strap'}-${crypto.randomUUID().slice(0, 6)}`;
  const suspension: Composition['suspensions'][number] = {
    id,
    type,
    from: { canopyId: canopy.id, exitId: canopy.exits[0].id },
    to: { elementId: element.id, attachmentId: element.attachments[0].id },
    routing: { type: 'straight' },
  };
  return {
    composition: { ...composition, suspensions: [...composition.suspensions, suspension] },
    suspensionId: id,
  };
}

export function safeResolveLocal(composition: Composition): {
  resolved: ResolvedComposition | null;
  issues: GeometryFieldIssue[];
} {
  const parsed = compositionSchema.safeParse(composition);
  if (!parsed.success) {
    return {
      resolved: null,
      issues: parsed.error.issues.map(issue => ({
        path: issue.path.filter((seg): seg is string | number => typeof seg === 'string' || typeof seg === 'number'),
        message: translateGeometryIssue(issue.message),
      })),
    };
  }
  return { resolved: resolveComposition(parsed.data), issues: [] };
}

export function translateGeometryIssue(message: string): string {
  const map: Record<string, string> = {
    'IDs must be unique': 'Идентификаторы должны быть уникальными.',
    'Tabletop must be below the ceiling': 'Столешница должна располагаться ниже потолка.',
    'An offset below the ceiling is negative': 'Отступ ниже потолка задаётся отрицательным числом (≤ 0).',
    'The body must be above the floor': 'Отметка корпуса от пола не может быть ниже 0.',
    'Inner diameter must be less than outer diameter': 'Внутренний диаметр должен быть меньше внешнего.',
    'Circular arc rise must be at most half the chord': 'Стрела дуги не может превышать половину хорды (дуга ≤ 180°).',
    'Radial thickness must be less than the centerline diameter': 'Радиальная толщина должна быть меньше диаметра средней линии.',
    'Canopy extends below the floor': 'Высота потолочного основания превышает высоту потолка.',
    'Anchor must be within the canopy envelope': 'Точка выхода/крепления должна лежать внутри габарита основания.',
    'Ceiling fixing must lie on the upper canopy face': 'Точка крепления к потолку должна иметь Z = высоте основания (dropMm).',
    'Unknown canopy exit': 'Указан несуществующий выход потолочного основания.',
    'Unknown element attachment': 'Указана несуществующая точка крепления элемента.',
  };
  if (map[message]) return map[message];
  if (/Too small: expected string to have >=1|String must contain at least 1/.test(message)) {
    return 'Поле не может быть пустым.';
  }
  if (/Too big: expected string/.test(message)) {
    return 'Превышена максимальная длина текста.';
  }
  if (/Too small: expected number/.test(message)) {
    return 'Значение меньше допустимого минимума.';
  }
  if (/Too big: expected number/.test(message)) {
    return 'Значение превышает допустимый максимум.';
  }
  return message;
}

export function formatGeometryIssuePath(path: (string | number)[]): string {
  if (!path.length) return 'Композиция';
  const [root, idx, field, sub] = path;
  if (root === 'name') return 'Название композиции';
  if (root === 'id') return 'Идентификатор композиции';
  if (root === 'site') return idx === 'tabletopFromFloorMm' ? 'Уровни → Столешница' : 'Уровни → Потолок';
  if (root === 'elements') {
    if (field === 'name') return `Элемент #${Number(idx) + 1} → Название`;
    return `Элемент #${Number(idx) + 1}${field ? ` → ${String(field)}` : ''}${sub ? `.${String(sub)}` : ''}`;
  }
  if (root === 'canopies') {
    if (field === 'name') return `Основание #${Number(idx) + 1} → Название`;
    return `Основание #${Number(idx) + 1}${field ? ` → ${String(field)}` : ''}`;
  }
  if (root === 'suspensions') return `Подвес #${Number(idx) + 1}${field ? ` → ${String(field)}` : ''}`;
  return path.join(' → ');
}

export async function resolveCompositionViaApi(
  composition: Composition,
  signal?: AbortSignal,
): Promise<{ ok: true; data: ResolvedComposition } | { ok: false; status: number; error: string; issues: GeometryFieldIssue[] }> {
  const response = await fetch('/api/geometry/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(composition),
    signal,
  });
  const body = await response.json();
  if (response.ok) {
    return { ok: true, data: resolvedCompositionSchema.parse(body) };
  }
  const issues: GeometryFieldIssue[] = Array.isArray(body?.issues)
    ? body.issues.map((item: { path?: (string | number)[]; message?: string }) => ({
        path: Array.isArray(item.path) ? item.path : [],
        message: translateGeometryIssue(String(item.message ?? 'Ошибка схемы')),
      }))
    : [];
  return {
    ok: false,
    status: response.status,
    error: typeof body?.error === 'string' ? body.error : `http_${response.status}`,
    issues,
  };
}

export type OutlineQuality = 'specified' | 'estimated' | 'unknown' | 'envelope' | 'invalid';

export type CompositionOutline = {
  site: {
    ceilingMm?: number;
    tabletopMm?: number;
    missingCount: number;
  };
  elements: {
    id: string;
    name: string;
    shapeLabel: string;
    dimsSummary: string;
    elevationSummary: string;
    quality: OutlineQuality;
  }[];
  canopies: {
    id: string;
    name: string;
    footprintSummary: string;
    exitCount: number;
  }[];
  suspensions: {
    id: string;
    typeLabel: string;
    pathSummary: string;
    cutSummary: string;
    quality: OutlineQuality;
  }[];
};

const outlineShapeLabels: Record<Shape['type'], string> = {
  arc: 'Дуга',
  ring: 'Кольцо',
  linear: 'Линейный',
  envelope: 'Габарит',
};

export function buildCompositionOutline(
  composition: Composition,
  resolved: ResolvedComposition | null,
): CompositionOutline {
  const missingInputs = resolved ? collectMissingInputs(resolved) : [];
  const elements = composition.elements.map(el => {
    const resEl = resolved?.elements.find(item => item.id === el.id);
    const dimsSummary = resEl
      ? `${Math.round(resEl.geometry.widthMm)}×${Math.round(resEl.geometry.depthMm)}×${Math.round(resEl.geometry.heightMm)} мм`
      : '—';

    let elevationSummary = 'Уровень не задан';
    if (el.position.lowest.datum === 'tabletop') {
      elevationSummary = `+${Math.round(el.position.lowest.offsetMm.value)} мм над столом`;
    } else if (el.position.lowest.datum === 'floor') {
      elevationSummary = `${Math.round(el.position.lowest.offsetMm.value)} мм от пола`;
    } else {
      elevationSummary = `${Math.round(el.position.lowest.offsetMm.value)} мм от потолка`;
    }

    let quality: OutlineQuality = 'specified';
    if (el.shape.type === 'envelope') {
      quality = 'envelope';
    } else if (!resEl || resEl.origin.z.valueMm === null || resEl.origin.x.valueMm === null) {
      quality = 'unknown';
    } else if (
      resEl.origin.z.quality === 'estimated' ||
      resEl.origin.x.quality === 'estimated'
    ) {
      quality = 'estimated';
    }

    return {
      id: el.id,
      name: el.name || el.id,
      shapeLabel: outlineShapeLabels[el.shape.type],
      dimsSummary,
      elevationSummary,
      quality,
    };
  });

  const canopies = composition.canopies.map(canopy => ({
    id: canopy.id,
    name: canopy.name || canopy.id,
    footprintSummary:
      canopy.footprint.type === 'round'
        ? `Ø${Math.round(canopy.footprint.diameterMm.value)} × H${Math.round(canopy.dropMm.value)} мм`
        : `${Math.round(canopy.footprint.widthMm.value)}×${Math.round(canopy.footprint.depthMm.value)} × H${Math.round(canopy.dropMm.value)} мм`,
    exitCount: canopy.exits.length,
  }));

  const suspensions = composition.suspensions.map(susp => {
    const resSusp = resolved?.suspensions.find(item => item.id === susp.id);
    const typeLabel = susp.type === 'loadBearingCable' ? 'Трос (несущий)' : 'Ремень (декор)';
    if (resSusp?.status === 'invalid') {
      return {
        id: susp.id,
        typeLabel,
        pathSummary: 'Некорректные уровни',
        cutSummary: 'Проверить отметки',
        quality: 'invalid' as const,
      };
    }
    const pathMm = resSusp?.pathLength.valueMm;
    const cutMm = resSusp?.cutLength.valueMm;
    const pathSummary = pathMm != null ? `Путь: ${Math.round(pathMm)} мм` : 'Путь: неизвестно';
    const cutSummary = cutMm != null ? `Заготовка: ${Math.round(cutMm)} мм` : 'Припуск не задан';
    let quality: OutlineQuality = 'unknown';
    if (pathMm != null && cutMm != null) {
      quality =
        resSusp?.cutLength.quality === 'estimated' || resSusp?.pathLength.quality === 'estimated'
          ? 'estimated'
          : 'specified';
    } else if (pathMm != null) {
      quality = resSusp?.pathLength.quality === 'estimated' ? 'estimated' : 'unknown';
    }

    return {
      id: susp.id,
      typeLabel,
      pathSummary,
      cutSummary,
      quality,
    };
  });

  return {
    site: {
      ceilingMm: composition.site.ceilingFromFloorMm?.value,
      tabletopMm: composition.site.tabletopFromFloorMm?.value,
      missingCount: missingInputs.length,
    },
    elements,
    canopies,
    suspensions,
  };
}

export function linkCompositionToProject(
  composition: Composition,
  projectId: string | undefined,
): Composition {
  const clean = projectId?.trim() || undefined;
  if (clean) {
    return { ...composition, projectId: clean };
  }
  const { projectId: _removed, ...rest } = composition;
  return rest;
}

