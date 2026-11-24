'use client';

import type { ProductType } from '@/domain/project';
import type { SearchResult } from '@/visual-search/catalogue';
import { ExternalLinkIcon, FilePdfIcon } from '../icons';
import { categoryMeta, extractDisplayHost, productKindLabel } from './helpers';

type LuminaireVisualPlateProps = {
  result: SearchResult;
  selectedSku?: string;
  compact?: boolean;
};

function BlueprintGlyph({ kind }: { kind?: ProductType }) {
  switch (kind) {
    case 'chandelier':
      return (
        <svg viewBox="0 0 260 150" className="vs-plate-svg" aria-hidden="true">
          {/* Architectural chandelier suspension + multi-ring composition */}
          <line x1="88" y1="8" x2="172" y2="8" stroke="var(--accent)" strokeWidth="2.5" />
          <line x1="106" y1="8" x2="106" y2="54" stroke="var(--brass)" strokeWidth="1.2" strokeDasharray="3 3" />
          <line x1="154" y1="8" x2="154" y2="62" stroke="var(--brass)" strokeWidth="1.2" strokeDasharray="3 3" />
          <circle cx="106" cy="84" r="30" fill="none" stroke="var(--brass)" strokeWidth="2" />
          <circle cx="106" cy="84" r="24" fill="none" stroke="var(--brass)" strokeOpacity="0.38" strokeWidth="1" />
          <circle cx="152" cy="94" r="32" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle cx="152" cy="94" r="26" fill="none" stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="1" />
          {/* Dimension tick guides */}
          <line x1="68" y1="138" x2="192" y2="138" stroke="var(--ink-muted)" strokeWidth="1" />
          <line x1="68" y1="133" x2="68" y2="143" stroke="var(--ink-muted)" strokeWidth="1" />
          <line x1="192" y1="133" x2="192" y2="143" stroke="var(--ink-muted)" strokeWidth="1" />
        </svg>
      );
    case 'table':
      return (
        <svg viewBox="0 0 260 150" className="vs-plate-svg" aria-hidden="true">
          <circle cx="130" cy="68" r="32" fill="none" stroke="var(--brass)" strokeWidth="2.2" />
          <circle cx="130" cy="68" r="25" fill="none" stroke="var(--brass)" strokeOpacity="0.38" strokeWidth="1" />
          <line x1="130" y1="100" x2="130" y2="124" stroke="var(--accent)" strokeWidth="2" />
          <rect x="98" y="124" width="64" height="8" rx="3" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <line x1="62" y1="134" x2="198" y2="134" stroke="var(--ink-muted)" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
      );
    case 'pendant':
      return (
        <svg viewBox="0 0 260 150" className="vs-plate-svg" aria-hidden="true">
          <line x1="106" y1="10" x2="154" y2="10" stroke="var(--accent)" strokeWidth="2.5" />
          <line x1="130" y1="10" x2="130" y2="62" stroke="var(--brass)" strokeWidth="1.4" />
          <ellipse cx="130" cy="86" rx="46" ry="22" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <ellipse cx="130" cy="86" rx="36" ry="15" fill="none" stroke="var(--brass)" strokeWidth="1.4" />
        </svg>
      );
    case 'linear':
      return (
        <svg viewBox="0 0 260 150" className="vs-plate-svg" aria-hidden="true">
          <line x1="76" y1="12" x2="76" y2="74" stroke="var(--brass)" strokeWidth="1.3" />
          <line x1="184" y1="12" x2="184" y2="74" stroke="var(--brass)" strokeWidth="1.3" />
          <rect x="52" y="74" width="156" height="14" rx="7" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
          <line x1="64" y1="81" x2="196" y2="81" stroke="var(--brass)" strokeWidth="1.4" />
        </svg>
      );
    case 'wall':
      return (
        <svg viewBox="0 0 260 150" className="vs-plate-svg" aria-hidden="true">
          <line x1="90" y1="18" x2="90" y2="132" stroke="var(--ink-muted)" strokeWidth="1.2" strokeDasharray="4 4" />
          <rect x="90" y="58" width="14" height="34" rx="2" fill="none" stroke="var(--accent)" strokeWidth="2" />
          <circle cx="138" cy="75" r="28" fill="none" stroke="var(--brass)" strokeWidth="2" />
          <line x1="104" y1="75" x2="110" y2="75" stroke="var(--accent)" strokeWidth="2" />
        </svg>
      );
    case 'floor':
      return (
        <svg viewBox="0 0 260 150" className="vs-plate-svg" aria-hidden="true">
          <circle cx="130" cy="40" r="20" fill="none" stroke="var(--brass)" strokeWidth="2" />
          <line x1="130" y1="60" x2="130" y2="128" stroke="var(--accent)" strokeWidth="2" />
          <line x1="100" y1="128" x2="160" y2="128" stroke="var(--accent)" strokeWidth="2.5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 260 150" className="vs-plate-svg" aria-hidden="true">
          <circle cx="130" cy="75" r="34" fill="none" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.6" strokeDasharray="5 4" />
          <circle cx="130" cy="75" r="14" fill="none" stroke="var(--brass)" strokeWidth="1.8" />
          <line x1="130" y1="24" x2="130" y2="41" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.4" />
          <line x1="130" y1="109" x2="130" y2="126" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.4" />
          <line x1="79" y1="75" x2="96" y2="75" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.4" />
          <line x1="164" y1="75" x2="181" y2="75" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.4" />
        </svg>
      );
  }
}

export function LuminaireVisualPlate({
  result,
  selectedSku,
  compact = false,
}: LuminaireVisualPlateProps) {
  const meta = categoryMeta(result.category);
  const activeVariant =
    result.variants?.find(item => item.sku === selectedSku) ?? result.variants?.[0];
  const host = extractDisplayHost(result.source);
  const kind = productKindLabel(result.kind);

  return (
    <div className={`vs-plate ${compact ? 'vs-plate--compact' : ''}`}>
      <div className="vs-plate-top">
        <span className={`vs-pill vs-pill--${meta.tone}`}>{meta.shortLabel}</span>
        {result.documentUrl && (
          <a
            href={result.documentUrl}
            target="_blank"
            rel="noreferrer"
            className="vs-plate-pdf"
            title="Открыть официальный PDF техпаспорт"
          >
            <FilePdfIcon size={13} />
            <span>PDF</span>
          </a>
        )}
      </div>

      <div className="vs-plate-center">
        <BlueprintGlyph kind={result.kind} />
        <span className="vs-plate-caption">
          {kind ? `${kind} · ` : ''}
          Фотографии доступны на сайте источника
        </span>
      </div>

      <div className="vs-plate-bottom">
        <span className="vs-plate-meta mono">
          {activeVariant
            ? `${activeVariant.sku} · ${activeVariant.widthMm}×${activeVariant.depthMm}×${activeVariant.heightMm} мм`
            : host}
        </span>
        <a
          href={result.source}
          target="_blank"
          rel="noreferrer"
          className="vs-plate-ext"
        >
          <span>Фото на сайте</span>
          <ExternalLinkIcon size={12} />
        </a>
      </div>
    </div>
  );
}
