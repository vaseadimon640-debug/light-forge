import { z } from 'zod';

export const productTypes = {
  pendant: ['Подвесной', 'Pendant', '吊灯'],
  chandelier: ['Люстра', 'Chandelier', '枝形吊灯'],
  ring: ['Кольцо', 'Ring', '环形灯'],
  linear: ['Линейный', 'Linear', '线性灯'],
  arc: ['Дугообразный', 'Arc', '弧形灯'],
  wall: ['Настенный', 'Wall', '壁灯'],
  ceiling: ['Потолочный', 'Ceiling', '吸顶灯'],
  floor: ['Торшер', 'Floor', '落地灯'],
  table: ['Настольный', 'Table', '台灯'],
  custom: ['Нестандартный', 'Custom', '定制灯具'],
} as const;

export const materials = {
  solidBrass: ['Настоящая латунь', 'Solid brass', '实心黄铜'],
  genuineLeather: ['Натуральная кожа', 'Genuine leather', '真皮'],
  stainlessSteel: ['Нержавеющая сталь', 'Stainless steel', '不锈钢'],
  aluminium: ['Алюминий', 'Aluminium', '铝'],
  copper: ['Медь', 'Copper', '铜'],
  steel: ['Сталь', 'Steel', '钢'],
  artificialLeather: ['Искусственная кожа', 'Artificial leather', '人造革'],
  glass: ['Стекло', 'Glass', '玻璃'],
  crystal: ['Хрусталь', 'Crystal', '水晶'],
  acrylic: ['Акрил', 'Acrylic', '亚克力'],
  polycarbonate: ['Поликарбонат', 'Polycarbonate', '聚碳酸酯'],
  textile: ['Ткань', 'Textile', '织物'],
  wood: ['Дерево', 'Wood', '木材'],
  stone: ['Камень', 'Stone', '石材'],
  ceramic: ['Керамика', 'Ceramic', '陶瓷'],
  custom: ['Другой материал', 'Custom material', '定制材质'],
} as const;

export const finishes = {
  naturalSatinBrass: ['Натуральная сатиновая латунь', 'Natural satin brass', '天然缎面黄铜'],
  brushedBrass: ['Шлифованная латунь', 'Brushed brass', '拉丝黄铜'],
  polishedBrass: ['Полированная латунь', 'Polished brass', '抛光黄铜'],
  antiqueBrass: ['Состаренная латунь', 'Antique brass', '仿古黄铜'],
  burnishedBrass: ['Патинированная латунь', 'Burnished brass', '做旧黄铜'],
  brushedBronze: ['Шлифованная бронза', 'Brushed bronze', '拉丝青铜'],
  polishedChrome: ['Полированный хром', 'Polished chrome', '抛光铬'],
  satinNickel: ['Сатиновый никель', 'Satin nickel', '缎面镍'],
  matteBlack: ['Матовый чёрный', 'Matte black', '哑光黑'],
  glossyBlack: ['Глянцевый чёрный', 'Glossy black', '亮黑'],
  white: ['Белый', 'White', '白色'],
  custom: ['Другая отделка', 'Custom finish', '定制表面处理'],
} as const;

export const dimensions = {
  width: ['Ширина', 'Width', '宽度'],
  depth: ['Глубина', 'Depth', '深度'],
  height: ['Высота корпуса', 'Body height', '灯体高度'],
  length: ['Длина', 'Length', '长度'],
  outerDiameter: ['Внешний диаметр', 'Outer diameter', '外径'],
  innerDiameter: ['Внутренний диаметр', 'Inner diameter', '内径'],
  profileHeight: ['Высота профиля', 'Profile height', '型材高度'],
  profileThickness: ['Толщина профиля', 'Profile thickness', '型材厚度'],
  radius: ['Радиус', 'Radius', '半径'],
} as const;

export const directions = {
  up: ['Вверх', 'Upward', '向上'],
  down: ['Вниз', 'Downward', '向下'],
  both: ['Вверх и вниз', 'Upward and downward', '上下双向'],
  diffuse: ['Рассеянный', 'Diffuse', '漫射'],
  adjustable: ['Регулируемый', 'Adjustable', '可调'],
} as const;

export const dimmingModes = ['none', 'DALI', 'DALI-2', 'TRIAC', '0–10 V', 'Casambi', 'KNX'] as const;
export const ipRatings = ['IP20', 'IP44', 'IP54', 'IP65', 'IP67'] as const;
export const sources = {
  user: ['От пользователя', 'User-supplied', '用户提供'],
  documentation: ['По документации', 'Verified by documentation', '经文件核实'],
  estimated: ['Оценка', 'Estimated', '估算'],
} as const;

const name = z.string().trim().min(1).max(120);
const note = z.string().trim().max(1000);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const timestamp = z.iso.datetime();
const quantity = z.number().int().min(1).max(1_000_000);
const mm = z.number().min(0).max(1_000_000);
const source = z.enum(['user', 'documentation', 'estimated']);
const measurement = (value: z.ZodNumber) => z.strictObject({ value, source });
export const measureMmSchema = measurement(mm);
export const dimensionKeySchema = z.enum(Object.keys(dimensions) as [keyof typeof dimensions, ... (keyof typeof dimensions)[]]);
const requiredMaterialSchema = z.strictObject({
  id,
  part: name,
  material: z.enum(Object.keys(materials) as [keyof typeof materials, ... (keyof typeof materials)[]]),
  materialDetail: note.optional(),
  finish: z.enum(Object.keys(finishes) as [keyof typeof finishes, ... (keyof typeof finishes)[]]).optional(),
  finishDetail: note.optional(),
  color: z.string().trim().max(120).optional(),
});

export const componentSchema = z.strictObject({
  id,
  name,
  kind: z.enum(Object.keys(productTypes) as [keyof typeof productTypes, ... (keyof typeof productTypes)[]]),
  quantity,
  dimensions: z.partialRecord(dimensionKeySchema, measureMmSchema),
  materials: z.array(requiredMaterialSchema).max(16),
  light: z.strictObject({
    cct: measurement(z.number().int().min(1000).max(20000)).optional(),
    cri: measurement(z.number().min(0).max(100)).optional(),
    watts: measurement(z.number().positive().max(100000)).optional(),
    lumens: measurement(z.number().positive().max(10000000)).optional(),
    directionId: z.enum(['up', 'down', 'both', 'diffuse', 'adjustable']).optional(),
    dimming: z.enum(dimmingModes).optional(),
    ip: z.enum(ipRatings).optional(),
  }),
});

const photoId = id;
export const maxPhotos = 8;
export const maxPhotoBytes = 12 * 1024 * 1024;
export const maxTotalPhotoBytes = 32 * 1024 * 1024;
export const imageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const photoSchema = z.strictObject({
  id: photoId,
  name: z.string().min(1).max(255),
  type: z.enum(imageTypes),
  size: z.number().int().min(1).max(maxPhotoBytes),
});
const mountingSchema = z.strictObject({
  ceilingFromFloorMm: measureMmSchema.optional(),
  tabletopFromFloorMm: measureMmSchema.optional(),
  placements: z.array(z.strictObject({
    id,
    componentId: id,
    lowestAboveTabletopMm: measureMmSchema.optional(),
    xMm: z.number().min(-1_000_000).max(1_000_000).optional(),
    yMm: z.number().min(-1_000_000).max(1_000_000).optional(),
    canopyDropMm: measureMmSchema.optional(),
    attachmentAboveLowestMm: measureMmSchema.optional(),
  })).max(96),
});

export const projectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id,
  name,
  code: z.string().trim().max(80),
  kind: z.enum(Object.keys(productTypes) as [keyof typeof productTypes, ... (keyof typeof productTypes)[]]),
  orderQuantity: quantity,
  currency: z.enum(['USD', 'EUR', 'CNY']),
  strictMaterials: z.boolean(),
  createdAt: timestamp,
  updatedAt: timestamp,
  components: z.array(componentSchema).min(1).max(24),
  photos: z.array(photoSchema).max(maxPhotos),
  primaryPhotoId: photoId.optional(),
  mounting: mountingSchema,
  notes: note,
}).superRefine((project, ctx) => {
  for (const key of ['components', 'photos'] as const) {
    if (new Set(project[key].map(item => item.id)).size !== project[key].length)
      ctx.addIssue({ code: 'custom', path: [key], message: 'Duplicate IDs' });
  }
  if (new Set(project.mounting.placements.map(item => item.id)).size !== project.mounting.placements.length)
    ctx.addIssue({ code: 'custom', path: ['mounting', 'placements'], message: 'Duplicate placement IDs' });
  if ((project.photos.length > 0 || project.primaryPhotoId) && !project.photos.some(photo => photo.id === project.primaryPhotoId))
    ctx.addIssue({ code: 'custom', path: ['primaryPhotoId'], message: 'Select an attached photo' });
  if (project.photos.reduce((sum, photo) => sum + photo.size, 0) > maxTotalPhotoBytes)
    ctx.addIssue({ code: 'custom', path: ['photos'], message: 'Total photo size exceeds 32 MiB' });
  const counts = new Map<string, number>();
  for (const [index, placement] of project.mounting.placements.entries()) {
    const component = project.components.find(item => item.id === placement.componentId);
    const count = (counts.get(placement.componentId) ?? 0) + 1;
    counts.set(placement.componentId, count);
    if (!component || count > component.quantity)
      ctx.addIssue({ code: 'custom', path: ['mounting', 'placements', index], message: 'Placement requires an unused component unit' });
  }
  for (const [index, component] of project.components.entries()) {
    const { innerDiameter, outerDiameter } = component.dimensions;
    if (innerDiameter && outerDiameter && innerDiameter.value >= outerDiameter.value)
      ctx.addIssue({ code: 'custom', path: ['components', index, 'dimensions', 'innerDiameter'], message: 'Inner diameter must be less than outer diameter' });
  }
});

export type Project = z.infer<typeof projectSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Material = z.infer<typeof requiredMaterialSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type Measurement = z.infer<typeof measureMmSchema>;
export type DimensionKey = z.infer<typeof dimensionKeySchema>;
export type ProductType = Project['kind'];
export type Placement = Project['mounting']['placements'][number];
export type Unit = 'mm' | 'cm' | 'm';
export const unitFactors: Record<Unit, number> = { mm: 1, cm: 10, m: 1000 };

export function dimensionKeys(kind: ProductType): DimensionKey[] {
  if (kind === 'ring') return ['outerDiameter', 'innerDiameter', 'profileHeight', 'profileThickness'];
  if (kind === 'linear') return ['length', 'width', 'height'];
  if (kind === 'arc') return ['width', 'depth', 'height', 'radius'];
  return ['width', 'depth', 'height', 'length'];
}

export function newComponent(kind: ProductType = 'pendant'): Component {
  return { id: crypto.randomUUID(), name: 'Корпус', kind, quantity: 1, dimensions: {}, materials: [], light: {} };
}

export function newProject(): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, id: crypto.randomUUID(), name: 'Новый светильник', code: '',
    kind: 'pendant', orderQuantity: 1, currency: 'USD', strictMaterials: true,
    createdAt: now, updatedAt: now, components: [newComponent()], photos: [],
    mounting: { placements: [] }, notes: '',
  };
}
