import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChatRequest {
  message: string;
  conversationId?: string;
  userId: string;
  companyBuId: string;
}

interface FoundryResponse {
  answer: string;
  tables?: Array<{
    title: string;
    columns: string[];
    rows: (string | number)[][];
  }>;
  kpis?: {
    roi_usd?: number;
    opex_avoided_usd?: number;
    revenue_impact_usd?: number;
    time_to_value_days?: number;
    confidence_0_1?: number;
  };
}

interface GeminiImageResponse {
  imageUrl: string;
}

async function callFoundryAgent(message: string): Promise<FoundryResponse> {
  const foundryBaseUrl = Deno.env.get("FOUNDARY_AGENT_BASE_URL");
  const foundryApiKey = Deno.env.get("FOUNDARY_AGENT_API_KEY");
  const foundryAgentId = Deno.env.get("FOUNDARY_AGENT_ID");

  if (!foundryBaseUrl || !foundryApiKey || !foundryAgentId) {
    throw new Error("Missing Foundry Agent configuration");
  }

  const response = await fetch(`${foundryBaseUrl}/agents/${foundryAgentId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${foundryApiKey}`,
    },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error(`Foundry Agent API error: ${response.statusText}`);
  }

  return await response.json();
}

async function generateImage(prompt: string): Promise<GeminiImageResponse> {
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  const geminiModel = Deno.env.get("GEMINI_IMAGE_MODEL") || "nano-banana-pro";

  if (!geminiApiKey) {
    throw new Error("Missing Gemini API configuration");
  }

  const spanishPrompt = `Genera una visualización profesional de consultoría estilo Accenture/Palantir con la siguiente descripción:

${prompt}

Especificaciones técnicas:
- Paleta de colores: Verde corporativo #1A4A28, blanco, gris claro, acentos dorados
- Estilo: Dashboard ejecutivo o infografía de consultoría
- Alta resolución y claridad
- Etiquetas y textos en español
- Diseño limpio y moderno

La imagen debe ser photorealista o al estilo de presentaciones ejecutivas de alto nivel.`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateImage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiApiKey,
    },
    body: JSON.stringify({
      prompt: spanishPrompt,
      numberOfImages: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.statusText}`);
  }

  const data = await response.json();
  const imageBase64 = data.images?.[0]?.imageBase64;

  if (!imageBase64) {
    throw new Error("No image generated");
  }

  const imageBuffer = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  const imageBlob = new Blob([imageBuffer], { type: "image/png" });

  const storageUrl = Deno.env.get("SUPABASE_URL");
  const storageKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!storageUrl || !storageKey) {
    throw new Error("Missing Supabase configuration");
  }

  const fileName = `${crypto.randomUUID()}.png`;
  const uploadResponse = await fetch(`${storageUrl}/storage/v1/object/ai-images/${fileName}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${storageKey}`,
      "Content-Type": "image/png",
    },
    body: imageBlob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Storage upload error: ${uploadResponse.statusText}`);
  }

  const imageUrl = `${storageUrl}/storage/v1/object/public/ai-images/${fileName}`;

  return { imageUrl };
}

function shouldGenerateImage(answer: string, kpis?: Record<string, unknown>): boolean {
  const hasNumericData = /\d+/.test(answer);
  const hasKPIs = kpis && Object.keys(kpis).length > 0;
  const hasTables = /table|chart|graph|visualization/i.test(answer);

  return hasNumericData || hasKPIs || hasTables;
}

function createImagePrompt(answer: string, kpis?: Record<string, unknown>): string {
  let prompt = "Visualización de análisis financiero del tesoro corporativo mostrando ";

  if (kpis) {
    const metrics = [];
    if (kpis.roi_usd) metrics.push(`ROI de $${(kpis.roi_usd as number).toLocaleString()}`);
    if (kpis.opex_avoided_usd) metrics.push(`OpEx evitado de $${(kpis.opex_avoided_usd as number).toLocaleString()}`);
    if (kpis.revenue_impact_usd) metrics.push(`impacto en ingresos de $${(kpis.revenue_impact_usd as number).toLocaleString()}`);

    if (metrics.length > 0) {
      prompt += metrics.join(", ");
    }
  } else {
    prompt += "métricas clave de flujo de caja, cuentas por pagar y por cobrar";
  }

  prompt += ". Incluye gráficos de barras o líneas, KPIs destacados en tarjetas, y usa iconos profesionales.";

  return prompt;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { message, conversationId, userId, companyBuId }: ChatRequest = await req.json();

    if (!message || !userId || !companyBuId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const foundryResponse = await callFoundryAgent(message);

    let imageData = null;
    if (shouldGenerateImage(foundryResponse.answer, foundryResponse.kpis)) {
      try {
        const imagePrompt = createImagePrompt(foundryResponse.answer, foundryResponse.kpis);
        const { imageUrl } = await generateImage(imagePrompt);
        imageData = {
          promptUsed: imagePrompt,
          imageUrl,
          altText: "Visualización generada por AI de análisis del tesoro",
        };
      } catch (imageError) {
        console.error("Image generation failed:", imageError);
      }
    }

    const response = {
      conversationId: conversationId || crypto.randomUUID(),
      answerMarkdown: foundryResponse.answer,
      extractedTables: foundryResponse.tables || [],
      kpis: foundryResponse.kpis || {},
      image: imageData,
    };

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing request:", error);

    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
        fallback: true,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
