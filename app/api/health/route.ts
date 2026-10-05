export function GET() {
  return Response.json(
    { application: "lectureflow", version: "1.2.0" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
