// All odds are integer percentages. Times count completed rounds, excluding setup.
export const newsCatalogVersion = 'district-news@1';
export type NewsPreset = 'easy' | 'medium' | 'hard' | 'very-hard';
export type NewsResource = 'wood' | 'brick' | 'grain' | 'wool' | 'ore';
export type NewsGroup = 'good' | 'setback' | 'hazard';
export type NewsStage = 'forecast' | 'update' | 'confirmed' | 'applied' | 'success' | 'cancelled';
export type NewsText = { ru: string; en: string };
type Range = [number, number];
export type NewsCoupon = 'free-road' | 'upgrade-discount' | 'card-discount' | 'bank-exchange' | 'restore';
export type NewsEffect =
  | { op: 'grant'; basis: 'owner' | 'level'; resources: Partial<Record<NewsResource, number>>; cap: number }
  | { op: 'production'; resource: NewsResource | 'all'; mode: 'bonus' | 'stop' | 'reduce'; amount: number; floor: number; rounds: number }
  | { op: 'port'; mode: 'discount' | 'suspend'; amount: number; rounds: number }
  | { op: 'surcharge'; action: 'build-or-upgrade' | 'road' | 'upgrade' | 'sea'; resource: NewsResource; amount: number; rounds: number }
  | { op: 'coupon'; kind: NewsCoupon; rounds: number }
  | { op: 'renovate' | 'damage'; levels: number };

export interface NewsTemplate {
  templateId: string;
  group: NewsGroup;
  chain: 'none' | 'hazard' | 'positive' | 'epidemic';
  minRound: number;
  cooldown: number;
  exposure: 'woodland' | 'floodplain' | 'coastal' | null;
  headlines: Partial<Record<NewsStage, NewsText>>;
  // Mechanical copy belongs to applied stages only. Forecasts carry a headline, zone and deadline.
  description: NewsText;
  successDescription?: NewsText;
  effects: NewsEffect[];
  successEffects: NewsEffect[];
  outcomeChance: number | null;
  outcomeDelay: Range | null;
  hideEarlySector: boolean;
}

export interface NewsProfile {
  id: NewsPreset;
  version: string;
  name: NewsText;
  summary: NewsText;
  interval: Range;
  firstRound: Range;
  weights: Record<NewsGroup, number>;
  warningWeights: [number, number, number];
  spreadChance: number;
  positiveChainWeight: number;
  hazardCooldown: number;
  confirmedDelay: number;
  cityMeteorChance: number;
  cityMeteorMinRound: number;
  bonusOwnerCap: number;
  protectionCost: { brick: number; ore: number };
}
const tr = (ru: string, en: string): NewsText => ({ ru, en });
function profile(id: NewsPreset, name: NewsText, summary: NewsText, interval: Range, weights: [number, number, number],
  warningWeights: [number, number, number], spreadChance: number, cityMeteorChance = 0): NewsProfile {
  const [good, setback, hazard] = weights;
  return { id, version: 'district-news-profile@1', name, summary, interval,
    firstRound: [Math.max(3, interval[0]), Math.max(3, interval[1])], weights: { good, setback, hazard },
    warningWeights, spreadChance, positiveChainWeight: 20, hazardCooldown: 3, confirmedDelay: 2,
    cityMeteorChance, cityMeteorMinRound: 10, bonusOwnerCap: 4, protectionCost: { brick: 1, ore: 1 } };
}
export const newsProfiles: Record<NewsPreset, NewsProfile> = {
  easy: profile('easy', tr('Легко', 'Easy'), tr('Редкие новости, чаще хорошие.', 'Infrequent news, mostly good.'), [5, 7], [80, 20, 0], [20, 30, 50], 10),
  medium: profile('medium', tr('Средне', 'Medium'), tr('Новости иногда помогают, иногда мешают.', 'Occasional help and setbacks.'), [3, 5], [60, 35, 5], [10, 25, 65], 25),
  hard: profile('hard', tr('Сложно', 'Hard'), tr('Частые новости. Стоит готовиться к неприятностям.', 'Frequent news. Prepare for setbacks.'), [2, 4], [40, 45, 15], [20, 40, 40], 40),
  'very-hard': profile('very-hard', tr('Очень сложно', 'Very hard'), tr('Частые новости, больше риска и катастроф.', 'Frequent news with greater risk of disasters.'), [2, 3], [25, 50, 25], [35, 45, 20], 55, 10),
};

function entry(templateId: string, group: NewsGroup, applied: NewsText, description: NewsText, effects: NewsEffect[]): NewsTemplate {
  return { templateId, group, chain: 'none', minRound: 3, cooldown: 0, exposure: null, headlines: { applied }, description,
    effects, successEffects: [], outcomeChance: null, outcomeDelay: null, hideEarlySector: false };
}

const aid: NewsEffect = { op: 'grant', basis: 'owner', resources: { wood: 1, brick: 1 }, cap: 1 };
const coupon = (kind: NewsCoupon): NewsEffect => ({ op: 'coupon', kind, rounds: 1 });
const production = (resource: NewsResource | 'all', mode: 'bonus' | 'stop' | 'reduce', floor = 0, rounds = 1): NewsEffect =>
  ({ op: 'production', resource, mode, amount: 1, floor, rounds });
const surcharge = (action: 'build-or-upgrade' | 'road' | 'upgrade' | 'sea', resource: NewsResource): NewsEffect =>
  ({ op: 'surcharge', action, resource, amount: 1, rounds: 1 });

function hazard(templateId: string, exposure: NewsTemplate['exposure'], forecast: NewsText, confirmed: NewsText,
  applied: NewsText, cancelled: NewsText, description: NewsText, outcomeChance = 80, hideEarlySector = false): NewsTemplate {
  return { ...entry(templateId, 'hazard', applied, description, [{ op: 'damage', levels: 1 }]), chain: 'hazard', minRound: 6,
    exposure, headlines: { forecast, confirmed, applied, cancelled }, outcomeChance, outcomeDelay: [4, 5], hideEarlySector };
}

export const newsCatalog: NewsTemplate[] = [
  entry('G01', 'good', tr('Геологи нашли рудную жилу', 'Geologists strike ore'), tr('Банк распределил руду по уровням зданий в секторе, до четырёх единиц на владельца.', 'The bank allocated ore by building level, up to four per owner.'), [
    { op: 'grant', basis: 'level', resources: { ore: 1 }, cap: 4 },
  ]),
  entry('G02', 'good', tr('В квартал приехали грузовики с помощью', 'Supply trucks reach the neighbourhood'), tr('Банк распределил по единице древесины и кирпича на владельца.', 'The bank allocated one wood and one brick per owner.'), [aid]),
  entry('G03', 'good', tr('Фермеры собрали рекордный урожай', 'Farmers bring in a record harvest'), tr('К зерновой выработке сектора на один круг добавилась единица.', 'Grain production here gains one for a round.'), [production('grain', 'bonus')]),
  { ...entry('G04', 'good', tr('Мэр подписал план реновации', 'The mayor signs the renovation plan'), tr('Город оплатил законные улучшения зданий сектора.', 'The city funded eligible building upgrades in this sector.'), [{ op: 'renovate', levels: 1 }]), minRound: 6, cooldown: 6 },
  entry('G05', 'good', tr('Порт устроил праздник торговли', 'The port opens its trade fair'), tr('Портам сектора на круг снизили ставку обмена на единицу. Лучший курс — 2 к 1.', 'Port exchange rates improve by one for a round, down to two for one.'), [{ op: 'port', mode: 'discount', amount: 1, rounds: 1 }]),
  entry('G06', 'good', tr('Город оплатил дорожные работы', 'The city funds roadworks'), tr('Владельцы получили купон на одну дорогу в секторе. Купон действует круг и покрывает обычную цену.', 'Owners received a voucher for the regular cost of one road here, valid for a round.'), [coupon('free-road')]),
  entry('G07', 'good', tr('Застройщикам выдали субсидию', 'Builders receive a subsidy'), tr('Владельцы получили скидку в одну руду на улучшение в секторе. Срок — один круг.', 'Owners received a one-ore discount on one upgrade here, valid for a round.'), [coupon('upgrade-discount')]),
  entry('G08', 'good', tr('Университет открыл грант', 'The university opens its grant'), tr('Владельцы получили скидку в одну руду на одну тактическую карту. Срок — один круг.', 'Owners received a one-ore discount on one tactic card, valid for a round.'), [coupon('card-discount')]),
  entry('G09', 'good', tr('На площади открылась меновая ярмарка', 'Exchange stalls open in the square'), tr('Владельцы получили один обмен через банк по курсу 2 к 1 на ближайший круг.', 'Owners received one two-for-one bank exchange for the next round.'), [coupon('bank-exchange')]),
  entry('G10', 'good', tr('Соседи открыли фонд восстановления', 'Neighbours open a repair fund'), tr('Купон на один круг покрывает восстановление одного потерянного из-за новости уровня в секторе.', 'A one-round voucher covers one building level previously lost to a news event here.'), [coupon('restore')]),
  entry('B01', 'setback', tr('Стая собак заняла улицы квартала', 'A pack of dogs takes over the streets'), tr('В секторе на один круг остановилось производство.', 'Production in this sector has stopped for one round.'), [production('all', 'stop')]),
  entry('B02', 'setback', tr('Бригады ушли на больничный', 'Work crews call in sick'), tr('На круг улучшенные здания потеряли одну единицу выработки. Базовая единица сохранилась.', 'Upgraded buildings produce one less for a round, keeping their base unit.'), [production('all', 'reduce', 1)]),
  entry('B03', 'setback', tr('Вредители добрались до амбаров', 'Pests reach the granaries'), tr('В секторе на круг остановилась выработка зерна.', 'Grain production in this sector has stopped for one round.'), [production('grain', 'stop')]),
  entry('B04', 'setback', tr('Шторм закрыл портовую биржу', 'A storm closes the port exchange'), tr('Льготный курс портов сектора приостановлен на круг. Банк работает.', 'Port discounts here are suspended for one round. The bank is open.'), [{ op: 'port', mode: 'suspend', amount: 1, rounds: 1 }]),
  entry('B05', 'setback', tr('Ливень размыл стройплощадки', 'Rain washes out the building sites'), tr('В этом круге первая стройка здания или улучшение в секторе стоит каждому на один кирпич дороже.', 'Each player pays one extra brick for their first building or upgrade here this round.'), [surcharge('build-or-upgrade', 'brick')]),
  entry('B06', 'setback', tr('Ремонт дорог затянулся', 'Roadworks run overtime'), tr('В этом круге первая новая дорога в секторе стоит каждому на одну древесину дороже.', 'Each player pays one extra wood for their first road here this round.'), [surcharge('road', 'wood')]),
  entry('B07', 'setback', tr('Ветер остановил тяжёлые краны', 'High winds idle the cranes'), tr('В этом круге первое улучшение в секторе стоит каждому на одну руду дороже.', 'Each player pays one extra ore for their first upgrade here this round.'), [surcharge('upgrade', 'ore')]),
  entry('B08', 'setback', tr('Туман задержал портовые бригады', 'Fog delays the harbour crews'), tr('В этом круге первый морской путь в секторе стоит каждому на одну шерсть дороже.', 'Each player pays one extra wool for their first sea route here this round.'), [surcharge('sea', 'wool')]),
  hazard('H01', 'woodland', tr('Спасатели заметили дым над лесом', 'Rangers spot smoke over the woods'), tr('Огонь движется к кварталу', 'Fire is heading into the neighbourhood'), tr('Пожар прошёл по лесной окраине', 'Fire sweeps through the woodland fringe'), tr('Пожар у леса потушили', 'The woodland fire is out'), tr('В лесной зоне завершилась проверка повреждений.', 'The woodland damage assessment is complete.')),
  hazard('H02', 'floodplain', tr('Река поднимается', 'The river is rising'), tr('Река выйдет из берегов', 'The river will breach its banks'), tr('Паводок затопил низины', 'Floodwater reaches the lowlands'), tr('Уровень воды пошёл на спад', 'River levels are falling'), tr('В пойме завершилась проверка повреждений.', 'The floodplain damage assessment is complete.')),
  hazard('H03', 'coastal', tr('В море заметили большую волну', 'A large wave forms offshore'), tr('Цунами достигнет берега', 'A tsunami will reach the coast'), tr('Волна обрушилась на побережье', 'The wave reaches the coast'), tr('Волна потеряла силу в море', 'The wave dissipates offshore'), tr('На побережье завершилась проверка повреждений.', 'The coastal damage assessment is complete.')),
  hazard('H04', null, tr('Астрономы заметили небесного гостя', 'Astronomers spot a visitor in the sky'), tr('Траектория подтверждена', 'The impact trajectory is confirmed'), tr('Метеоритный удар', 'Meteor impact'), tr('Небесный гость прошёл мимо', 'The meteor passes by'), tr('В зоне удара завершилась проверка повреждений.', 'The impact damage assessment is complete.'), 75, true),
  {
    ...entry('P01', 'good', tr('В квартале началась нефтеразведка', 'Oil prospectors arrive in town'), tr('Город компенсирует разведочные работы. Кирпичная выработка сектора получила прибавку на два круга.', 'The city is compensating exploration work. Brick production here is boosted for two rounds.'), [production('brick', 'bonus', 0, 2)]),
    chain: 'positive', outcomeChance: 60, outcomeDelay: [2, 4],
    headlines: { applied: tr('В квартале началась нефтеразведка', 'Oil prospectors arrive in town'), success: tr('Месторождение найдено', 'Prospectors strike oil'), cancelled: tr('Разведка завершена без находки', 'Prospectors return empty-handed') },
    successDescription: tr('Банк распределил кирпичи по уровням зданий, до четырёх на владельца.', 'The bank allocated bricks by building level, up to four per owner.'),
    successEffects: [{ op: 'grant', basis: 'level', resources: { brick: 1 }, cap: 4 }],
  },
  {
    ...entry('P02', 'good', tr('Квартал в финале городского конкурса', 'The neighbourhood makes the city shortlist'), tr('Владельцы получили скидку в одну руду на улучшение в секторе. Срок — один круг.', 'Owners received a one-ore upgrade discount here, valid for a round.'), [coupon('upgrade-discount')]),
    chain: 'positive', outcomeChance: 65, outcomeDelay: [2, 3],
    headlines: { applied: tr('Квартал в финале городского конкурса', 'The neighbourhood makes the city shortlist'), success: tr('Город одобрил финансирование улиц', 'The city funds new streets'), cancelled: tr('Финансирование перенесли', 'Funding has been deferred') },
    successDescription: tr('Банк распределил стройматериалы. Владельцам выдан купон на дорогу на следующий круг.', 'The bank allocated materials. Owners received a road voucher for the next round.'),
    successEffects: [aid, coupon('free-road')],
  },
  {
    ...entry('E01', 'setback', tr('В квартале вспышка загадочной хвори', 'A mystery illness hits the neighbourhood'), tr('В секторе на круг включилось снижение выработки на единицу.', 'Production in this sector is reduced by one for a round.'), [production('all', 'reduce')]),
    chain: 'epidemic', outcomeDelay: [2, 3], successEffects: [production('all', 'reduce')],
    headlines: { applied: tr('В квартале вспышка загадочной хвори', 'A mystery illness hits the neighbourhood'), forecast: tr('Хворь может распространиться по городу', 'The illness may spread citywide'), update: tr('Город следит за риском распространения', 'The city monitors the risk of spread'), success: tr('Вспышка охватила город', 'The outbreak has spread citywide'), cancelled: tr('Вспышку удалось локализовать', 'The outbreak is contained') },
    successDescription: tr('По всему городу на круг включилось снижение выработки на единицу.', 'Citywide production is reduced by one for a round.'),
  },
];

const allowedResources = ['wood', 'brick', 'grain', 'wool', 'ore'];
const allowedCoupons: NewsCoupon[] = ['free-road', 'upgrade-discount', 'card-discount', 'bank-exchange', 'restore'];
const natural = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const positive = (n: unknown): n is number => natural(n) && n > 0;
const percent = (n: unknown): n is number => natural(n) && n <= 100;
const range = (r: unknown): boolean => Array.isArray(r) && r.length === 2 && positive(r[0]) && positive(r[1]) && r[0] <= r[1];
const validText = (value: NewsText | undefined): boolean => !!value && [value.ru, value.en].every(line =>
  typeof line === 'string' && line.trim().length > 0 && !/[<>]/u.test(line));

function validEffect(effect: NewsEffect): boolean {
  if (!effect || typeof effect !== 'object' || ('rounds' in effect && !positive(effect.rounds))) return false;
  switch (effect.op) {
    case 'grant': {
      const quantities = Object.entries(effect.resources ?? {});
      return ['level', 'owner'].includes(effect.basis) && positive(effect.cap) && quantities.length > 0 &&
        quantities.every(([resource, n]) => allowedResources.includes(resource) && positive(n));
    }
    case 'production':
      return [...allowedResources, 'all'].includes(effect.resource) && ['bonus', 'stop', 'reduce'].includes(effect.mode) &&
        positive(effect.amount) && natural(effect.floor) && positive(effect.rounds);
    case 'port':
      return ['discount', 'suspend'].includes(effect.mode) && positive(effect.amount) && positive(effect.rounds);
    case 'surcharge':
      return ['build-or-upgrade', 'road', 'upgrade', 'sea'].includes(effect.action) && allowedResources.includes(effect.resource) &&
        positive(effect.amount) && positive(effect.rounds);
    case 'coupon':
      return allowedCoupons.includes(effect.kind) && positive(effect.rounds);
    case 'renovate':
    case 'damage':
      return effect.levels === 1;
    default:
      return false;
  }
}

/** Validate candidate or pinned data before exposing it to rule operators. Throws on invalid input. */
export function validateNewsCatalog(templates: readonly NewsTemplate[] = newsCatalog): void {
  const ids = new Set<string>();
  const groupByChain = { hazard: 'hazard', positive: 'good', epidemic: 'setback' } as const;
  const allowedStages: NewsStage[] = ['forecast', 'update', 'confirmed', 'applied', 'success', 'cancelled'];
  for (const template of templates) {
    const fail = () => { throw new Error('Invalid District news template: ' + template?.templateId); };
    if (!template || !/^[GBHPE][0-9]{2,}$/u.test(template.templateId) || ids.has(template.templateId) ||
        !['good', 'setback', 'hazard'].includes(template.group) || !['none', 'hazard', 'positive', 'epidemic'].includes(template.chain) ||
        !positive(template.minRound) || !natural(template.cooldown) ||
        ![null, 'woodland', 'floodplain', 'coastal'].includes(template.exposure) ||
        typeof template.hideEarlySector !== 'boolean' ||
        !template.headlines || !validText(template.headlines.applied) || !validText(template.description) ||
        !Object.entries(template.headlines).every(([stage, line]) => allowedStages.includes(stage as NewsStage) && validText(line)) ||
        !Array.isArray(template.effects) || !template.effects.length || !Array.isArray(template.successEffects) ||
        ![...template.effects, ...template.successEffects].every(validEffect)) fail();
    if (template.chain === 'none') {
      if (template.outcomeChance !== null || template.outcomeDelay !== null || template.successEffects.length > 0) fail();
    } else {
      if (template.group !== groupByChain[template.chain] || !range(template.outcomeDelay) ||
          !validText(template.headlines.cancelled) || (template.chain === 'epidemic' ? template.outcomeChance !== null : !percent(template.outcomeChance))) fail();
      if (template.chain === 'hazard') {
        if (!validText(template.headlines.forecast) || !validText(template.headlines.confirmed)) fail();
      } else {
        if (!validText(template.headlines.success) || !validText(template.successDescription) || !template.successEffects.length) fail();
        if (template.chain === 'epidemic' && (!validText(template.headlines.forecast) || !validText(template.headlines.update))) fail();
      }
    }
    ids.add(template.templateId);
  }
  if (!ids.size) throw new Error('Empty District news catalog');
}

export function validateNewsProfile(p: NewsProfile): void {
  const weights = (values: number[]) => values.length === 3 && values.every(percent) && values.reduce((sum, n) => sum + n, 0) === 100;
  if (!p || !['easy', 'medium', 'hard', 'very-hard'].includes(p.id) || !p.version ||
      !validText(p.name) || !validText(p.summary) || !range(p.interval) || !range(p.firstRound) || p.firstRound[0] < 3 ||
      !p.weights || !weights([p.weights.good, p.weights.setback, p.weights.hazard]) || !Array.isArray(p.warningWeights) ||
      !weights(p.warningWeights) || ![p.spreadChance, p.positiveChainWeight, p.cityMeteorChance].every(percent) ||
      ![p.hazardCooldown, p.confirmedDelay, p.cityMeteorMinRound, p.bonusOwnerCap, p.protectionCost?.brick, p.protectionCost?.ore].every(positive)) {
    throw new Error('Invalid District news profile: ' + p?.id);
  }
}
validateNewsCatalog();
Object.values(newsProfiles).forEach(validateNewsProfile);
