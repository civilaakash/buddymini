# Buddy Mini Transformer

**Five distinct AI characters in one responsive web app. Pick the person who fits the moment and continue where you left off.**

## [Open the app](https://civilaakash.github.io/buddymini/)

No signup or install.

| Character | What they do |
|---|---|
| **Buddy** | Listens when the day has been heavy—English only |
| **Maamoo** | A warm neighbourhood bhai who answers in Roman Hinglish |
| **Naina** | Playful and affectionate; matches English or Roman Hinglish |
| **Neil** | Calm, steady, and attentive; matches English or Roman Hinglish |
| **Wit** | Finds the joke in the situation, with a **Gentle → Balanced → Full Roast** humour meter |

Each character keeps a separate local conversation. The app never shares one character's chat history with another.

## Architecture

```text
Browser
  ├─ responsive character UI + local conversation history
  └─ Cloudflare Pages Worker
       └─ Groq API (Llama 3.3 70B, with 8B fallback)
```

- **Frontend:** plain HTML, CSS, and JavaScript
- **Backend:** one Cloudflare Pages Worker; API key remains server-side
- **Hosting:** Cloudflare Pages with a GitHub Pages mirror
- **Cost:** free-tier infrastructure

The separate Vibe Check emotion model remains published at
[`AakashakaAkku/vibe-check-emotion`](https://huggingface.co/AakashakaAkku/vibe-check-emotion).

Feedback → [LinkedIn](https://www.linkedin.com/in/aakash-varshney-6ab9911b/)
