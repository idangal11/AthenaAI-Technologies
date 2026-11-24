# AthenaAI Technologies

Landing page for AthenaAI Technologies: landing pages for businesses with a built-in AI chatbot. Hebrew by default, with an English toggle.

Single static file (`index.html`), served with GitHub Pages.

## AI chat

The chat in the "why" section talks to Claude through a small Cloudflare Worker in `chat-worker/`, which holds the API key and the business knowledge (`chat-worker/src/knowledge.js`). Setup steps are in `chat-worker/README.md`. Until `CHAT_ENDPOINT` in `index.html` is set, the chat answers with scripted replies.
