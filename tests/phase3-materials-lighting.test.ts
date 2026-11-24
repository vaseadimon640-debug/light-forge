import assert from 'node:assert/strict';
import test from 'node:test';
import type { GeminiPhotoAnalysis } from '../src/ai/gemini-contract.ts';
import {
  calculateLightingTiers,
  computeLuminousLengthMm,
  validateElectricalCompatibility,
} from '../src/domain/lighting-calculator.ts';
import { suggestMaterialsFromAiPhoto } from '../src/domain/material-library.ts';
import { createMyline } from '../src/domain/myline.ts';
import { newComponent, newProject, projectSchema } from '../src/domain/project.ts';
import { buildQuickRfq } from '../src/rfq/quick.ts';

test('deterministic lighting calculator computes realistic MYLINE U-arc luminous length, wattage, and lumens', () => {
  const myline = createMyline();
  const largeArc = myline.components[0]; // 900x60x700 mm
  const smallArc = myline.components[1]; // 700x60x550 mm

  const largeLen = computeLuminousLengthMm(largeArc);
  const smallLen = computeLuminousLengthMm(smallArc);

  // U-arc: pi*450 + 2*(700-450) = 1914 mm; pi*350 + 2*(550-350) = 1500 mm
  assert.equal(largeLen.lengthMm, 1914);
  assert.equal(smallLen.lengthMm, 1500);

  const calc = calculateLightingTiers({
    component: largeArc,
    diffuser: 'opalPolycarbonate',
    application: 'architectural',
  });
  assert.equal(calc.canCalculate, true);
  assert.equal(calc.luminousLengthSource, 'dimensions');
  assert.equal(calc.diffuserLossPct, 24);
  assert.equal(calc.tiers.length, 3);

  const [economy, standard, high] = calc.tiers;
  assert.ok(economy.wattsW < standard.wattsW && standard.wattsW < high.wattsW);
  assert.ok(economy.lumensLm < standard.lumensLm && standard.lumensLm < high.lumensLm);
  // Standard architectural tier matches real-world MYLINE 59W / 4779 lm physics closely
  assert.ok(standard.wattsW >= 54 && standard.wattsW <= 66, `unexpected standard watts: ${standard.wattsW}`);
  assert.ok(standard.lumensLm >= 4200 && standard.lumensLm <= 5400, `unexpected standard lumens: ${standard.lumensLm}`);
});

test('lighting calculator refuses to invent wattage when dimensions are missing unless explicit manual length is supplied', () => {
  const emptyComp = newComponent('ring');
  const withoutDims = calculateLightingTiers({
    component: emptyComp,
    diffuser: 'opalPolycarbonate',
    application: 'dining',
  });
  assert.equal(withoutDims.canCalculate, false);
  assert.equal(withoutDims.luminousLengthMm, null);
  assert.equal(withoutDims.tiers.length, 0);

  const withOverride = calculateLightingTiers({
    component: emptyComp,
    diffuser: 'frostedGlass',
    application: 'dining',
    manualLengthOverrideMm: 2000,
  });
  assert.equal(withOverride.canCalculate, true);
  assert.equal(withOverride.luminousLengthSource, 'manual_override');
  assert.equal(withOverride.luminousLengthMm, 2000);
});

test('electrical compatibility validator catches DALI without driver, DC without PSU, TRIAC load, and efficacy anomalies', () => {
  const project = newProject();
  const comp = project.components[0];
  comp.light.dimming = 'DALI-2';
  comp.light.driver = 'none';
  comp.light.voltage = '24 V DC';
  comp.light.ip = 'IP65';
  comp.light.watts = { value: 20, source: 'user' };
  comp.light.lumens = { value: 5000, source: 'user' }; // 250 lm/W unrealistic

  const diags = validateElectricalCompatibility(comp, project);
  assert.ok(diags.some((d) => d.id === 'dimming-needs-driver' && d.severity === 'error'));
  assert.ok(diags.some((d) => d.id === 'dc-requires-psu' && d.severity === 'error'));
  assert.ok(diags.some((d) => d.id === 'ip-driver-protection' && d.severity === 'warning'));
  assert.ok(diags.some((d) => d.id === 'efficacy-too-high' && d.severity === 'warning'));

  // Valid DALI + remote driver + 220-240V AC + realistic efficacy -> driver headroom OK
  comp.light.driver = 'remote';
  comp.light.voltage = '220–240 V AC';
  comp.light.ip = 'IP20';
  comp.light.lumens = { value: 1800, source: 'user' };
  const validDiags = validateElectricalCompatibility(comp, project);
  assert.equal(validDiags.some((d) => d.severity === 'error'), false);
  assert.ok(validDiags.some((d) => d.id === 'driver-headroom-ok' && d.severity === 'ok'));
});

test('AI photo palette mapper pre-selects brass/leather finishes honestly as Estimated', () => {
  const mockPhoto: GeminiPhotoAnalysis = {
    apiVersion: 1,
    model: 'gemini-3.8-flash',
    analyzedAt: new Date().toISOString(),
    cached: false,
    deepAnalysis: false,
    photoName: 'myline-gold.jpg',
    widthPx: 1000,
    heightPx: 800,
    possibleBrand: { value: null, status: 'unknown' },
    possibleCollection: { value: null, status: 'unknown' },
    fixtureType: { value: 'arc', status: 'estimated' },
    shape: { value: 'U-образная дуга', status: 'estimated' },
    elementCount: { value: 1, status: 'estimated' },
    primaryColors: ['Тёплая золотая латунь', 'Тёмно-коричневый'],
    suspectedMaterial: {
      key: 'solidBrass',
      label: 'Латунь',
      status: 'estimated',
      uncertaintyReason: 'Подтвердить массив латуни на фабрике.',
    },
    suspectedFinish: { key: 'brushedBrass', label: 'Шлифованная латунь', status: 'estimated' },
    hasDiffuser: { value: true, description: 'Опаловый линейный рассеиватель', status: 'estimated' },
    suspensionType: { value: 'Кожаные ремни', status: 'estimated' },
    ceilingMountVisible: { value: 'Да', status: 'estimated' },
    lightDirection: { value: 'up', status: 'estimated' },
    structuralDetails: [],
    geometricFeatures: [],
    missingInformation: [],
    dimensionsCannotBeVerifiedFromPhoto: true,
    unverifiableNotice: 'Размеры и материал требуют подтверждения.',
    sourceDisclaimer: 'Не интернет-поиск.',
    summary: 'Золотая подвесная дуга на кожаных ремнях.',
    warnings: [],
  };

  const suggestion = suggestMaterialsFromAiPhoto(mockPhoto);
  assert.ok(suggestion);
  assert.equal(suggestion.bodyMaterial, 'solidBrass');
  assert.ok(suggestion.suggestedFinishes.includes('brushedBrass'));
  assert.ok(suggestion.suggestedFinishes.includes('naturalSatinBrass'));
  assert.equal(suggestion.suspensionMaterial, 'genuineLeather');
  assert.equal(suggestion.diffuserMaterial, 'polycarbonate');
});

test('canonical projectSchema & Quick RFQ export new LED type, beam angle, driver, and voltage fields', () => {
  const project = newProject();
  project.components[0].light = {
    cct: { value: 3000, source: 'user' },
    cri: { value: 90, source: 'user' },
    ledType: 'cobLinear',
    watts: { value: 44, source: 'estimated' },
    lumens: { value: 3555, source: 'estimated' },
    directionId: 'down',
    beamAngleDeg: { value: 120, source: 'user' },
    voltage: '220–240 V AC',
    driver: 'remote',
    dimming: 'DALI-2',
    ip: 'IP20',
  };

  const parsed = projectSchema.parse(project);
  assert.equal(parsed.components[0].light.voltage, '220–240 V AC');
  assert.equal(parsed.components[0].light.driver, 'remote');
  assert.equal(parsed.components[0].light.ledType, 'cobLinear');
  assert.equal(parsed.components[0].light.beamAngleDeg?.value, 120);

  const rfq = buildQuickRfq({ project: parsed });
  const allText = rfq.sections
    .flatMap((s) => s.rows.flatMap((r) => r.map((cell) => (typeof cell === 'string' ? cell : `${cell[0]} ${cell[1]}`))))
    .join('\n');
  assert.match(allText, /Linear COB LED/);
  assert.match(allText, /120°/);
  assert.match(allText, /Remote driver · 220–240 V AC/);
});
