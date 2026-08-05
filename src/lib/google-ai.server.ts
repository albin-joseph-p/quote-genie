// Google AI Studio (Gemini) direct REST caller — fallback provider.
// Uses user-supplied GOOGLE_AI_API_KEY. No SDK, no GCP project setup.

export type GeminiExample = {
  imageBase64: string;
  mimeType: string;
  outputJson: string;
  /** Images of the expected output (AI reads the text off them). */
  outputImages?: { base64: string; mimeType: string }[];
};

export async function callGeminiAiStudio(params: {
  apiKey: string;
  systemPrompt: string;
  userText: string;
  imageBase64?: string;
  mimeType?: string;
  model?: string;
  /** Few-shot training samples (preset documents + their correct output). */
  examples?: GeminiExample[];
}): Promise<string> {
  const model = params.model ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  const exampleTurns = (params.examples ?? []).flatMap((ex) => {
    const outImgs = ex.outputImages ?? [];
    return [
      {
        role: "user",
        parts: [
          { text: "TRAINING EXAMPLE — this is the source document to extract." },
          { inline_data: { mime_type: ex.mimeType, data: ex.imageBase64 } },
          ...(outImgs.length
            ? [
                {
                  text: "The following image(s) show the CORRECT expected output for the document above. Read the text off them and treat those exact values, columns and conventions as the target result.",
                },
                ...outImgs.map((o) => ({
                  inline_data: { mime_type: o.mimeType, data: o.base64 },
                })),
              ]
            : []),
        ],
      },
      {
        role: "model",
        parts: [
          {
            text:
              ex.outputJson && ex.outputJson !== "{}"
                ? ex.outputJson
                : "Understood — I will produce JSON matching the expected-output image exactly in structure and value conventions.",
          },
        ],
      },
    ];
  });


  const body = {
    systemInstruction: { parts: [{ text: params.systemPrompt }] },
    contents: [
      ...exampleTurns,
      {
        role: "user",
        parts: [
          { text: params.userText },
          ...(params.imageBase64 && params.mimeType
            ? [{ inline_data: { mime_type: params.mimeType, data: params.imageBase64 } }]
            : []),
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
