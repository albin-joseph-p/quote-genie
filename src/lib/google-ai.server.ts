// Google AI Studio (Gemini) direct REST caller — fallback provider.
// Uses user-supplied GOOGLE_AI_API_KEY. No SDK, no GCP project setup.

export async function callGeminiAiStudio(params: {
  apiKey: string;
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  mimeType: string;
  model?: string;
}): Promise<string> {
  const model = params.model ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: params.systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: params.userText },
          { inline_data: { mime_type: params.mimeType, data: params.imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    if (res.status === 429) {
      throw new Error("Google AI Studio rate limit / free-tier quota reached. Try again in a minute.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Google AI API key is invalid or lacks access. Regenerate it at aistudio.google.com/apikey.");
    }
    throw new Error(`Google AI Studio error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return text.trim();
}
