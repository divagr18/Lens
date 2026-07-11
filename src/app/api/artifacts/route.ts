import { createCloudTextArtifact } from "@/lib/cloud-text-artifact";
import { createOmniVisualArtifact, shouldUseOmniFlash } from "@/lib/omni-flash";
import { ArtifactRequest } from "@/lib/travel-types";

export async function POST(request: Request) {
  const body = (await request.json()) as ArtifactRequest;
  const artifact = shouldUseOmniFlash(body.type)
    ? await createOmniVisualArtifact(body)
    : await createCloudTextArtifact(body);
  return Response.json({ artifact });
}
