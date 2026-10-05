import type { Language } from "../types";
const locales: Record<Language, string> = {
  es: "es-PE",
  en: "en-US",
  qu: "qu-PE",
};
let language: Language = "es";
let volume = 0.8;
export const isSpeechSupported = () =>
  typeof window !== "undefined" && "speechSynthesis" in window;
export const setVoiceLanguage = (value: Language) => {
  language = value;
};
export const setVoiceVolume = (value: number) => {
  volume = Math.max(0, Math.min(1, value));
};
export const hasCompatibleVoice = (lang: Language) =>
  isSpeechSupported() &&
  speechSynthesis
    .getVoices()
    .some((v) => v.lang.toLowerCase().startsWith(lang));
export function speak(text: string) {
  if (!isSpeechSupported() || !hasCompatibleVoice(language)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locales[language];
  utterance.volume = volume;
  utterance.voice =
    speechSynthesis
      .getVoices()
      .find((v) => v.lang.toLowerCase() === locales[language].toLowerCase()) ??
    speechSynthesis
      .getVoices()
      .find((v) => v.lang.toLowerCase().startsWith(language)) ??
    null;
  if (speechSynthesis.pending) return;
  speechSynthesis.speak(utterance);
}
export const stopSpeaking = () => {
  if (isSpeechSupported()) speechSynthesis.cancel();
};
