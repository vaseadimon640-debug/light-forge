import { z } from 'zod';
import { dimensions, dimensionKeys, directions, finishes, materials, productTypes, projectSchema, sources, type DimensionKey, type Measurement } from '../domain/project.ts';
import { compositionSchema } from '../geometry/schema.ts';
import { resolveComposition } from '../geometry/resolve.ts';
import type { ResolvedComposition, ResolvedValue } from '../geometry/result.ts';

export const languageSchema = z.enum(['en', 'zh', 'en-zh']);
export const quickRfqRequestSchema = z.strictObject({
  project: projectSchema,
  composition: compositionSchema.optional(),
});
export const quickRfqTextSchema = z.strictObject({ language: languageSchema, text: z.string() });
export type RfqLanguage = z.infer<typeof languageSchema>;
type Cell = string | readonly [string, string];
type Section = { title: Cell; rows: [Cell, Cell][] };
export type QuickRfq = {
  title: string;
  documentTitle: Cell;
  subtitle: Cell;
  sections: Section[];
  requestTitle: Cell;
  requested: Cell[];
  photoTitle: Cell;
  noPhoto: Cell;
};

const unknown = ['To be confirmed by manufacturer', '待制造商确认'] as const;
const metric = new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 8 });
const pair = (en: string, zh: string): Cell => [en, zh];
const translate = ([, en, zh]: readonly [string, string, string]): Cell => pair(en, zh);
const measured = (measurement: Measurement | undefined, unit = ''): Cell => {
  if (!measurement) return unknown;
  const number = metric.format(measurement.value) + unit;
  const [, en, zh] = sources[measurement.source];
  return pair(`${number} · ${en}`, `${number} · ${zh}`);
};

const lengthMetric = new Intl.NumberFormat('en', { useGrouping: false, maximumFractionDigits: 2 });

function calculatedLength(length: ResolvedValue, format = metric): Cell {
  if (length.valueMm === null) return unknown;
  const number = `${format.format(length.valueMm)} mm`;
  return length.quality === 'estimated'
    ? pair(`${number} · Estimated`, `${number} · 估算`)
    : pair(`${number} · Calculated from specified data`, `${number} · 按已知数据计算`);
}

function addMountingDetails(rows: Section['rows'], resolved: ResolvedComposition) {
  for (const canopy of resolved.canopies) {
    const name = canopy.name;
    const shape = canopy.footprint;
    rows.push([pair(`${name} · Canopy shape`, `${name} · 吸顶盘形状`),
      shape.type === 'round' ? pair('Round', '圆形') : pair('Rectangular', '矩形')]);
    if (shape.type === 'round') {
      rows.push([pair(`${name} · Diameter`, `${name} · 直径`), measured(shape.diameterMm, ' mm')]);
    } else {
      rows.push(
        [pair(`${name} · Width`, `${name} · 宽度`), measured(shape.widthMm, ' mm')],
        [pair(`${name} · Depth`, `${name} · 深度`), measured(shape.depthMm, ' mm')],
      );
    }
    rows.push([pair(`${name} · Drop below ceiling`, `${name} · 向下突出高度`), measured(canopy.dropMm, ' mm')]);
  }

  for (const suspension of resolved.suspensions) {
    const name = suspension.type === 'loadBearingCable'
      ? ['Load-bearing cable', '承重吊索']
      : ['Decorative strap', '装饰吊带'];
    const en = `${name[0]} (${suspension.id})`;
    const zh = `${name[1]}（${suspension.id}）`;
    if (suspension.status === 'invalid') {
      rows.push([pair(en, zh), pair('Invalid mounting geometry. Verify attachment and exit levels.',
        '安装几何关系无效，请核对连接点与出线口的标高。')]);
      continue;
    }
    rows.push(
      [pair(`${en} · Path length`, `${zh} · 路径长度`), calculatedLength(suspension.pathLength, lengthMetric)],
      [pair(`${en} · Cut length for quotation, including allowance`, `${zh} · 报价参考裁切长度（含余量）`),
        calculatedLength(suspension.cutLength, lengthMetric)],
    );
  }
}

const blockedBrass = pair(
  'Use solid brass. Brass-coloured steel, aluminium and plated substitutes require prior written approval.',
  '须使用实心黄铜。未经事先书面批准，不得改用黄铜色钢、铝或其他镀层替代材料。',
);
const blockedImitationLeather = pair(
  'Use genuine leather. PU, PVC and other imitations require prior written approval.',
  '须使用真皮。未经事先书面批准，不得改用 PU、PVC 或其他仿皮材料。',
);
const factoryQuestions = [
  pair('Quote unit price, total price and MOQ in the stated currency. Itemise sample, tooling and engineering costs.', '请按指定币种提供单价、总价及起订量，并分列打样费、模具费和工程设计费。'),
  pair('Quote EXW and FOB. Provide DDP when available and show shipping as a separate item.', '请提供 EXW 和 FOB 报价。如可提供 DDP，请一并报价并单列运输费用。'),
  pair('State sample and production lead times, payment terms and warranty.', '请说明打样和量产交期、付款条件及质保。'),
  pair('Provide packing details, gross weight and shipping dimensions.', '请提供包装方式、毛重及运输尺寸。'),
  pair('Confirm available electrical certifications, test reports and measured photometric performance.', '请确认可提供的电气认证、检测报告及实测光学性能。'),
  pair('Submit material and finish samples, mounting details and technical drawings for approval before production.', '量产前请提交材质与表面处理样品、安装细节及技术图纸供审批。'),
];

export class RfqConflict extends Error {}

export function buildQuickRfq(input: unknown): QuickRfq {
  const { project, composition } = quickRfqRequestSchema.parse(input);
  const resolved = composition ? resolveComposition(composition) : undefined;
  if (composition && composition.projectId !== project.id)
    throw new RfqConflict('Composition must reference this project.');
  const rendered: Section[] = [];
  const finishText = (detail: string | undefined, label: Cell) =>
    detail ? pair(`${localize(label, 'en')} (${detail})`, `${localize(label, 'zh')}（${detail}）`) : label;
  function consistent(supplied: Measurement | undefined, derived: Measurement | undefined, field: string) {
    if (supplied && derived && (
      Math.abs(supplied.value - derived.value) > 0.001 || supplied.source !== derived.source
    )) throw new RfqConflict(`Project and composition disagree on ${field}.`);
    return derived ?? supplied;
  }
  const sameValue = (a: number, b: number) => Math.abs(a - b) <= 0.001;

  const geometryDimensions = new Map<string, Partial<Record<DimensionKey, Measurement>>>();
  if (resolved) {
    const counts = new Map<string, number>();
    for (const element of resolved.elements) {
      const component = project.components.find(item => item.id === element.productComponentId);
      if (!component) throw new RfqConflict(`Element ${element.id} requires a matching component.`);
      const count = (counts.get(component.id) ?? 0) + 1;
      counts.set(component.id, count);
      if (count > component.quantity) throw new RfqConflict(`Composition exceeds the project quantity for ${component.name}.`);
      const { shape, geometry } = element;
      const kind = shape.type === 'envelope' ? shape.intendedShape : shape.type;
      if (kind !== 'custom' && kind !== component.kind) throw new RfqConflict(`Geometry type differs for ${component.name}.`);

      const target = geometryDimensions.get(component.id) ?? {};
      const fromGeometry = (value: number, inputs: Measurement[]): Measurement => ({
        value, source: inputs.some(input => input.source === 'estimated') ? 'estimated' :
          inputs.some(input => input.source === 'user') ? 'user' : 'documentation',
      });
      const arc = shape.type === 'arc' ? geometry.arc! : undefined;
      let values: Partial<Record<DimensionKey, Measurement>>;
      if (shape.type === 'ring') {
        values = { outerDiameter: shape.outerDiameterMm, innerDiameter: shape.innerDiameterMm, profileHeight: shape.profileHeightMm };
      } else if (shape.type === 'linear') {
        values = { length: shape.lengthMm, width: shape.widthMm, height: shape.heightMm };
      } else if (shape.type === 'envelope') {
        values = { width: shape.widthMm, depth: shape.depthMm, height: shape.heightMm };
      } else {
        const radialInputs = [shape.chordMm, shape.riseMm, shape.radialThicknessMm];
        values = {
          width: fromGeometry(geometry.widthMm, radialInputs), depth: shape.depthMm,
          height: fromGeometry(geometry.heightMm, radialInputs),
          radius: fromGeometry(arc!.centerlineRadiusMm, [shape.chordMm, shape.riseMm]),
        };
      }

      for (const [key, measurement] of Object.entries(values) as [DimensionKey, Measurement][]) {
        if (shape.type === 'arc' && key !== 'depth') {
          // Use the calculated dimension when present. Equal reported dimensions may have a different recorded source.
          const entered = component.dimensions[key];
          if (entered && !sameValue(entered.value, measurement.value))
            throw new RfqConflict(`Project and composition disagree on ${component.name} ${key}.`);
          if (entered?.source === 'estimated') measurement.source = 'estimated';
        } else {
          consistent(component.dimensions[key], measurement, `${component.name} ${key}`);
        }
        target[key] = consistent(target[key], measurement, `${component.name} ${key} between instances`);
      }
      geometryDimensions.set(component.id, target);
    }
  }
  const ceiling = consistent(project.mounting.ceilingFromFloorMm, resolved?.site.ceilingFromFloorMm, 'ceiling level');
  const tabletop = consistent(project.mounting.tabletopFromFloorMm, resolved?.site.tabletopFromFloorMm, 'tabletop level');

  rendered.push({
    title: pair('Order specification', '订购规格'),
    rows: [
      [pair('Project code', '项目编号'), project.code || unknown],
      [pair('Luminaire type', '灯具类型'), translate(productTypes[project.kind])],
      [pair('Order quantity', '订购数量'), String(project.orderQuantity)],
      [pair('Quotation currency', '报价币种'), project.currency],
    ],
  });

  for (const component of project.components) {
    const { light } = component;
    const knownDimensions = { ...component.dimensions, ...geometryDimensions.get(component.id) };
    const knownKeys = new Set([...dimensionKeys(component.kind), ...Object.keys(knownDimensions) as DimensionKey[]]);
    const rows: Section['rows'] = [
      [pair('Component type', '组件类型'), translate(productTypes[component.kind])],
      [pair('Quantity per luminaire / set', '每套数量'), String(component.quantity)],
      ...[...knownKeys].map((key): [Cell, Cell] => [translate(dimensions[key]), measured(knownDimensions[key], ' mm')]),
      [pair('CCT', '色温'), measured(light.cct, ' K')],
      [pair('CRI', '显色指数'), measured(light.cri)],
      [pair('Power per component', '单件功率'), measured(light.watts, ' W')],
      [pair('Luminous flux per component', '单件光通量'), measured(light.lumens, ' lm')],
      [pair('Light direction', '出光方向'), light.directionId ? translate(directions[light.directionId]) : unknown],
      [pair('Dimming', '调光'), light.dimming === 'none' ? pair('None', '不调光') : light.dimming ?? unknown],
      [pair('IP rating', '防护等级'), light.ip ?? unknown],
      [pair('Driver and input voltage', '驱动器及输入电压'), unknown],
    ];
    for (const material of component.materials) {
      const describe = (detail: Cell, lang: 'en' | 'zh') => localize(detail, lang);
      const body = finishText(material.materialDetail, translate(materials[material.material]));
      const finish = material.finishDetail || material.finish
        ? finishText(material.finishDetail, material.finish ? translate(finishes[material.finish]) : pair('Custom finish', '定制表面处理'))
        : unknown;
      rows.push([pair(`Material · ${material.part}`, `材质 · ${material.part}`), pair(
        `${describe(body, 'en')} | Finish: ${describe(finish, 'en')}${material.color ? ` | Colour: ${material.color}` : ''}`,
        `${describe(body, 'zh')} | 表面处理：${describe(finish, 'zh')}${material.color ? ` | 颜色：${material.color}` : ''}`,
      )]);
    }
    if (!component.materials.length) rows.push([pair('Materials and finishes', '材质及表面处理'), unknown]);
    rendered.push({ title: component.name, rows });
  }

  if (ceiling || tabletop || project.mounting.placements.length || resolved) {
    const rows: Section['rows'] = [
      [pair('Ceiling above finished floor', '天花距完成地面'), measured(ceiling, ' mm')],
      [pair('Tabletop above finished floor', '桌面距完成地面'), measured(tabletop, ' mm')],
    ];
    for (const [index, placement] of project.mounting.placements.entries()) {
      const part = project.components.find(component => component.id === placement.componentId)!;
      const bound = resolved?.elements.find(element => element.id === placement.id);
      const level = bound?.lowest.aboveTabletop;
      if (bound && (bound.productComponentId !== placement.componentId ||
        (level && level.valueMm !== null && placement.lowestAboveTabletopMm && !sameValue(level.valueMm, placement.lowestAboveTabletopMm.value))))
        throw new RfqConflict(`Project and composition disagree on placement ${placement.id}.`);
      rows.push([
        pair(`${index + 1}. ${part.name} · lowest point above tabletop`, `${index + 1}. ${part.name} · 灯具最低点距桌面`),
        level && level.valueMm !== null
          ? measured({ value: level.valueMm, source: level.quality === 'estimated' ? 'estimated' : placement.lowestAboveTabletopMm?.source ?? 'user' }, ' mm')
          : measured(placement.lowestAboveTabletopMm, ' mm'),
      ]);
    }
    if (resolved) {
      for (const element of resolved.elements) {
        if (project.mounting.placements.some(placement => placement.id === element.id)) continue;
        const level = element.lowest.fromFloor;
        rows.push([pair(`${element.name} · lowest point above floor`, `${element.name} · 灯具最低点距地面`), calculatedLength(level)]);
      }
      addMountingDetails(rows, resolved);
    }
    rows.push([pair('Canopy and suspension fabrication lengths', '吸顶盘及吊挂制作长度'), unknown]);
    rendered.push({ title: pair('Mounting references', '安装基准'), rows });
  }

  const used = new Set(project.components.flatMap(component => component.materials.map(material => material.material)));
  const requirements = [
    ...(project.strictMaterials ? [pair('No material substitutions without written approval.', '未经书面批准，不得替换材质。')] : []),
    ...(used.has('solidBrass') ? [blockedBrass] : []),
    ...(used.has('genuineLeather') ? [blockedImitationLeather] : []),
    ...factoryQuestions,
  ];
  if (project.notes) rendered.push({ title: pair('Additional project notes', '项目补充说明'), rows: [[pair('Notes', '说明'), project.notes]] });
  return {
    title: project.name,
    documentTitle: pair('Request for quotation', '询价单'),
    subtitle: pair('QUICK RFQ · PRELIMINARY · FOR QUOTATION', '快速询价 · 初步资料 · 仅供报价'),
    sections: rendered,
    requestTitle: pair('Supplier response requested', '请供应商回复'),
    requested: requirements,
    photoTitle: pair('Reference photographs', '参考照片'),
    noPhoto: pair('Reference photograph to be supplied.', '参考照片待提供。'),
  };
}

export function localize(value: Cell, language: RfqLanguage): string {
  if (typeof value === 'string') return value;
  if (language === 'en-zh' && value[0] === value[1]) return value[0];
  if (language === 'en-zh') return `${value[0]}\n${value[1]}`;
  return value[language === 'zh' ? 1 : 0];
}

export function textQuickRfq(document: QuickRfq, language: RfqLanguage): string {
  const text = (value: Cell) => localize(value, language);
  return [
    text(document.documentTitle),
    document.title,
    text(document.subtitle),
    ...document.sections.map(section => [
      text(section.title),
      ...section.rows.map(([name, value]) => `${text(name).replaceAll('\n', ' / ')}: ${text(value).replaceAll('\n', typeof value === 'string' ? '\n' : ' / ')}`),
    ].join('\n')),
    [text(document.requestTitle), ...document.requested.map(item => `• ${text(item)}`)].join('\n'),
  ].join('\n\n');
}
