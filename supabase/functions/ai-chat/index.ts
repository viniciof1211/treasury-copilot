import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ChatRequest {
  message: string;
  conversationId?: string;
  threadId?: string;  // Azure AI Foundry thread ID for conversation continuity
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

// Cache the resolved agent ID at module level
let cachedAgentId: string | null = null;

async function resolveAgentId(baseUrl: string, apiKey: string, agentName: string): Promise<string> {
  if (cachedAgentId) {
    console.log("Using cached agent ID:", cachedAgentId);
    return cachedAgentId;
  }

  console.log("Resolving agent ID for name:", agentName);
  const response = await fetch(`${baseUrl}/assistants?api-version=v1`, {
    method: "GET",
    headers: {
      "api-key": apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch agents: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const agents = data.data || [];
  
  const matchingAgent = agents.find((agent: { name: string }) => agent.name === agentName);
  
  if (!matchingAgent) {
    const availableNames = agents.map((agent: { name: string }) => agent.name).join(", ");
    throw new Error(`Agent '${agentName}' not found. Available agents: ${availableNames || "none"}`);
  }

  cachedAgentId = matchingAgent.id;
  console.log("Resolved agent ID:", cachedAgentId);
  return cachedAgentId;
}

async function callFoundryAgent(message: string, existingThreadId?: string): Promise<FoundryResponse & { threadId: string }> {
  const foundryBaseUrl = Deno.env.get("FOUNDARY_AGENT_BASE_URL");
  const foundryApiKey = Deno.env.get("FOUNDARY_AGENT_API_KEY");
  const foundryAgentId = Deno.env.get("FOUNDARY_AGENT_ID");
  const foundryAgentName = Deno.env.get("FOUNDARY_AGENT_NAME");

  if (!foundryBaseUrl || !foundryApiKey) {
    throw new Error("Missing Foundry Agent base URL or API key");
  }

  // Step 1: Resolve Agent ID (by name or use direct ID)
  let agentId: string;
  if (foundryAgentId) {
    console.log("Using direct agent ID from env:", foundryAgentId);
    agentId = foundryAgentId;
  } else if (foundryAgentName) {
    agentId = await resolveAgentId(foundryBaseUrl, foundryApiKey, foundryAgentName);
  } else {
    throw new Error("Either FOUNDARY_AGENT_ID or FOUNDARY_AGENT_NAME must be set");
  }

  // Step 2: Create or use existing Thread
  let threadId: string;
  if (existingThreadId) {
    console.log("Using existing thread ID:", existingThreadId);
    threadId = existingThreadId;
  } else {
    console.log("Creating new thread...");
    const threadResponse = await fetch(`${foundryBaseUrl}/threads?api-version=v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": foundryApiKey,
      },
      body: JSON.stringify({}),
    });

    if (!threadResponse.ok) {
      const errorText = await threadResponse.text();
      throw new Error(`Failed to create thread: ${threadResponse.status} ${errorText}`);
    }

    const threadData = await threadResponse.json();
    threadId = threadData.id;
    console.log("Created thread ID:", threadId);
  }

  // Step 3: Add User Message
  console.log("Adding user message to thread...");
  const messageResponse = await fetch(`${foundryBaseUrl}/threads/${threadId}/messages?api-version=v1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": foundryApiKey,
    },
    body: JSON.stringify({
      role: "user",
      content: message,
    }),
  });

  if (!messageResponse.ok) {
    const errorText = await messageResponse.text();
    throw new Error(`Failed to add message: ${messageResponse.status} ${errorText}`);
  }

  console.log("User message added successfully");

  // Step 4: Create a Run
  console.log("Creating run with agent ID:", agentId);
  const runResponse = await fetch(`${foundryBaseUrl}/threads/${threadId}/runs?api-version=v1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": foundryApiKey,
    },
    body: JSON.stringify({
      assistant_id: agentId,
    }),
  });

  if (!runResponse.ok) {
    const errorText = await runResponse.text();
    throw new Error(`Failed to create run: ${runResponse.status} ${errorText}`);
  }

  const runData = await runResponse.json();
  const runId = runData.id;
  console.log("Created run ID:", runId, "Status:", runData.status);

  // Step 5: Poll Run Status
  console.log("Polling run status...");
  const maxAttempts = 60; // 60 seconds timeout
  let attempts = 0;
  let runStatus = runData.status;

  while (runStatus !== "completed" && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    attempts++;

    const statusResponse = await fetch(`${foundryBaseUrl}/threads/${threadId}/runs/${runId}?api-version=v1`, {
      method: "GET",
      headers: {
        "api-key": foundryApiKey,
      },
    });

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      throw new Error(`Failed to poll run status: ${statusResponse.status} ${errorText}`);
    }

    const statusData = await statusResponse.json();
    runStatus = statusData.status;
    console.log(`Poll attempt ${attempts}: Run status = ${runStatus}`);

    if (runStatus === "failed" || runStatus === "cancelled" || runStatus === "expired") {
      const errorMessage = statusData.last_error?.message || "Unknown error";
      throw new Error(`Run ${runStatus}: ${errorMessage}`);
    }
  }

  if (runStatus !== "completed") {
    throw new Error(`Run timed out after ${maxAttempts} seconds`);
  }

  console.log("Run completed successfully");

  // Step 6: Get Messages
  console.log("Fetching messages...");
  const messagesResponse = await fetch(`${foundryBaseUrl}/threads/${threadId}/messages?api-version=v1&order=desc&limit=10`, {
    method: "GET",
    headers: {
      "api-key": foundryApiKey,
    },
  });

  if (!messagesResponse.ok) {
    const errorText = await messagesResponse.text();
    throw new Error(`Failed to get messages: ${messagesResponse.status} ${errorText}`);
  }

  const messagesData = await messagesResponse.json();
  const messages = messagesData.data || [];

  // Find the latest assistant message
  const assistantMessage = messages.find((msg: { role: string }) => msg.role === "assistant");

  if (!assistantMessage || !assistantMessage.content || assistantMessage.content.length === 0) {
    throw new Error("No assistant response found");
  }

  const answerText = assistantMessage.content[0]?.text?.value || "";
  console.log("Retrieved assistant answer, length:", answerText.length);

  // Return the response with threadId for continuity
  return {
    answer: answerText,
    threadId: threadId,
    // TODO: Parse tables and KPIs from the response if the agent provides structured data
  };
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
    const { message, conversationId, threadId, userId, companyBuId }: ChatRequest = await req.json();

    if (!message || !userId || !companyBuId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const foundryResponse = await callFoundryAgent(message, threadId);

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
      threadId: foundryResponse.threadId,  // Return thread ID for continuity
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
