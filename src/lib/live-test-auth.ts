export function hasValidLiveTestToken(request: Request) {
  const expected = process.env.LIVE_TEST_TOKEN;
  const supplied = request.headers.get("x-live-test-token");
  return Boolean(expected && supplied && supplied === expected);
}

export function liveTestUnauthorizedResponse() {
  return Response.json(
    { error: "The temporary Live test code is missing or incorrect." },
    { status: 401 }
  );
}
