export function GET(): Response {
  return Response.json({ status: 'ok', geometryVersion: 1 });
}
