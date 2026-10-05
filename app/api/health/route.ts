export function GET() {
  return Response.json(
    { application: "lectureflow", version: "1.2.1" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
