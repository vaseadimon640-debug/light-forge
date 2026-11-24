import {
  newComponent,
  productTypes,
  type Component,
  type Measurement,
  type Placement,
  type Project,
} from '../../domain/project.ts';
import { resolveComposition } from '../../geometry/resolve.ts';
import type { ResolvedComposition } from '../../geometry/result.ts';
import {
  compositionSchema,
  type Axis,
  type Composition,
  type Shape,
} from '../../geometry/schema.ts';
import {
  analyzeProjectReadiness,
  type DocumentReadiness,
  type OpenConfirmationCategory,
  type OpenConfirmationItem,
} from '../../rfq/detailed.ts';
import {
  issuesMatching,
  validateProject,
  type FieldIssue,
} from '../quick-rfq/helpers.ts';
import type { WizardStepId } from './wizardState.ts';

export const INSTALLATION_NOTE_PRESETS = [
  'Потолочное основание (canopy) в цвет и отделку корпуса светильника.',
  'Предусмотреть запас длины подвесов +500 мм для регулировки на объекте.',
  'Подтвердить массу изделия, тип закладной и расчётную нагрузку на потолок.',
  'Усиленная индивидуальная обрешётка (export wooden crate) для авиадоставки.',
  'Согласовать схему вывода кабеля и расположение драйвера перед запуском в производство.',
] as const;

export function appendNotePreset(currentNotes: string, preset: string): string {
  const trimmed = currentNotes.trim();
  if (trimmed.includes(preset)) return currentNotes;
  const combined = trimmed ? `${trimmed}\n${preset}` : preset;
  return combined.slice(0, 1000);
}

export type PlacementAnalysis = {
  placementId: string;
  componentId: string;
  componentName: string;
  lowestAboveTabletopMm?: Measurement;
  bottomFromFloorMm?: number;
  attachmentFromFloorMm?: number;
  suspensionVerticalMm?: number;
  quality: 'specified' | 'estimated' | 'unknown';
  missing: string[];
  conflict?: string;
};

export type MountingSummary = {
  totalComponentUnits: number;
  placedUnits: number;
  unplacedUnits: number;
  hasExcessPlacements: boolean;
  missingCeiling: boolean;
  missingTabletop: boolean;
  conflictCount: number;
  placements: PlacementAnalysis[];
};

function componentBodyHeight(component?: Component): Measurement | undefined {
  if (!component) return undefined;
  return component.dimensions.height ?? component.dimensions.profileHeight;
}

export function analyzeMountingPlacement(
  project: Project,
  placement: Placement,
): PlacementAnalysis {
  const component = project.components.find((item) => item.id === placement.componentId);
  const componentName = component?.name ?? 'Неизвестный компонент';
  const ceiling = project.mounting.ceilingFromFloorMm;
  const tabletop = project.mounting.tabletopFromFloorMm;
  const lowestAbove = placement.lowestAboveTabletopMm;
  const missing: string[] = [];

  if (!tabletop) missing.push('Высота столешницы');
  if (!lowestAbove) missing.push('Отметка нижней точки над столом');
  if (!ceiling) missing.push('Высота потолка');

  const bottomFromFloorMm =
    tabletop && lowestAbove ? tabletop.value + lowestAbove.value : undefined;

  const bodyHeight = componentBodyHeight(component);
  const attachOffset = placement.attachmentAboveLowestMm ?? bodyHeight;
  const attachIsFallback = !placement.attachmentAboveLowestMm && Boolean(bodyHeight);

  const attachmentFromFloorMm =
    bottomFromFloorMm !== undefined && attachOffset !== undefined
      ? bottomFromFloorMm + attachOffset.value
      : undefined;

  const canopyDrop = placement.canopyDropMm?.value ?? 0;
  const suspensionVerticalMm =
    ceiling !== undefined && attachmentFromFloorMm !== undefined
      ? ceiling.value - canopyDrop - attachmentFromFloorMm
      : undefined;

  let conflict: string | undefined;
  if (ceiling && tabletop && tabletop.value >= ceiling.value) {
    conflict = 'Высота столешницы не может быть выше или равна высоте потолка.';
  } else if (ceiling && bottomFromFloorMm !== undefined && bottomFromFloorMm >= ceiling.value) {
    conflict = `Нижняя точка (${bottomFromFloorMm} мм) достигает или превышает уровень потолка (${ceiling.value} мм).`;
  } else if (suspensionVerticalMm !== undefined && suspensionVerticalMm < 0) {
    conflict = `Точка крепления выше нижней грани потолочного основания на ${Math.abs(Math.round(suspensionVerticalMm))} мм — проверьте высоты.`;
  }

  let quality: PlacementAnalysis['quality'] = 'unknown';
  if (suspensionVerticalMm !== undefined) {
    const anyEstimated =
      attachIsFallback ||
      ceiling?.source === 'estimated' ||
      tabletop?.source === 'estimated' ||
      lowestAbove?.source === 'estimated' ||
      placement.canopyDropMm?.source === 'estimated' ||
      attachOffset?.source === 'estimated';
    quality = anyEstimated ? 'estimated' : 'specified';
  } else if (bottomFromFloorMm !== undefined) {
    const anyEstimated =
      tabletop?.source === 'estimated' || lowestAbove?.source === 'estimated';
    quality = anyEstimated ? 'estimated' : 'specified';
  }

  return {
    placementId: placement.id,
    componentId: placement.componentId,
    componentName,
    lowestAboveTabletopMm: lowestAbove,
    bottomFromFloorMm,
    attachmentFromFloorMm,
    suspensionVerticalMm,
    quality,
    missing,
    conflict,
  };
}

export function analyzeProjectMounting(project: Project): MountingSummary {
  const totalComponentUnits = project.components.reduce((sum, c) => sum + c.quantity, 0);
  const countsByComp = new Map<string, number>();
  let hasExcessPlacements = false;

  for (const placement of project.mounting.placements) {
    const comp = project.components.find((item) => item.id === placement.componentId);
    const nextCount = (countsByComp.get(placement.componentId) ?? 0) + 1;
    countsByComp.set(placement.componentId, nextCount);
    if (!comp || nextCount > comp.quantity) {
      hasExcessPlacements = true;
    }
  }

  const placements = project.mounting.placements.map((placement) =>
    analyzeMountingPlacement(project, placement),
  );
  const conflictCount = placements.filter((item) => Boolean(item.conflict)).length;
  const placedUnits = project.mounting.placements.length;

  return {
    totalComponentUnits,
    placedUnits,
    unplacedUnits: Math.max(0, totalComponentUnits - placedUnits),
    hasExcessPlacements,
    missingCeiling: !project.mounting.ceilingFromFloorMm,
    missingTabletop: !project.mounting.tabletopFromFloorMm,
    conflictCount,
    placements,
  };
}

/**
 * Populates one placement entry per unplaced component unit (up to 24 total)
 * without overwriting or modifying any existing user-entered placements.
 */
export function populateMissingPlacements(project: Project): Project {
  const counts = new Map<string, number>();
  for (const p of project.mounting.placements) {
    counts.set(p.componentId, (counts.get(p.componentId) ?? 0) + 1);
  }

  const nextPlacements = [...project.mounting.placements];
  for (const comp of project.components) {
    let used = counts.get(comp.id) ?? 0;
    while (used < comp.quantity && nextPlacements.length < 24) {
      nextPlacements.push({
        id: crypto.randomUUID(),
        componentId: comp.id,
      });
      used += 1;
    }
  }

  return {
    ...project,
    mounting: {
      ...project.mounting,
      placements: nextPlacements,
    },
  };
}

export type PreviewCompositionResult = {
  composition: Composition;
  resolved: ResolvedComposition;
  isEstimatedPreview: boolean;
  notes: string[];
};

const safeAxis = (value: number, source: Axis['source']): Axis => ({
  value: Math.round(value * 10) / 10,
  source,
});

const safeSize = (value: number, source: Axis['source']) => ({
  value: Math.max(10, Math.round(value * 10) / 10),
  source,
});

function buildShapeForComponent(
  component: Component,
  notes: Set<string>,
): { shape: Shape; widthMm: number; depthMm: number; heightMm: number; estimated: boolean } {
  const dims = component.dimensions;

  if (component.kind === 'ring') {
    const outer = dims.outerDiameter ?? dims.width;
    const inner = dims.innerDiameter;
    const profH = dims.profileHeight ?? dims.height;
    const outerVal = outer?.value && outer.value >= 60 ? outer.value : 800;
    const innerVal =
      inner?.value && inner.value > 0 && inner.value < outerVal - 10
        ? inner.value
        : Math.max(20, outerVal - 80);
    const heightVal = profH?.value && profH.value >= 10 ? profH.value : 50;
    const est = !outer || !inner || !profH;
    if (est) notes.add('Часть габаритов кольца взята ориентировочно для 3D-предпросмотра.');
    return {
      shape: {
        type: 'ring',
        outerDiameterMm: safeSize(outerVal, outer ? outer.source : 'estimated'),
        innerDiameterMm: safeSize(innerVal, inner ? inner.source : 'estimated'),
        profileHeightMm: safeSize(heightVal, profH ? profH.source : 'estimated'),
      },
      widthMm: outerVal,
      depthMm: outerVal,
      heightMm: heightVal,
      estimated: est,
    };
  }

  if (component.kind === 'linear') {
    const len = dims.length ?? dims.width;
    const wid = dims.width && dims.length ? dims.width : dims.depth;
    const h = dims.height ?? dims.profileHeight;
    const lengthVal = len?.value && len.value >= 50 ? len.value : 1200;
    const widthVal = wid?.value && wid.value >= 15 ? wid.value : 60;
    const heightVal = h?.value && h.value >= 15 ? h.value : 70;
    const est = !len || !wid || !h;
    if (est) notes.add('Часть габаритов линейного профиля показана оценочно.');
    return {
      shape: {
        type: 'linear',
        lengthMm: safeSize(lengthVal, len ? len.source : 'estimated'),
        widthMm: safeSize(widthVal, wid ? wid.source : 'estimated'),
        heightMm: safeSize(heightVal, h ? h.source : 'estimated'),
      },
      widthMm: lengthVal,
      depthMm: widthVal,
      heightMm: heightVal,
      estimated: est,
    };
  }

  if (component.kind === 'arc') {
    const chord = dims.width ?? dims.length;
    const rise = dims.height;
    const depth = dims.depth ?? dims.profileThickness;
    const chordVal = chord?.value && chord.value >= 120 ? chord.value : 900;
    const maxRise = chordVal / 2;
    if (rise && rise.value > 20 && rise.value <= maxRise) {
      const depthVal = depth?.value && depth.value >= 15 ? depth.value : 60;
      const halfChord = chordVal / 2;
      const radius = (halfChord ** 2 + rise.value ** 2) / (2 * rise.value);
      const radialVal = Math.min(Math.max(20, depthVal), Math.max(20, radius * 1.4));
      const est = !chord || !depth;
      if (est) notes.add('Толщина сечения дуги показана оценочно.');
      return {
        shape: {
          type: 'arc',
          chordMm: safeSize(chordVal, chord ? chord.source : 'estimated'),
          riseMm: safeSize(rise.value, rise.source),
          radialThicknessMm: safeSize(radialVal, 'estimated'),
          depthMm: safeSize(depthVal, depth ? depth.source : 'estimated'),
        },
        widthMm: chordVal,
        depthMm: depthVal,
        heightMm: rise.value + radialVal,
        estimated: est || true,
      };
    }
  }

  // Honest parametric bounding envelope for chandeliers, pendants, arcs with H > W/2 (e.g., MYLINE U-arc), sconces, etc.
  const w = dims.width ?? dims.outerDiameter ?? dims.length;
  const d = dims.depth ?? dims.outerDiameter ?? dims.profileThickness;
  const h = dims.height ?? dims.profileHeight;
  const widthVal = w?.value && w.value >= 40 ? w.value : 600;
  const depthVal = d?.value && d.value >= 30 ? d.value : Math.min(widthVal, 260);
  const heightVal = h?.value && h.value >= 30 ? h.value : 450;
  const est = !w || !d || !h;
  if (est) {
    notes.add('Недостающие габариты показаны условным габаритным контуром (оценка).');
  }
  const intendedShape = component.kind === 'arc' ? 'arc' : 'custom';

  return {
    shape: {
      type: 'envelope',
      intendedShape,
      widthMm: safeSize(widthVal, w ? w.source : 'estimated'),
      depthMm: safeSize(depthVal, d ? d.source : 'estimated'),
      heightMm: safeSize(heightVal, h ? h.source : 'estimated'),
    },
    widthMm: widthVal,
    depthMm: depthVal,
    heightMm: heightVal,
    estimated: est,
  };
}

/**
 * Builds a schema-valid, strictly honest 3D Composition preview from a canonical Project.
 * Never fabricates unknown room levels (e.g., tabletopFromFloorMm stays undefined when unknown).
 */
export function buildPreviewCompositionFromProject(project: Project): PreviewCompositionResult {
  const notes = new Set<string>();
  let isEstimatedPreview = false;

  const ceiling = project.mounting.ceilingFromFloorMm;
  const tabletop = project.mounting.tabletopFromFloorMm;

  const site: Composition['site'] = {};
  if (ceiling && ceiling.value > 0) {
    site.ceilingFromFloorMm = safeSize(ceiling.value, ceiling.source);
  } else {
    notes.add('Высота потолка не задана — 3D-сцена показывает габариты без привязки к потолку.');
    isEstimatedPreview = true;
  }

  if (tabletop && (!ceiling || tabletop.value < ceiling.value)) {
    site.tabletopFromFloorMm = { value: tabletop.value, source: tabletop.source };
  } else if (project.mounting.placements.some((p) => Boolean(p.lowestAboveTabletopMm))) {
    notes.add('Отметка столешницы не задана — длины подвесов и мировые высоты не фиксируются.');
  }

  // Build list of instances from placements if available, otherwise from components
  type InstanceSpec = {
    id: string;
    name: string;
    component: Component;
    placement?: Placement;
  };

  const instances: InstanceSpec[] = [];
  if (project.mounting.placements.length > 0) {
    project.mounting.placements.slice(0, 24).forEach((placement, idx) => {
      const comp =
        project.components.find((c) => c.id === placement.componentId) ??
        project.components[0] ??
        newComponent(project.kind);
      instances.push({
        id: `el-${idx + 1}`,
        name: `${comp.name} #${idx + 1}`.slice(0, 120),
        component: comp,
        placement,
      });
    });
  } else {
    let idx = 0;
    for (const comp of project.components) {
      const count = Math.min(comp.quantity, Math.max(1, 24 - idx));
      for (let i = 0; i < count && idx < 24; i += 1) {
        idx += 1;
        instances.push({
          id: `el-${idx}`,
          name: comp.quantity > 1 ? `${comp.name} #${i + 1}`.slice(0, 120) : comp.name,
          component: comp,
        });
      }
    }
  }

  const elements: Composition['elements'] = [];
  const exits: Composition['canopies'][number]['exits'] = [];
  const suspensions: Composition['suspensions'] = [];

  const totalCount = instances.length;
  const maxWidth = Math.max(
    ...instances.map((inst) => inst.component.dimensions.width?.value ?? inst.component.dimensions.outerDiameter?.value ?? 600),
  );
  const spreadStep = Math.max(240, Math.min(600, Math.round(maxWidth * 0.55)));

  const hasLeather = project.components.some((c) =>
    c.materials.some((m) => m.material === 'genuineLeather' || m.material === 'artificialLeather'),
  );
  const suspensionType = hasLeather ? 'decorativeStrap' : 'loadBearingCable';

  let maxAbsExitX = 120;
  let maxAbsExitY = 80;

  instances.forEach((inst, index) => {
    const built = buildShapeForComponent(inst.component, notes);
    if (built.estimated) isEstimatedPreview = true;

    const p = inst.placement;
    const defaultX = totalCount === 1 ? 0 : Math.round((index - (totalCount - 1) / 2) * spreadStep);
    const xAxis: Axis =
      p?.xMm !== undefined ? safeAxis(p.xMm, 'user') : safeAxis(defaultX, 'estimated');
    const yAxis: Axis =
      p?.yMm !== undefined ? safeAxis(p.yMm, 'user') : safeAxis(0, 'estimated');
    if (p?.xMm === undefined || p?.yMm === undefined) {
      isEstimatedPreview = true;
    }

    let lowest: Composition['elements'][number]['position']['lowest'];
    if (p?.lowestAboveTabletopMm) {
      lowest = {
        datum: 'tabletop',
        offsetMm: safeAxis(p.lowestAboveTabletopMm.value, p.lowestAboveTabletopMm.source),
      };
    } else if (site.ceilingFromFloorMm) {
      const estDrop = Math.min(
        Math.max(built.heightMm + 400, 1200),
        Math.max(built.heightMm + 100, site.ceilingFromFloorMm.value - 900),
      );
      lowest = {
        datum: 'ceiling',
        offsetMm: safeAxis(-Math.min(estDrop, site.ceilingFromFloorMm.value - 50), 'estimated'),
      };
      isEstimatedPreview = true;
    } else {
      lowest = {
        datum: 'floor',
        offsetMm: safeAxis(1600, 'estimated'),
      };
      isEstimatedPreview = true;
    }

    const attachZ = p?.attachmentAboveLowestMm?.value ?? built.heightMm;
    const attachZSource = p?.attachmentAboveLowestMm?.source ?? 'estimated';
    const attachId = `att-${index + 1}`;
    const exitId = `exit-${index + 1}`;

    elements.push({
      id: inst.id,
      name: inst.name,
      productComponentId: inst.component.id,
      shape: built.shape,
      position: {
        xy: { x: xAxis, y: yAxis },
        lowest,
        yawDeg: { value: 0, source: 'estimated' },
      },
      attachments: [
        {
          id: attachId,
          label: 'Точка подвеса',
          point: {
            x: safeAxis(0, 'estimated'),
            y: safeAxis(0, 'estimated'),
            z: safeAxis(attachZ, attachZSource),
          },
        },
      ],
    });

    maxAbsExitX = Math.max(maxAbsExitX, Math.abs(xAxis.value) + 80);
    maxAbsExitY = Math.max(maxAbsExitY, Math.abs(yAxis.value) + 60);

    exits.push({
      id: exitId,
      label: `Выход ${index + 1}`,
      point: {
        x: xAxis,
        y: yAxis,
        z: safeAxis(0, 'estimated'),
      },
    });

    suspensions.push({
      id: `susp-${index + 1}`,
      type: suspensionType,
      from: { canopyId: 'canopy-main', exitId },
      to: { elementId: inst.id, attachmentId: attachId },
      routing: { type: 'straight' },
    });
  });

  const firstDrop = project.mounting.placements.find((p) => p.canopyDropMm)?.canopyDropMm;
  const rawCanopyDrop = firstDrop?.value && firstDrop.value > 0 ? firstDrop.value : 45;
  const canopyDrop = site.ceilingFromFloorMm
    ? Math.min(rawCanopyDrop, Math.max(10, site.ceilingFromFloorMm.value - 10))
    : rawCanopyDrop;

  const canopies: Composition['canopies'] = [
    {
      id: 'canopy-main',
      name: 'Потолочное основание',
      footprint:
        totalCount > 1
          ? {
              type: 'rectangular',
              widthMm: safeSize(maxAbsExitX * 2, 'estimated'),
              depthMm: safeSize(Math.max(180, maxAbsExitY * 2), 'estimated'),
            }
          : {
              type: 'round',
              diameterMm: safeSize(Math.max(200, maxAbsExitX * 2), 'estimated'),
            },
      dropMm: safeSize(canopyDrop, firstDrop ? firstDrop.source : 'estimated'),
      position: {
        x: safeAxis(0, 'estimated'),
        y: safeAxis(0, 'estimated'),
      },
      yawDeg: { value: 0, source: 'estimated' },
      ceilingFixings: [
        {
          id: 'fix-1',
          label: 'Крепление к потолку',
          point: {
            x: safeAxis(0, 'estimated'),
            y: safeAxis(0, 'estimated'),
            z: safeAxis(canopyDrop, firstDrop ? firstDrop.source : 'estimated'),
          },
        },
      ],
      exits,
    },
  ];

  const safeId = project.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'preview';
  const composition = compositionSchema.parse({
    schemaVersion: 1,
    id: `comp-${safeId}`.slice(0, 64),
    name: `${project.name} · 3D`.slice(0, 120),
    projectId: project.id,
    site,
    elements,
    canopies,
    suspensions,
  });

  const resolved = resolveComposition(composition);

  return {
    composition,
    resolved,
    isEstimatedPreview,
    notes: [...notes],
  };
}

export function mapReadinessCategoryToStep(category: OpenConfirmationCategory): WizardStepId {
  switch (category) {
    case 'photos':
      return 'upload';
    case 'order':
    case 'dimensions':
      return 'dimensions';
    case 'materials':
      return 'materials';
    case 'lighting':
      return 'lighting';
    case 'mounting':
      return 'installation';
    default:
      return 'dimensions';
  }
}

export function mapIssuePathToStep(path: (string | number)[]): WizardStepId {
  const joined = path.join('.');
  if (joined.startsWith('photos') || joined.startsWith('primaryPhotoId')) return 'upload';
  if (joined.startsWith('mounting')) return 'installation';
  if (joined.includes('.materials')) return 'materials';
  if (joined.includes('.light')) return 'lighting';
  return 'dimensions';
}

export type ReviewAudit = {
  readiness: DocumentReadiness;
  validationIssues: FieldIssue[];
  mounting: MountingSummary;
  openItems: (OpenConfirmationItem & { targetStep: WizardStepId })[];
  canExportPdf: boolean;
  kindLabelRu: string;
};

export function buildReviewAudit(
  project: Project,
  linkedComposition?: Composition,
): ReviewAudit {
  const validationIssues = validateProject(project);
  const readiness = analyzeProjectReadiness(project, linkedComposition);
  const mounting = analyzeProjectMounting(project);
  const openItems = readiness.unknownItems.map((item) => ({
    ...item,
    targetStep: mapReadinessCategoryToStep(item.category),
  }));

  const mountingIssues = issuesMatching(validationIssues, ['mounting']);

  return {
    readiness,
    validationIssues,
    mounting,
    openItems,
    canExportPdf: validationIssues.length === 0 && mountingIssues.length === 0,
    kindLabelRu: productTypes[project.kind][0],
  };
}
