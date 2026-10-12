# BTL Paper Studio — free local AI version

This project classifies complete examination questions into Revised Bloom's Taxonomy levels (BTL 1–6) using a language model. **By default it uses Ollama running locally, so no paid API key is required.** Classification is a suggestion; teachers should review ambiguous results. The local prompt includes calibration examples and the server checks that the displayed BTL number and level name agree. This improves consistency but cannot guarantee perfect academic classification.

## One-time setup (Windows)

1. Install **Node.js 18 or newer**: https://nodejs.org/
2. Install **Ollama**: https://ollama.com/download
3. Open Command Prompt or PowerShell and download the model (this is a one-time download):

   ```powershell
   ollama pull qwen2.5:3b
   ```

   The model files take several GB of disk space. Keep Ollama running; its local service normally listens on `http://127.0.0.1:11434`.

4. Extract this ZIP. Open a terminal inside the `btl-paper-studio-ai` folder.
5. Install the app's dependency:

   ```powershell
   npm install
   ```

6. Start the website:

   ```powershell
   npm start
   ```

7. Open **http://localhost:3000** in your browser. Do not open `index.html` directly.

## Troubleshooting

- If classification says Ollama is not running, open the Ollama app and retry.
- If the model is missing, run `ollama pull qwen2.5:3b` in a terminal.
- If your computer struggles with this model, you can try a smaller model and set `OLLAMA_MODEL` in your environment before starting the server.
- Check `http://localhost:3000/api/health` to see whether the app can reach the local model service.
- The first classification may take longer while the model loads. No internet request is made to a paid AI API in the default local mode; downloading the model requires internet once.

## Optional API mode

If you already have a valid OpenAI API key and choose to use it, set `OPENAI_API_KEY` in your environment. When that variable is non-empty, the server uses OpenAI instead of Ollama. This is optional and may incur charges. Never put the key in `index.html` or commit it to GitHub.

## What stays the same

- Existing question-paper editor, live preview, marks, CO mapping and paper layout are preserved.
- Papers are stored in this browser's localStorage and do not automatically sync across devices.
- Question drafting remains template-based; the AI integration classifies questions, it does not turn the drafting feature into an AI writer.
- BTL is based on the full question, not only the action verb. The model may still be wrong; teacher review is required.
