const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

const SYSTEM_PROMPT = `Jsi Kivora, schopný a spolehlivý AI asistent.
- Pečlivě navazuj na předchozí zprávy v předaném chatu. Rozlišuj aktuální požadavek od starších témat a používej dříve sdělené údaje pouze tehdy, když jsou relevantní.
- Když uživatel odkazuje na předchozí krok, vyhodnoť dostupný kontext. Nevymýšlej si detaily, které v konverzaci nejsou.
- Odpovídej přirozeně v jazyce uživatele; pokud píše česky, používej srozumitelnou češtinu.
- Nejdřív přesně pochop zadání. U složitějších úkolů postupuj po jasných krocích a vysvětli důležité předpoklady.
- Buď konkrétní a užitečný. Vyhýbej se prázdným frázím a opakování otázky.
- Nikdy si nevymýšlej fakta, zdroje, citace, výsledky testů ani akce, které jsi neprovedl. Pokud něco nevíš nebo nemůžeš ověřit, řekni to.
- Pokud zadání není jasné a rozdíl zásadně ovlivní výsledek, polož jednu krátkou doplňující otázku; jinak uveď rozumný předpoklad a pokračuj.
- U aktuálních údajů upozorni, že mohou vyžadovat ověření. Nevydávej odhady za jistotu.
- U zdravotních, právních a finančních rozhodnutí jasně odliš obecné informace od odborné rady a doporuč ověřit důležité kroky u kvalifikovaného odborníka.
- Chraň soukromí. Nikdy nežádej hesla, ověřovací kódy ani zbytečné citlivé osobní údaje.
- Pokud uživatel žádá o kód, dbej na správnost, bezpečnost a vysvětli, kam patří, pokud to není zřejmé.
- Piš přehledně, s odrážkami tam, kde pomáhají. Odpověď přizpůsob délce a složitosti dotazu.`;

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Použij POST požadavek." }, 405);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({
      error: "AI ještě není připojená. V nastavení Netlify přidej proměnnou GEMINI_API_KEY a znovu nasaď web."
    }, 503);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Požadavek se nepodařilo přečíst. Zkus zprávu odeslat znovu." }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 30) {
    return json({ error: "Konverzace má neplatný formát. Začni novou konverzaci." }, 400);
  }

  const contents = [];
  let totalChars = 0;

  for (const item of body.messages) {
    if (!item || !["user", "model"].includes(item.role) || typeof item.content !== "string") {
      return json({ error: "Zpráva má neplatný formát." }, 400);
    }

    const content = item.content.trim().slice(0, 6000);
    if (!content) continue;
    totalChars += content.length;
    if (totalChars > 24000) {
      return json({ error: "Konverzace je příliš dlouhá. Začni novou nebo zkrať předchozí zprávy." }, 413);
    }

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

  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const modelsToTry = [...new Set([primaryModel, "gemini-3.5-flash-lite"])];
  let lastStatus = 502;
  let lastMessage = "";

  for (const model of modelsToTry) {
    let upstream;
    let result = {};

    try {
      upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: {
              temperature: 0.55,
              maxOutputTokens: 1600
            }
          })
        }
      );
      result = await upstream.json().catch(() => ({}));
    } catch {
      lastStatus = 502;
      lastMessage = "Spojení s AI službou se přerušilo nebo vypršel časový limit.";
      continue;
    }

    if (upstream.ok) {
      const reply = result?.candidates?.[0]?.content?.parts
        ?.map(part => typeof part.text === "string" ? part.text : "")
        .join("")
        .trim();

      if (reply) return json({ reply });
      lastStatus = 502;
      lastMessage = "AI tentokrát nevrátila textovou odpověď.";
      continue;
    }

    lastStatus = upstream.status;
    lastMessage = String(result?.error?.message || "");

    const temporary = upstream.status === 429 ||
      upstream.status >= 500 ||
      /high demand|overloaded|temporar|resource exhausted/i.test(lastMessage);

    if (temporary) continue;

    if (upstream.status === 400 || upstream.status === 403) {
      return json({
        error: "AI požadavek odmítla. Zkontroluj v Netlify API klíč a název modelu."
      }, 502);
    }

    return json({ error: "AI služba požadavek odmítla. Zkus to prosím později." }, 502);
  }

  if (lastStatus === 429) {
    return json({ error: "AI má právě vysoký provoz nebo jsi dosáhl limitu. Počkej chvíli a zkus to znovu." }, 429);
  }

  return json({
    error: lastMessage
      ? "Kivora se teď nemůže spojit s AI službou. Zkus to za chvíli znovu."
      : "AI je momentálně nedostupná. Zkus to prosím za chvíli."
  }, 502);
};
