import { createPhotoAnalysisHandlers } from '../../../server/photo-analysis.ts';

export const runtime = 'nodejs';

const handlers = createPhotoAnalysisHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
