import { createPhotoAnalysisHandlers } from '../../../server/photo-analysis.ts';
import { createOllamaPhotoAnalysisEngine } from '../../../server/photo-analysis-ollama.ts';

export const runtime = 'nodejs';

const engine = process.env.LIGHT_FORGE_PHOTO_ENGINE === 'ollama' ? createOllamaPhotoAnalysisEngine() : undefined;
const handlers = createPhotoAnalysisHandlers(engine);

export const GET = handlers.GET;
export const POST = handlers.POST;
