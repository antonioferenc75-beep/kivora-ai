# Kivora AI

Kivora AI is a mobile-first Czech-language AI chat prototype. It calls Google's Gemini API through a Netlify Function so the API key is not exposed in browser code.

## Deploy from Android
1. Import this repository into Netlify at https://app.netlify.com/start and deploy.
2. Create a Gemini API key in Google AI Studio, subject to current eligibility, model availability, quotas and terms for your account.
3. In Netlify site settings, add an environment variable named `GEMINI_API_KEY` with your private key. Never commit it to GitHub or place it in browser code.
4. Redeploy and test by sending a question.

## Important
- Keep your API key secret; never paste it into a chat or public repository.
- Free-tier access and quotas can change; unlimited free use is not guaranteed.
- This is not live until deployed and configured with an API key.
- This prototype has no user accounts, no server-side saved conversations, and no robust public abuse/rate-limit protection. Conversation history is saved in the user's browser.
