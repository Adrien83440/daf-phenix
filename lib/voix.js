// ============================================================================
//  Voix naturelle pour « Phénix en direct » : synthèse neuronale servie par la
//  fonction, le navigateur ne fait que jouer le son. Deux fournisseurs, au
//  choix selon la clé présente (ElevenLabs d'abord) :
//    ELEVENLABS_API_KEY   + ELEVENLABS_VOICE_ID (facultatif) + ELEVENLABS_MODEL (défaut eleven_flash_v2_5)
//    OPENAI_API_KEY       + OPENAI_TTS_VOICE (défaut nova)   + OPENAI_TTS_MODEL (défaut gpt-4o-mini-tts)
//  Sans clé : provider() vaut "" et l'outil se rabat sur la voix du navigateur.
// ============================================================================
"use strict";

function provider() {
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "";
}
function label() { return { elevenlabs: "ElevenLabs", openai: "OpenAI" }[provider()] || ""; }

let elevenVoice = "";
async function elevenVoiceId() {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (elevenVoice) return elevenVoice;
  // Sans identifiant fourni : on prend une voix de la bibliothèque du compte qui parle français, sinon la première.
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
  const j = await r.json();
  const voices = (j && j.voices) || [];
  const fr = voices.find(function (v) { return /fr/i.test(JSON.stringify((v.labels || {}))) || /fr/i.test(String((v.fine_tuning || {}).language || "")); });
  elevenVoice = (fr || voices[0] || {}).voice_id || "";
  if (!elevenVoice) throw new Error("Aucune voix ElevenLabs disponible : indique ELEVENLABS_VOICE_ID.");
  return elevenVoice;
}

// Renvoie { audio: Buffer, type: "audio/mpeg" }
async function synthese(text) {
  text = String(text || "").trim().slice(0, 1200);
  if (!text) throw new Error("Rien à dire.");
  const p = provider();
  if (!p) throw new Error("Aucune voix configurée (ELEVENLABS_API_KEY ou OPENAI_API_KEY).");
  const ctrl = new AbortController(); const timer = setTimeout(function () { ctrl.abort(); }, 20000);
  try {
    let r;
    if (p === "elevenlabs") {
      const voice = await elevenVoiceId();
      r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice) + "?output_format=mp3_44100_64", {
        method: "POST", signal: ctrl.signal,
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text: text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5", language_code: "fr", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true } })
      });
    } else {
      r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST", signal: ctrl.signal,
        headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts", voice: process.env.OPENAI_TTS_VOICE || "nova", input: text, response_format: "mp3", instructions: "Parle en français, voix chaleureuse, naturelle et posée, comme un ami qui s'y connaît. Rythme tranquille." })
      });
    }
    if (!r.ok) { let msg = ""; try { msg = (await r.text()).slice(0, 200); } catch (e) {} throw new Error("Voix " + label() + " : erreur " + r.status + (msg ? " " + msg : "")); }
    const audio = Buffer.from(await r.arrayBuffer());
    if (!audio.length) throw new Error("Voix " + label() + " : réponse vide.");
    return { audio: audio, type: "audio/mpeg" };
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "La voix met trop de temps à répondre." : (e.message || String(e)));
  } finally { clearTimeout(timer); }
}

module.exports = { provider, label, synthese, _reset: function () { elevenVoice = ""; } };
