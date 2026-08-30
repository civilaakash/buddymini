// In-browser Vibe Check: runs the from-scratch 8M emotion transformer on-device (ONNX Runtime Web).
// Faithful port of emotion.py's analyze_day + occlusion attribution. Your text never leaves the browser.

const LABELS = ["sadness","joy","love","anger","fear","surprise","neutral"];
const POS = new Set(["joy","love"]);
const NEG = new Set(["sadness","anger","fear"]);
const STOP = new Set(("a an and or but so then than as at by for from in into of on to up out if is am are was were be been "+
  "being this that these those it its it's i i'm im you your my me we they he she his her their our do did does "+
  "have has had will would can could should just really very too about get got there here what when how why all "+
  "one no not with the yeah okay ok like feel feeling really today day again ever never still right something "+
  "someone thing things way going went make made want wanted know think thought said say tell told time much many "+
  "lot first new next now also even more most only over after before").split(" "));

let _sess = null, _vocab = null, _maxLen = 64, _in = "ids", _out = null, _ready = null;

function vibeReady(){
  if (_ready) return _ready;
  _ready = (async () => {
    if (window.ort && ort.env && ort.env.wasm) {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
    }
    // Relative paths: the app is served from the root on Cloudflare Pages but
    // from /buddymini/ on GitHub Pages, and a leading slash breaks the latter.
    const [sess, vocab, meta] = await Promise.all([
      ort.InferenceSession.create("vibe.onnx?v=5"),
      fetch("vocab.json?v=5").then(r => r.json()),
      fetch("meta.json?v=5").then(r => r.json()).catch(() => ({})),
    ]);
    _sess = sess; _vocab = vocab;
    _maxLen = (meta && meta.max_len) || 64;
    _in = sess.inputNames[0]; _out = sess.outputNames[0];
  })();
  return _ready;
}

const tok = s => (String(s).toLowerCase().match(/[a-z']+/g) || []);
function softmax(a){ const m = Math.max(...a); const e = a.map(x => Math.exp(x - m)); const s = e.reduce((x,y)=>x+y,0); return e.map(x => x/s); }
const r1 = x => Math.round(x*10)/10;
const r3 = x => Math.round(x*1000)/1000;

async function logits(ids){
  const t = new ort.Tensor("int64", BigInt64Array.from(ids.map(x => BigInt(x))), [1, ids.length]);
  const out = await _sess.run({ [_in]: t });
  return Array.from(out[_out].data);
}

async function predict(text){
  const words = tok(text).slice(0, _maxLen);
  if (!words.length) return null;
  const ids = words.map(w => (w in _vocab) ? _vocab[w] : 1);
  const lg = await logits(ids);
  return { words, ids, probs: softmax(lg) };
}

async function attribution(ids, words, top){
  const base = (await logits(ids))[top];
  const out = [];
  for (let j = 0; j < ids.length; j++){
    const occ = ids.slice(); occ[j] = 0;
    out.push([words[j], r3(base - (await logits(occ))[top])]);
  }
  return out;
}

const splitSeg = text => String(text || "").split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);

// Faithful port of emotion.analyze_day
async function analyzeDay(segments){
  if (typeof segments === "string") segments = [segments];
  let flat = [];
  for (const s of (segments || [])) if (typeof s === "string") flat.push(...splitSeg(s));
  segments = flat.filter(s => s.trim());
  const empty = () => ({ distribution:{}, dominant:"neutral", valence:"calm", positivity:0, words:[], segments:0 });
  if (!segments.length) return empty();

  const N = LABELS.length;
  const agg = new Array(N).fill(0);
  let totalW = 0, emoSegs = 0, keyWords = [];
  for (const seg of segments){
    const p = await predict(seg);
    if (!p) continue;
    let top = 0; for (let i = 1; i < N; i++) if (p.probs[i] > p.probs[top]) top = i;
    if (LABELS[top] === "neutral") continue;   // skip filler
    emoSegs++;
    const w = p.ids.length;
    for (let i = 0; i < N; i++) agg[i] += p.probs[i]*w;
    totalW += w;
    for (const [word, wt] of await attribution(p.ids, p.words, top))
      if (wt > 0.15 && !STOP.has(word) && word.length > 1) keyWords.push([word, LABELS[top], r3(wt)]);
  }
  if (totalW === 0 || emoSegs === 0) return { ...empty(), segments: segments.length };

  const emoI = []; for (let i = 0; i < N; i++) if (LABELS[i] !== "neutral") emoI.push(i);
  const emoSum = emoI.reduce((s,i)=>s+agg[i], 0) || 1;
  const distribution = {}; emoI.forEach(i => distribution[LABELS[i]] = r1(agg[i]/emoSum*100));
  let dominant = emoI[0]; emoI.forEach(i => { if (agg[i] > agg[dominant]) dominant = i; });
  const posSum = emoI.filter(i => POS.has(LABELS[i])).reduce((s,i)=>s+agg[i], 0);
  const negSum = emoI.filter(i => NEG.has(LABELS[i])).reduce((s,i)=>s+agg[i], 0);
  const positivity = (posSum - negSum)/emoSum;
  const valence = positivity > 0.15 ? "positive" : (positivity < -0.15 ? "negative" : "mixed");

  const seen = {};
  keyWords.sort((a,b)=>b[2]-a[2]).forEach(([word,emo,wt]) => { if (!(word in seen)) seen[word] = [word,emo,wt]; });
  return {
    distribution, dominant: LABELS[dominant], valence, positivity: r3(positivity),
    words: Object.values(seen).slice(0,12), segments: segments.length,
  };
}

window.vibeReady = vibeReady;
window.analyzeDay = analyzeDay;
// Raw model output, for the Vibe Check tab and for offline benchmarking.
// analyzeDay post-processes (drops neutral, renormalises), which is right for a
// daily summary and wrong for measuring the model against a test set.
window.vibePredict = predict;
window.vibeAttribution = attribution;
window.VIBE_LABELS = LABELS;
