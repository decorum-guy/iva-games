import type { BuildingKind, CityEvent, DistrictPhase, GoalId, ResourceKind } from "@iva-games/district";
import type { Language } from "./types";

export const goalCopy: Record<GoalId, { title: [string, string]; description: [string, string] }> = {
  variety: { title: ["Разные дела", "A bit of everything"], description: ["Дом, кафе и мастерская в вашей собственности.", "Own a house, a cafe and a workshop."] },
  network: { title: ["Своя сеть", "Your own chain"], description: ["Два кафе. Хотя бы одно — рядом с частным домом другого игрока.", "Own two cafes, with at least one beside another player's private house."] },
  green: { title: ["Зелёный двор", "Green courtyard"], description: ["Два ваших дома рядом с завершёнными парками.", "Own two houses, each beside a completed park."] },
  industry: { title: ["Промзона", "Industrial district"], description: ["Две ваши мастерские, у каждой нет соседних домов.", "Own two workshops, each with no neighbouring houses."] },
  sponsor: { title: ["Соавтор района", "Neighbourhood partner"], description: ["Внести ресурсы в два разных завершённых парка.", "Contribute resources to two different completed parks."] },
  quality: { title: ["Качество", "Quality first"], description: ["Два ваших здания уровня 2 разных типов.", "Own two level-2 buildings of different types."] },
};
export const phaseCopy: Record<DistrictPhase, [string, string]> = {
  goals: ["Ваш план на район", "Your plan for the district"],
  negotiation: ["Договоримся?", "Let's make a deal"],
  auction: ["Земля на торгах", "Land auction"],
  development: ["Пора строить", "Time to build"],
  finished: ["Итоги района", "District results"],
};
export function districtBotName(seatIndex: number, lang: Language) {
  return `${lang === "ru" ? "Бот" : "Bot"} ${seatIndex + 1}`;
}

export const buildActionCopy: Record<BuildingKind, [string, string]> = {
  house: ["Построить дом", "Build a house"],
  cafe: ["Построить кафе", "Build a cafe"],
  workshop: ["Построить мастерскую", "Build a workshop"],
};

export const buildingCopy: Record<BuildingKind, [string, string]> = {
  house: ["Дом", "House"], cafe: ["Кафе", "Cafe"], workshop: ["Мастерская", "Workshop"],
};
export const resourceCopy: Record<ResourceKind, [string, string]> = {
  coins: ["Монеты", "Coins"], materials: ["Материалы", "Materials"], crews: ["Бригады", "Crews"],
};
export const localized = (copy: [string, string], lang: Language): string => copy[lang === "ru" ? 0 : 1];
export function eventCopy(event: CityEvent, lang: Language): { title: string; description: string } {
  const copy: Record<CityEvent["kind"], [[string, string], [string, string]]> = {
    ordinary: [["Обычный день", "An ordinary day"], ["Район живёт своей жизнью.", "Business as usual in the district."]],
    filming: [["Съёмочная группа", "Film crew"], ["Каждое кафе получает ещё 1 монету дохода.", "Every cafe earns 1 extra coin."]],
    fair: [["Дворовая ярмарка", "Courtyard fair"], ["Дом у готового парка получает ещё 1 монету.", "A house beside a completed park earns 1 extra coin."]],
    boom: [["Строительный ажиотаж", "Building boom"], ["Каждая мастерская производит ещё 1 материал.", "Every workshop produces 1 extra material."]],
    traffic: [["Пробки", "Traffic jam"], ["Каждое кафе получает на 1 монету меньше.", "Every cafe earns 1 coin less."]],
    roadworks: [["Перекопали не ту улицу", "Wrong street dug up"], [`Здания в строке ${event.row} получают на 1 монету меньше.`, `Buildings in row ${event.row} earn 1 coin less.`]],
  };
  return { title: localized(copy[event.kind][0], lang), description: localized(copy[event.kind][1], lang) };
}
