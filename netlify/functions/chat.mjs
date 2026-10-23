const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Použij POST požadavek." }, 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({
      error: "AI ještě není připojená. V nastavení Netlify přidej proměnnou GEMINI_API_KEY a znovu nasaď web."
    }, 503);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Požadavek se nepodařilo přečíst." }, 400); }

  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
    return json({ error: "Konverzace má neplatný formát. Začni novou konverzaci." }, 400);
  }

  const contents = [];
  for (const item of body.messages) {
    if (!item || !["user", "model"].includes(item.role) || typeof item.content !== "string") {
      return json({ error: "Zpráva má neplatný formát." }, 400);
    }
    const content = item.content.trim().slice(0, 6000);
    if (!content) continue;
    const previous = contents[contents.length - 1];
    if (previous && previous.role === item.role) {
      previous.parts[0].text += "\n\n" + content;
    } else {
      contents.push({ role: item.role, parts: [{ text: content }] });
    }
  }

  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return json({ error: "Poslední zpráva musí být od uživatele." }, 400);
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  let upstream;
  try {
    upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "Jsi Kivora, užitečný univerzální AI asistent. Odpovídej přirozenou, srozumitelnou češtinou, pokud uživatel nepíše jiným jazykem. Pomáhej s učením, psaním, nápady, plánováním a programováním. Pokud si nejsi jistý, přiznej nejistotu a nevymýšlej fakta. U důležitých zdravotních, právních a finančních rozhodnutí upozorni, že je vhodné ověřit informace u kvalifikovaného odborníka. Respektuj bezpečnost a soukromí. Nežádej uživatele o hesla, ověřovací kódy ani citlivé osobní údaje. Odpovídej přehledně, ale ne zbytečně dlouze."
            }]
          },
          contents,
          generationConfig: { temperature: 0.75, maxOutputTokens: 1800 }
        })
      }
    );
  } catch {
    return json({ error: "Nepodařilo se připojit k AI službě. Zkus to později." }, 502);
  }

  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    if (upstream.status === 429) {
      return json({ error: "AI právě dosáhla limitu požadavků. Počkej chvíli a zkus to znovu." }, 429);
    }
    const providerMessage = result?.error?.message;
    return json({
      error: providerMessage
        ? `AI služba: ${String(providerMessage).slice(0, 260)}`
        : "AI služba požadavek odmítla. Zkontroluj API klíč a název modelu."
    }, 502);
  }

  const reply = result?.candidates?.[0]?.content?.parts
    ?.map(part => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();

  if (!reply) return json({ error: "AI nevrátila textovou odpověď. Zkus otázku přeformulovat." }, 502);
  return json({ reply });
};
