import { z } from 'zod';
import {
  dimensions,
  dimensionKeys,
  finishes,
  materials,
  type DimensionKey,
  type Measurement,
  type Project,
} from '../domain/project.ts';
import { resolveComposition } from '../geometry/resolve.ts';
import type { Composition } from '../geometry/schema.ts';
import {
  buildQuickRfq,
  localize,
  quickRfqRequestSchema,
  textQuickRfq,
  type QuickRfq,
  type RfqLanguage,
} from './quick.ts';

export const rfqTierSchema = z.enum(['quick', 'detailed']);
export type RfqTier = z.infer<typeof rfqTierSchema>;

export const detailedRfqRequestSchema = quickRfqRequestSchema.extend({
  revision: z.number().int().min(1).max(999).optional(),
  releaseNote: z.string().trim().max(400).optional(),
  issuedAt: z.iso.datetime().optional(),
});
export type DetailedRfqRequest = z.infer<typeof detailedRfqRequestSchema>;

export type OpenConfirmationCategory =
  | 'order'
  | 'dimensions'
  | 'materials'
  | 'lighting'
  | 'mounting'
  | 'photos';

export type OpenConfirmationItem = {
  category: OpenConfirmationCategory;
  labelRu: string;
  labelEn: string;
  labelZh: string;
};

export type DocumentReadiness = {
  documentationCount: number;
  userCount: number;
  estimatedCount: number;
  unknownItems: OpenConfirmationItem[];
  componentCount: number;
  totalOrderUnits: number;
  photoCount: number;
  strictMaterials: boolean;
  hasSolidBrass: boolean;
  hasGenuineLeather: boolean;
  compositionAttached: boolean;
  compositionName?: string;
  unresolvedMountingCount: number;
};

export type DetailedRfq = QuickRfq & {
  tier: 'detailed';
  revision?: number;
  readiness: DocumentReadiness;
};

type Cell = string | readonly [string, string];
type Section = QuickRfq['sections'][number];

const unknown = ['To be confirmed by manufacturer', '待制造商确认'] as const;
const pair = (en: string, zh: string): Cell => [en, zh];
const translate = ([, en, zh]: readonly [string, string, string]): Cell => pair(en, zh);

export function analyzeProjectReadiness(
  project: Project,
  composition?: Composition,
): DocumentReadiness {
  let documentationCount = 0;
  let userCount = 0;
  let estimatedCount = 0;
  const unknownItems: OpenConfirmationItem[] = [];

  const tallyMeasurement = (measurement: Measurement | undefined): boolean => {
    if (!measurement) return false;
    if (measurement.source === 'documentation') documentationCount += 1;
    else if (measurement.source === 'user') userCount += 1;
    else estimatedCount += 1;
    return true;
  };

  if (!project.code.trim()) {
    unknownItems.push({
      category: 'order',
      labelRu: 'Код / артикул проекта',
      labelEn: 'Project code / SKU',
      labelZh: '项目编号 / SKU',
    });
  }

  if (project.photos.length === 0) {
    unknownItems.push({
      category: 'photos',
      labelRu: 'Референсные фотографии светильника',
      labelEn: 'Reference photographs',
      labelZh: '参考照片',
    });
  }

  const resolved = composition ? resolveComposition(composition) : undefined;
  const resolvedDimsByComponent = new Map<string, Set<DimensionKey>>();
  if (resolved) {
    for (const element of resolved.elements) {
      if (!element.productComponentId) continue;
      const set = resolvedDimsByComponent.get(element.productComponentId) ?? new Set<DimensionKey>();
      if (element.shape.type === 'ring') {
        set.add('outerDiameter');
        set.add('innerDiameter');
        set.add('profileHeight');
      } else if (element.shape.type === 'linear') {
        set.add('length');
        set.add('width');
        set.add('height');
      } else if (element.shape.type === 'envelope') {
        set.add('width');
        set.add('depth');
        set.add('height');
      } else {
        set.add('width');
        set.add('depth');
        set.add('height');
        set.add('radius');
      }
      resolvedDimsByComponent.set(element.productComponentId, set);
    }
  }

  let hasSolidBrass = false;
  let hasGenuineLeather = false;
  let totalOrderUnits = 0;

  for (const component of project.components) {
    totalOrderUnits += component.quantity * project.orderQuantity;
    const keys = new Set<DimensionKey>([
      ...dimensionKeys(component.kind),
      ...(Object.keys(component.dimensions) as DimensionKey[]),
    ]);
    const fromGeo = resolvedDimsByComponent.get(component.id);

    for (const key of keys) {
      const m = component.dimensions[key];
      if (!tallyMeasurement(m)) {
        if (!fromGeo?.has(key)) {
          const [ru, en, zh] = dimensions[key];
          unknownItems.push({
            category: 'dimensions',
            labelRu: `${component.name}: ${ru} (мм)`,
            labelEn: `${component.name}: ${en} (mm)`,
            labelZh: `${component.name}：${zh}（mm）`,
          });
        } else {
          userCount += 1;
        }
      }
    }

    if (!tallyMeasurement(component.light.cct)) {
      unknownItems.push({
        category: 'lighting',
        labelRu: `${component.name}: цветовая температура (CCT, K)`,
        labelEn: `${component.name}: CCT (K)`,
        labelZh: `${component.name}：色温（CCT）`,
      });
    }
    if (!tallyMeasurement(component.light.cri)) {
      unknownItems.push({
        category: 'lighting',
        labelRu: `${component.name}: индекс цветопередачи (CRI)`,
        labelEn: `${component.name}: CRI`,
        labelZh: `${component.name}：显色指数（CRI）`,
      });
    }
    if (!tallyMeasurement(component.light.watts)) {
      unknownItems.push({
        category: 'lighting',
        labelRu: `${component.name}: мощность на компонент (W)`,
        labelEn: `${component.name}: Power per component (W)`,
        labelZh: `${component.name}：单件功率（W）`,
      });
    }
    if (!tallyMeasurement(component.light.lumens)) {
      unknownItems.push({
        category: 'lighting',
        labelRu: `${component.name}: световой поток (lm)`,
        labelEn: `${component.name}: Luminous flux (lm)`,
        labelZh: `${component.name}：单件光通量（lm）`,
      });
    }
    if (!component.light.directionId) {
      unknownItems.push({
        category: 'lighting',
        labelRu: `${component.name}: направление света`,
        labelEn: `${component.name}: Light direction`,
        labelZh: `${component.name}：出光方向`,
      });
    }
    if (!component.light.dimming) {
      unknownItems.push({
        category: 'lighting',
        labelRu: `${component.name}: диммирование`,
        labelEn: `${component.name}: Dimming`,
        labelZh: `${component.name}：调光方式`,
      });
    }
    if (!component.light.ip) {
      unknownItems.push({
        category: 'lighting',
        labelRu: `${component.name}: степень защиты (IP)`,
        labelEn: `${component.name}: IP rating`,
        labelZh: `${component.name}：防护等级（IP）`,
      });
    }

    if (component.materials.length === 0) {
      unknownItems.push({
        category: 'materials',
        labelRu: `${component.name}: материалы и отделка деталей`,
        labelEn: `${component.name}: Materials and finishes`,
        labelZh: `${component.name}：材质及表面处理`,
      });
    } else {
      for (const mat of component.materials) {
        if (mat.material === 'solidBrass') hasSolidBrass = true;
        if (mat.material === 'genuineLeather') hasGenuineLeather = true;
        if (!mat.finish && !mat.finishDetail) {
          unknownItems.push({
            category: 'materials',
            labelRu: `${component.name} · ${mat.part}: отделка поверхности`,
            labelEn: `${component.name} · ${mat.part}: Surface finish`,
            labelZh: `${component.name} · ${mat.part}：表面处理`,
          });
        }
      }
    }
  }

  const ceiling = project.mounting.ceilingFromFloorMm ?? resolved?.site.ceilingFromFloorMm;
  const tabletop = project.mounting.tabletopFromFloorMm ?? resolved?.site.tabletopFromFloorMm;
  const hasMountingContext = Boolean(
    ceiling || tabletop || project.mounting.placements.length > 0 || resolved,
  );
  let unresolvedMountingCount = 0;

  if (hasMountingContext) {
    if (!tallyMeasurement(ceiling)) {
      unresolvedMountingCount += 1;
      unknownItems.push({
        category: 'mounting',
        labelRu: 'Высота потолка от чистого пола (мм)',
        labelEn: 'Ceiling height above finished floor (mm)',
        labelZh: '天花距完成地面高度（mm）',
      });
    }
    if (!tallyMeasurement(tabletop)) {
      unresolvedMountingCount += 1;
      unknownItems.push({
        category: 'mounting',
        labelRu: 'Высота столешницы от чистого пола (мм)',
        labelEn: 'Tabletop height above finished floor (mm)',
        labelZh: '桌面距完成地面高度（mm）',
      });
    }
    for (const placement of project.mounting.placements) {
      if (!tallyMeasurement(placement.lowestAboveTabletopMm)) {
        unresolvedMountingCount += 1;
        const part = project.components.find(c => c.id === placement.componentId);
        const label = part?.name ?? placement.componentId;
        unknownItems.push({
          category: 'mounting',
          labelRu: `${label}: высота нижней точки над столом (мм)`,
          labelEn: `${label}: Lowest point above tabletop (mm)`,
          labelZh: `${label}：灯具最低点距桌面高度（mm）`,
        });
      }
    }
    if (resolved) {
      for (const suspension of resolved.suspensions) {
        if (
          suspension.status === 'invalid' ||
          suspension.pathLength.valueMm === null ||
          suspension.cutLength.valueMm === null
        ) {
          unresolvedMountingCount += 1;
          unknownItems.push({
            category: 'mounting',
            labelRu: `Подвес (${suspension.id}): подтвердить длину пути и длину с припуском`,
            labelEn: `Suspension (${suspension.id}): Confirm path and cut lengths`,
            labelZh: `吊挂（${suspension.id}）：请确认路径长度与裁切长度`,
          });
        }
      }
    }
  } else {
    unresolvedMountingCount += 1;
    unknownItems.push({
      category: 'mounting',
      labelRu: 'Монтажные уровни (потолок / стол) и длины подвесов',
      labelEn: 'Mounting levels (ceiling / tabletop) and suspension lengths',
      labelZh: '安装标高（天花 / 桌面）及吊挂长度',
    });
  }

  return {
    documentationCount,
    userCount,
    estimatedCount,
    unknownItems,
    componentCount: project.components.length,
    totalOrderUnits,
    photoCount: project.photos.length,
    strictMaterials: project.strictMaterials,
    hasSolidBrass,
    hasGenuineLeather,
    compositionAttached: Boolean(composition),
    compositionName: composition?.name,
    unresolvedMountingCount,
  };
}

function formatFinishLabel(detail: string | undefined, label: Cell): Cell {
  return detail
    ? pair(`${localize(label, 'en')} (${detail})`, `${localize(label, 'zh')}（${detail}）`)
    : label;
}

export function buildDetailedRfq(input: unknown): DetailedRfq {
  const parsed = detailedRfqRequestSchema.parse(input);
  const { project, composition, revision, releaseNote, issuedAt } = parsed;

  // Reuse Quick RFQ builder for canonical validation, conflict detection (RfqConflict),
  // component technical specs, mounting references, and material substitution rules.
  const base = buildQuickRfq(composition ? { project, composition } : { project });
  const readiness = analyzeProjectReadiness(project, composition);
  const issueDate = (issuedAt ?? project.updatedAt).slice(0, 10);
  const revLabelEn = revision ? `Rev. v${revision}` : 'Working draft (unversioned)';
  const revLabelZh = revision ? `版本 v${revision}` : '工作草稿（未定版）';

  const controlRows: Section['rows'] = [
    [pair('Document tier', '文件级别'), pair('Detailed RFQ Specification Package', '详细询价规范包')],
    [pair('Document revision', '文件版本'), pair(revLabelEn, revLabelZh)],
    [pair('Issue date (UTC)', '发布日期（UTC）'), issueDate],
    [
      pair('Data provenance summary', '数据来源统计'),
      pair(
        `Documentation: ${readiness.documentationCount} · User-supplied: ${readiness.userCount} · Estimated: ${readiness.estimatedCount} · To be confirmed: ${readiness.unknownItems.length}`,
        `技术文档：${readiness.documentationCount} · 用户提供：${readiness.userCount} · 估算：${readiness.estimatedCount} · 待确认：${readiness.unknownItems.length}`,
      ),
    ],
    [
      pair('Substitution policy', '材质替换政策'),
      project.strictMaterials
        ? pair('Strict Materials — written approval required for any substitution', '严格材质 — 任何替换须书面批准')
        : pair('Standard — propose equivalents only with clear disclosure', '标准 — 如提替代方案须明确标注'),
    ],
    [
      pair('3D engineering composition', '3D 工程组合'),
      composition
        ? pair(
            `${composition.name} (${composition.elements.length} elements, ${composition.suspensions.length} suspensions)`,
            `${composition.name}（${composition.elements.length} 个组件，${composition.suspensions.length} 条吊挂）`,
          )
        : pair('Not attached — verify fabrication geometry with shop drawings', '未关联 — 生产前请提供深化图纸核对'),
    ],
    [
      pair('Engineering sign-off status', '工程确认状态'),
      pair(
        'Conceptual & quotation package only — factory shop drawings and samples required before production',
        '仅用于报价与工程沟通 — 量产前须确认工厂深化图纸及样品',
      ),
    ],
  ];

  if (releaseNote) {
    controlRows.push([pair('Revision note', '版本备注'), releaseNote]);
  }

  // Consolidated Bill of Materials (BOM) keeping Material, Finish, and Colour strictly separate
  const bomRows: Section['rows'] = [];
  let lineIndex = 1;
  for (const component of project.components) {
    const totalQty = component.quantity * project.orderQuantity;
    if (component.materials.length === 0) {
      bomRows.push([
        pair(
          `${lineIndex}. ${component.name} (×${component.quantity}/set · total ${totalQty})`,
          `${lineIndex}. ${component.name}（每套 ×${component.quantity} · 合计 ${totalQty}）`,
        ),
        unknown,
      ]);
      lineIndex += 1;
      continue;
    }

    for (const mat of component.materials) {
      const body = formatFinishLabel(mat.materialDetail, translate(materials[mat.material]));
      const finish =
        mat.finishDetail || mat.finish
          ? formatFinishLabel(
              mat.finishDetail,
              mat.finish ? translate(finishes[mat.finish]) : pair('Custom finish', '定制表面处理'),
            )
          : unknown;
      const colorEn = mat.color ? `Colour: ${mat.color}` : 'Colour: To be confirmed';
      const colorZh = mat.color ? `颜色：${mat.color}` : '颜色：待确认';
      const policyEn =
        mat.material === 'solidBrass'
          ? 'Solid brass only (no plated substitutes)'
          : mat.material === 'genuineLeather'
            ? 'Genuine leather only (no PU/PVC)'
            : project.strictMaterials
              ? 'No substitution without written approval'
              : 'Confirm specification';
      const policyZh =
        mat.material === 'solidBrass'
          ? '须实心黄铜（禁镀层替代）'
          : mat.material === 'genuineLeather'
            ? '须真皮（禁 PU/PVC）'
            : project.strictMaterials
              ? '未经书面批准不得替换'
              : '请确认材质规格';

      bomRows.push([
        pair(
          `${lineIndex}. ${component.name} · ${mat.part} (×${component.quantity}/set · total ${totalQty})`,
          `${lineIndex}. ${component.name} · ${mat.part}（每套 ×${component.quantity} · 合计 ${totalQty}）`,
        ),
        pair(
          `Material: ${localize(body, 'en')} | Finish: ${localize(finish, 'en')} | ${colorEn} | ${policyEn}`,
          `基材：${localize(body, 'zh')} | 表面处理：${localize(finish, 'zh')} | ${colorZh} | ${policyZh}`,
        ),
      ]);
      lineIndex += 1;
    }
  }

  // Open Engineering Confirmations Checklist
  const checklistRows: Section['rows'] =
    readiness.unknownItems.length > 0
      ? readiness.unknownItems.map((item, idx) => [
          pair(`${idx + 1}. ${item.labelEn}`, `${idx + 1}. ${item.labelZh}`),
          unknown,
        ])
      : [
          [
            pair('Project fields status', '项目字段状态'),
            pair(
              'All listed project fields supplied — verify factory engineering drawings, certifications and commercial terms below',
              '项目字段已填写 — 请核对工厂深化图纸、电气认证及商务条款',
            ),
          ],
        ];

  const detailedSections: Section[] = [
    { title: pair('Document control & revision', '文件控制与版本信息'), rows: controlRows },
    base.sections[0], // Order specification
    { title: pair('Bill of materials (materials, finishes & colours)', '材料与表面处理清单（BOM）'), rows: bomRows },
    ...base.sections.slice(1),
    {
      title: pair(
        `Open engineering confirmations (${readiness.unknownItems.length})`,
        `待制造商工程确认清单（${readiness.unknownItems.length} 项）`,
      ),
      rows: checklistRows,
    },
  ];

  const detailedRequested: Cell[] = [
    ...base.requested,
    pair(
      'Return completed shop drawings (dimensions in mm), BOM material confirmation and photometric/IES file where applicable before sample production.',
      '打样前请回传深化图纸（单位 mm）、BOM 材质确认表及适用时的配光 / IES 文件。',
    ),
  ];

  return {
    ...base,
    tier: 'detailed',
    revision,
    readiness,
    documentTitle: pair('Detailed Request for Quotation', '详细生产询价单'),
    subtitle: pair(
      `DETAILED RFQ${revision ? ` · REV. V${revision}` : ''} · SPECIFICATION PACKAGE · FOR ENGINEERING & QUOTATION`,
      `详细询价规范${revision ? ` · 版本 V${revision}` : ''} · 工程与报价资料包`,
    ),
    sections: detailedSections,
    requested: detailedRequested,
  };
}

export function textDetailedRfq(document: DetailedRfq, language: RfqLanguage): string {
  return textQuickRfq(document, language);
}
