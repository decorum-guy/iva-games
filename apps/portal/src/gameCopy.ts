import type { Game, Language } from "./types";

export function gameTitle(game: Game, lang: Language) {
  return (
    {
      district: ["Район", "District"],
      harbor: ["Гавань", "Harbor"],
      overdrive: ["Форсаж", "Overdrive"],
      remorse: ["Remorse", "Remorse"],
      colossus: ["Колосс", "Colossus"],
      "platform-lab": ["Пробный стол", "Practice table"],
    }[game.gameId]?.[lang === "ru" ? 0 : 1] || game.title
  );
}
export function gameDescription(gameId: string, lang: Language) {
  return (
    {
      district: [
        "Общий город, личные планы и сделки, о которых вы ещё поспорите.",
        "A shared city, personal plans and deals worth arguing about.",
      ],
      harbor: [
        "Грузы, корабли и торговля. Узнайте, кто лучше договорится.",
        "Cargo, ships and trading. Find out who makes the best deals.",
      ],
      remorse: [
        "Шахматы, в которых у каждого взятия есть последствия.",
        "Chess where every capture has consequences.",
      ],
      overdrive: [
        "Шахматные фигуры с характером и собственными усилениями.",
        "Chess pieces with their own character and abilities.",
      ],
      colossus: [
        "Восемь фигур против босса. Читайте его замысел, разбивайте броню и разыгрывайте карты — сами или вдвоём.",
        "Eight pieces against a boss. Read its intent, break its armour and play your cards — alone or together.",
      ],
      "platform-lab": [
        "Выберите число, перехитрите друзей и наберите больше очков за три раунда.",
        "Pick a number, outsmart your friends and score the most points in three rounds.",
      ],
    }[gameId]?.[lang === "ru" ? 0 : 1] || ""
  );
}

