import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const hasEndpoint = Boolean(process.env.AZURE_OPENAI_ENDPOINT);
  const hasApiKey = Boolean(process.env.AZURE_OPENAI_API_KEY);
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5.6-sol";

  const ok = hasEndpoint && hasApiKey;

  return NextResponse.json(
    {
      status: ok ? "ok" : "error",
      azureEndpoint: hasEndpoint ? "present" : "missing",
      azureApiKey: hasApiKey ? "present" : "missing",
      deployment,
      model: deployment,
    },
    { status: 200 },
  );
}
