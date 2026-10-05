import { es } from "./es";
// Cusco-Collao only. Conservative everyday vocabulary; technical strings intentionally
// fall back to Spanish until reviewed by a qualified Cusco-Collao linguist.
export const qu = {
  ...es,
  home: "Qallariy",
  profile: "Ñuqa",
  activity: "Kuyuy",
  walk: "Puriy",
  run: "Phaway",
  vehicle: "Antawa",
  welcome: "Allin p'unchay",
  start: "Qallariy",
  back: "Kutiy",
  done: "Listo",
  language: "Simi",
  spanish: "Español",
  english: "English",
  quechua: "Quechua",
  time: "Pacha",
};
export const quechuaVariant = {
  name: "Quechua Cusco-Collao",
  locale: "qu-PE",
  reviewRequired: true,
};
