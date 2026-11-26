"""Arithmetic probes for the proposed Colossus v0.1 design, not a game engine.

No movement, range, boss AI, casualties, promotions, card play or player skill
is simulated. Attack schedules assume the original army is alive and can always
hit: optimistic arithmetic series, not predicted match lengths.
Run: python tools/design/check_colossus_balance.py
"""

from fractions import Fraction
from itertools import permutations
from math import ceil
import json

HP = {"king": 20, "queen": 6, "rook": 4, "bishop": 3, "knight": 3,
      "pawn_c": 2, "pawn_e": 2, "pawn_g": 2}
BOSSES = {"regent": (12, 28), "spire": (6, 24), "archivist": (8, 24)}
DIFFICULTIES = {"initiate": Fraction(4, 5), "knight": Fraction(1),
                "veteran": Fraction(23, 20), "abyss": Fraction(27, 20)}
BASE_DECK = {
    "bandage": 1, "stone_skin": 1, "sharp_edge": 1, "armor_tip": 1,
    "focus": 0, "reposition": 1, "minor_vow": 3, "field_hospital": 2,
    "wedge": 2, "formation": 4, "counterorder": 3, "marble_vow": 5,
}


def attack(armor, health, unit, exposure=False):
    """One proposed unit attack, assuming it connects; all arithmetic is exact."""
    armor_before = armor
    if unit == "rook":
        armor -= min(armor, 1)  # pure armor removal, no HP overflow
        damage = 3
    elif unit == "bishop":
        damage = 2 if armor_before else 3
    elif unit == "queen":
        damage = 3
    elif unit == "king":
        damage = 1
    else:
        damage = 2
    damage += int(exposure)
    absorbed = min(armor, damage)
    armor -= absorbed
    health = max(0, health - (damage - absorbed))
    return armor, health


def best_volley(armor, health, slots, exposure=False):
    """Enumerate distinct unit activations; geometry deliberately absent."""
    best = (armor + health, armor, health, ())
    for order in permutations(HP, slots):
        a, h = armor, health
        used = []
        for unit in order:
            if not h:
                break
            a, h = attack(a, h, unit, exposure)
            used.append(unit)
        candidate = (a + h, a, h, tuple(used))
        if candidate < best:
            best = candidate
    return best[1], best[2], best[3]


def optimistic_schedule(armor, health, slots, opening_rounds=1, limit=24):
    """Greedy maximum-damage series; not a spatial battle or a win-rate test."""
    a, h = armor, health
    trace = []
    for round_number in range(1, limit + 1):
        order = ()
        if round_number > opening_rounds:
            a, h, order = best_volley(a, h, slots, round_number % 4 == 0)
        trace.append({"round": round_number, "armor": a, "hp": h,
                      "attacks": list(order)})
        if h == 0:
            return {"rounds": round_number, "trace": trace}
    return {"rounds": None, "trace": trace}


def damage_packets(health, shield, packets, invulnerable=False):
    for damage in packets:
        if invulnerable or health == 0:
            continue
        blocked = min(shield, damage)
        shield -= blocked
        health = max(0, health - (damage - blocked))
    return health, shield


def checks():
    cases = []

    def check(name, actual, expected):
        assert actual == expected, (name, actual, expected)
        cases.append({"name": name, "actual": actual, "expected": expected})

    check("army_hp", sum(HP.values()), 42)
    check("base_deck_size", len(BASE_DECK), 12)
    check("base_deck_cost", sum(BASE_DECK.values()), 24)
    check("rook_last_armor", attack(1, 20, "rook"), (0, 17))
    check("bishop_crosses_armor", attack(1, 20, "bishop"), (0, 19))
    check("bishop_bare_hp", attack(0, 20, "bishop"), (0, 17))
    a, h = 6, 20
    for unit in ("rook", "queen", "bishop"):
        a, h = attack(a, h, unit)
    check("mixed_three_attack_damage", 26 - (a + h), 10)
    a, h = 6, 20
    for unit in ("rook", "queen", "bishop"):
        a, h = attack(a, h, unit, True)
    check("mixed_recovery_three_attack_damage", 26 - (a + h), 13)
    check("guard_is_consumed_across_packets", damage_packets(2, 1, [1, 1]), (1, 0))
    check("unguarded_pawn_two_packets", damage_packets(2, 0, [1, 1]), (0, 0))
    check("one_hit_into_guard", damage_packets(2, 1, [2]), (1, 0))
    check("invulnerability_preserves_shield", damage_packets(2, 2, [3, 3], True), (2, 2))
    check("cards_seen_by_round_10", min(12, 3 + 10 - 1), 12)
    check("ten_round_focus_generation_with_focus_card", 3 + 9 + 2, 14)
    check("campaign_king_hp_supply_upper_bound", 20 + 4 + 4, 28)
    return cases


def main():
    cases = checks()
    pools = {name: {boss: {"armor": ceil(a * multiplier), "hp": ceil(h * multiplier)}
                    for boss, (a, h) in BOSSES.items()}
             for name, multiplier in DIFFICULTIES.items()}
    schedules = {}
    for name, multiplier in DIFFICULTIES.items():
        schedules[name] = {}
        for boss, (a, h) in BOSSES.items():
            schedules[name][boss] = {
                str(slots): optimistic_schedule(ceil(a * multiplier), ceil(h * multiplier), slots)["rounds"]
                for slots in (1, 2, 3)
            }
    volleys = {}
    for slots in (1, 2, 3, 4):
        for exposure in (False, True):
            samples = []
            for a in range(0, 21):
                na, nh, order = best_volley(a, 100, slots, exposure)
                samples.append({"armor_before": a, "damage": a + 100 - na - nh,
                                "order": list(order)})
            maximum = max(x["damage"] for x in samples)
            volleys[f"{slots}_attacks_{'recovery' if exposure else 'ordinary'}"] = {
                "max_damage": maximum,
                "examples": [x for x in samples if x["damage"] == maximum][:2],
            }
    print(json.dumps({
        "method": "Exact arithmetic and optimistic nonspatial attack series; no complete games simulated",
        "checks_passed": len(cases), "checks": cases,
        "boss_pools": pools,
        "optimistic_rounds_after_one_opening_round": schedules,
        "volley_bounds": volleys,
        "legendary_seen_probability": {
            str(r): str(Fraction(min(9, max(0, r - 1)), 9)) for r in (1, 2, 4, 6, 10)
        },
        "focus_generated_upper_bound": {
            str(r): {"without_focus_card": r + 2, "with_focus_card": r + 4} for r in (4, 8, 10, 12, 20, 24)
        },
        "card_count_resource_upper_bound": {
            str(r): max(n for n in range(min(r, len(BASE_DECK)) + 1)
                        if sum(sorted(BASE_DECK.values())[:n]) <= r + 4)
            for r in (10, 12, 15, 20)
        },
        "ten_cheapest_base_cards_cost": sum(sorted(BASE_DECK.values())[:10]),
        "king_only_damage_24_rounds_one_empty_opening_no_cards": sum(
            1 + int(r % 4 == 0) for r in range(2, 25)
        ),
        "normal_regent_two_attack_trace": optimistic_schedule(12, 28, 2)["trace"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
