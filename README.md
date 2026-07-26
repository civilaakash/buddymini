# Buddy Mini Transformer

**Four AI personalities in one tiny web app — including a mood-reader I trained from scratch that runs entirely in your browser.**

## 🧢 [**→ Talk to Maamoo, your local bhai**](https://civilaakash.github.io/buddymini/?mode=maamoo)

Tell him your Monday is already ruined. See what he says.

*or* [open the full app](https://civilaakash.github.io/buddymini/) — no signup, no install, nothing saved.

---

## The four modes

| Mode | What it does |
|------|-------------|
| 🫂 **Buddy** | A warm friend who listens when the day has been heavy |
| 😄 **Wit** | Finds the funny in your everyday chaos — with a roast dial from gentle to savage |
| 🧢 **Maamoo** | Your local bhai. Replies in Hinglish, half comedy and half pep talk |
| 🎭 **Vibe Check** | Reads the emotion in your words — **8.3M parameters, running on your device** |

---

## The interesting part

**Vibe Check is not an API call.** It is a transformer I built and trained from scratch — the architecture, the training loop, the tokenizer, all of it — then exported to ONNX so it runs **inside your browser tab**.

- **8.3 million parameters** (about 20,000× smaller than a frontier model)
- **~88% accuracy** on the `dair-ai/emotion` validation set
- **Zero server calls** — your text never leaves your device
- Model published here: [`AakashakaAkku/vibe-check-emotion`](https://huggingface.co/AakashakaAkku/vibe-check-emotion)

Buddy, Wit and Maamoo are personality work on top of Llama 3.3 running via Groq — prompt engineering, not fine-tuning, which was the right call for three distinct voices.

---

## How it is built

```
Browser  ──►  Cloudflare Pages (static hosting, free)
              │
              ├─►  Cloudflare Worker  ──►  Groq API (Llama 3.3 70B)
              │      keeps the API key server-side, streams tokens back
              │
              └─►  vibe.onnx  ──►  runs on-device via onnxruntime-web
```

- **Frontend** — one HTML file, no framework, no build step
- **Backend** — a single Cloudflare Worker (`worker.js`)
- **On-device model** — ONNX, int8 quantised, ~8 MB
- **Cost to run** — ₹0. Free tiers all the way down.

---

## Why I built it

I am a product manager who wanted to stop hand-waving about how LLMs work. So I built one small enough to understand completely, and shipped it publicly so the learning had consequences.

Things it taught me that reading could not:
- Small models are wildly underrated — 8M parameters is enough to be useful
- Personality beats features; people did not want "a chatbot", they wanted one that talks back
- Streaming does not make anything faster, but it changes everything about how fast it *feels*

---

## Try to break it

Genuinely — tell Wit it is not funny, ask Maamoo something in English, feed Vibe Check something sarcastic. The failures are the interesting part, and they all end up in my eval set.

Feedback → [LinkedIn](https://www.linkedin.com/in/aakash-varshney-6ab9911b/)

---

*Built over a few weekends. Apache-2.0.*
