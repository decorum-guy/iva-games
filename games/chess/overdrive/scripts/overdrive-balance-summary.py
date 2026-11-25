#!/usr/bin/env python3
"""Descriptive analysis of actual OVERDRIVE audit outputs; no simulated games.

Resampling estimates variation within this chosen engine/opening experiment,
not an external population of human players. Book experiments use an opening
cluster (both seeds/colour assignments/versions together), with opening+seed
as a secondary view. Free-opening experiments use a seed cluster.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import random
import statistics


def mean(xs):
    return statistics.mean(xs) if xs else None


def median(xs):
    return statistics.median(xs) if xs else None


def percentile(xs, p):
    if not xs:
        return None
    ordered = sorted(xs)
    rank = (len(ordered) - 1) * p
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (rank - lo)


def bootstrap_means(values, seed=261126, repeats=10000):
    if not values:
        return None
    rng = random.Random(seed)
    n = len(values)
    estimates = sorted(sum(values[rng.randrange(n)] for _ in range(n)) / n for _ in range(repeats))
    return {"estimate": mean(values), "clusters": n, "p025": percentile(estimates, .025), "p975": percentile(estimates, .975), "resamples": repeats}


def side_sum(s, key):
    return sum(s["stats"][key].values())


def first_ply(s, key):
    present = [x for x in s["stats"][key].values() if x is not None]
    return min(present) if present else None


def timing(group, key):
    values = [first_ply(s, key) for s in group]
    present = [v for v in values if v is not None]
    return {"gamesWithEvent": len(present), "games": len(group), "medianPlyAmongEventGames": median(present), "meanPlyAmongEventGames": mean(present), "min": min(present, default=None), "max": max(present, default=None)}


def tally_map(group, key):
    result = Counter()
    for s in group:
        result.update(s["stats"][key])
    return dict(sorted(result.items()))


def enrich(base, s):
    game = json.loads((base / (s["options"]["id"] + ".json")).read_text())
    rotations = rotation_promotions = 0
    rotation_games = False
    activation_records = []
    active_forms = {"white": None, "black": None}
    material_before = 0.0
    material_reversals = 0
    last_strong_leader = None
    for entry in game["log"]:
        events = entry["events"]
        side = entry["side"]
        ability = next((e for e in events if e["type"] == "ability"), None)
        if ability and ability["ability"] == "rotation":
            rotations += 1
            if any(e["type"] == "promotion" and e["forced"] for e in events):
                rotation_promotions += 1
                rotation_games = True
        activate = next((e for e in events if e["type"] == "form" and e["cause"] == "activate"), None)
        if activate:
            if active_forms[side] is not None:
                active_forms[side]["endedBy"] = "replaced"
            record = {"side": side, "ply": entry["ply"], "pieceId": activate["pieceId"], "materialLeadBefore": material_before * (1 if side == "white" else -1), "freeUses": 0, "ownFutureMoves": 0, "endedBy": None, "activationAbility": ability["ability"] if ability else None, "onTerminalPly": any(e["type"] == "outcome" for e in events), "fullRefund": entry["energyAfter"][side] == (10 if s["options"]["rulesVersion"] == "overdrive-v1" else 6)}
            activation_records.append(record)
            active_forms[side] = record
        elif active_forms[side] is not None:
            active_forms[side]["ownFutureMoves"] += 1
        if ability and ability["mode"] == "form" and active_forms[side] is not None:
            active_forms[side]["freeUses"] += 1
        for e in events:
            if e["type"] == "form" and e["cause"] in ("expire", "capture"):
                owner = e["side"]
                if active_forms[owner] is not None:
                    active_forms[owner]["endedBy"] = e["cause"]
                    active_forms[owner] = None
        material_before = entry["materialAfter"]
        leader = "white" if material_before >= 3 else "black" if material_before <= -3 else None
        if leader:
            if last_strong_leader and leader != last_strong_leader:
                material_reversals += 1
            last_strong_leader = leader
    for record in activation_records:
        if record["endedBy"] is None:
            record["endedBy"] = "unfinished" if s["unfinished"] else "game-end"
        record["ownerWon"] = None if not s["outcome"] or s["outcome"]["winner"] is None else s["outcome"]["winner"] == record["side"]
    action_tape = "\n".join(entry["command"] for entry in game["log"])
    return {"rotations": rotations, "rotationPromotions": rotation_promotions, "gameHasRotationPromotion": rotation_games, "activationRecords": activation_records, "materialLeadReversals3": material_reversals, "actionTapeSha256": hashlib.sha256(action_tape.encode()).hexdigest()}


def version_summary(group, enriched, free_opening):
    counts = Counter("unfinished" if s["outcome"] is None else s["outcome"]["winner"] or "draw" for s in group)
    n = len(group)
    outcome_counts = {key: counts[key] for key in ["white", "black", "draw", "unfinished"]}
    score_lower = (counts["white"] + counts["draw"] * .5) / n if n else None
    score_upper = (counts["white"] + counts["draw"] * .5 + counts["unfinished"]) / n if n else None
    reason = Counter(s["outcome"]["reason"] if s["outcome"] else "unfinished" for s in group)
    sums = {key: sum(side_sum(s, key) for s in group) for key in ["moves", "energyEarned", "energySpent", "energyWasted", "nominalCaptureEnergy", "nominalCheckEnergy", "atCapacityStarts", "captures", "checks", "impulses", "activations", "formUses", "fullRefundActivations", "forcedPromotions"]}
    abilities = tally_map(group, "abilities")
    moves = sums["moves"]
    nominal = sums["nominalCaptureEnergy"] + sums["nominalCheckEnergy"]
    records = [r for s in group for r in enriched[s["options"]["id"]]["activationRecords"]]
    first_records = [min(enriched[s["options"]["id"]]["activationRecords"], key=lambda r: r["ply"]) for s in group if enriched[s["options"]["id"]]["activationRecords"]]
    leads = [r["materialLeadBefore"] for r in first_records]
    first_outcomes = Counter("unfinished" if s["unfinished"] else "draw" if s["outcome"]["winner"] is None else "won" if s["firstActivatorWon"] else "lost" for s in group if s["firstActivator"])
    cluster_scores = defaultdict(list)
    opening_scores = defaultdict(list)
    if not counts["unfinished"]:
        for s in group:
            score = .5 if s["outcome"]["winner"] is None else 1 if s["outcome"]["winner"] == "white" else 0
            cluster_scores[(s["options"]["opening"], s["options"]["seed"])].append(score)
            opening_scores[s["options"]["opening"]].append(score)
    rotations = sum(enriched[s["options"]["id"]]["rotations"] for s in group)
    rotation_promotions = sum(enriched[s["options"]["id"]]["rotationPromotions"] for s in group)
    return {
        "games": n, "uniqueActionTapes": len({enriched[s["options"]["id"]]["actionTapeSha256"] for s in group}), "outcomes": outcome_counts, "outcomeReasons": dict(reason),
        "whiteScoreBoundsIncludingUnfinished": [score_lower, score_upper],
        "whiteScoreClusterBootstrapIfComplete": bootstrap_means([mean(values) for values in cluster_scores.values()]),
        "whiteScoreOpeningBootstrapIfComplete": None if free_opening else bootstrap_means([mean(values) for values in opening_scores.values()]),
        "plies": {"total": moves, "mean": mean([s["plies"] for s in group]), "median": median([s["plies"] for s in group]), "min": min([s["plies"] for s in group], default=None), "max": max([s["plies"] for s in group], default=None)},
        "timing": {key: timing(group, key) for key in ["firstEnergy", "firstImpulse", "firstActivation"]},
        "totals": sums, "abilities": abilities, "modes": tally_map(group, "modes"), "depth": tally_map(group, "depth"), "stopReasons": tally_map(group, "stopReasons"),
        "rates": {"abilityActionsPer100Plies": sum(abilities.values()) * 100 / moves if moves else None, "capacityStartsFraction": sums["atCapacityStarts"] / moves if moves else None, "wastedNominalEnergyFraction": sums["energyWasted"] / nominal if nominal else None},
        "rotation": {"actions": rotations, "promotionActions": rotation_promotions, "gamesWithPromotion": sum(enriched[s["options"]["id"]]["gameHasRotationPromotion"] for s in group)},
        "forms": {"activations": len(records), "onTerminalPly": sum(r["onTerminalPly"] for r in records), "withAnyFreeUse": sum(r["freeUses"] > 0 for r in records), "withTwoFreeUses": sum(r["freeUses"] >= 2 for r in records), "futureOwnMoves": sum(r["ownFutureMoves"] for r in records), "freeUses": sum(r["freeUses"] for r in records), "endedBy": dict(Counter(r["endedBy"] for r in records)), "activationAbilities": dict(Counter(r["activationAbility"] or "ordinary-move" for r in records)), "fullRefunds": sum(r["fullRefund"] for r in records)},
        "firstForm": {"games": len(first_records), "outcomes": dict(first_outcomes), "materialLeadBefore": {"mean": mean(leads), "median": median(leads), "positiveOver1": sum(x > 1 for x in leads), "within1": sum(abs(x) <= 1 for x in leads), "negativeBelow1": sum(x < -1 for x in leads)}},
        "materialLeadReversals3": {"total": sum(enriched[s["options"]["id"]]["materialLeadReversals3"] for s in group), "games": sum(enriched[s["options"]["id"]]["materialLeadReversals3"] > 0 for s in group)},
        "search": {"moves": sum(s["stats"]["searchMoves"] for s in group), "nodes": sum(s["stats"]["nodes"] for s in group), "summedWorkerSearchMs": sum(s["stats"]["searchMs"] for s in group)},
        "allReplaysVerified": all(s["replayVerified"] for s in group),
    }


def analyze(base, allow_partial=False):
    data = json.loads((base / "summary.json").read_text())
    summaries = data["summaries"]
    if data["completedGames"] != len(summaries):
        raise ValueError(f"Summary count mismatch: {base}")
    ids = [s["options"]["id"] for s in summaries]
    if len(set(ids)) != len(ids):
        raise ValueError(f"Duplicate job IDs: {base}")
    job_keys = [(s["options"]["rulesVersion"], s["options"]["opening"], s["options"]["seed"], s["options"]["swap"]) for s in summaries]
    if len(set(job_keys)) != len(job_keys):
        raise ValueError(f"Duplicate rule/opening/seed/colour jobs: {base}")
    complete = data["expectedGames"] == data["completedGames"]
    if not complete and not allow_partial:
        raise ValueError(f"Run incomplete ({data['completedGames']}/{data['expectedGames']}): {base}; use --allow-partial for a labelled interim report")
    if data["completedGames"] > data["expectedGames"]:
        raise ValueError(f"More completed games than expected: {base}")
    free_opening = data["settings"].get("openingPlies", 8) == 0
    groups = defaultdict(list)
    enriched = {}
    for s in data["summaries"]:
        groups[s["options"]["rulesVersion"]].append(s)
        enriched[s["options"]["id"]] = enrich(base, s)
    both_versions = set(groups) == {"overdrive-v1", "overdrive-v2"}
    if not both_versions and not allow_partial:
        raise ValueError(f"A paired rules comparison requires both v1 and v2: {base}")
    clusters = defaultdict(lambda: defaultdict(list))
    opening_clusters = defaultdict(lambda: defaultdict(list))
    for s in data["summaries"]:
        key = s["options"]["seed"] if free_opening else (s["options"]["opening"], s["options"]["seed"])
        clusters[key][s["options"]["rulesVersion"]].append(s)
        opening_clusters[s["options"]["opening"]][s["options"]["rulesVersion"]].append(s)
    paired_clusters = [g for g in clusters.values() if len(g.get("overdrive-v1", [])) == len(g.get("overdrive-v2", [])) == 2]
    pair_complete = len(paired_clusters) == len(clusters) and all({s["options"]["swap"] for s in g[v]} == {False, True} for g in paired_clusters for v in ("overdrive-v1", "overdrive-v2"))
    if not pair_complete and not allow_partial:
        raise ValueError(f"Missing rule version or colour assignment in a matched pair: {base}")
    expected_per_opening = data["settings"]["seeds"] * 2
    paired_openings = [g for g in opening_clusters.values() if len(g.get("overdrive-v1", [])) == len(g.get("overdrive-v2", [])) == expected_per_opening]
    metric_functions = {
        "pliesAtLimitIfUnfinished": lambda s: s["plies"],
        "impulsesPerGame": lambda s: side_sum(s, "impulses"),
        "activationsPerGame": lambda s: side_sum(s, "activations"),
        "abilityActionsPerGame": lambda s: sum(s["stats"]["abilities"].values()),
        "abilityActionsPer100PliesPerGame": lambda s: sum(s["stats"]["abilities"].values()) * 100 / s["plies"],
        "rotationPromotionsPerGame": lambda s: enriched[s["options"]["id"]]["rotationPromotions"],
        "atCapacityFractionPerGame": lambda s: side_sum(s, "atCapacityStarts") / s["plies"],
        "firstImpulseOccurred": lambda s: int(first_ply(s, "firstImpulse") is not None),
        "firstFormOccurred": lambda s: int(first_ply(s, "firstActivation") is not None),
        "depthBelow2FractionPerGame": lambda s: (s["stats"]["depth"].get("0", 0) + s["stats"]["depth"].get("1", 0)) / s["stats"]["searchMoves"],
    }
    paired = {}
    paired_by_opening = {}
    for name, f in metric_functions.items():
        differences = [mean([f(s) for s in cluster["overdrive-v2"]]) - mean([f(s) for s in cluster["overdrive-v1"]]) for cluster in paired_clusters]
        paired[name] = bootstrap_means(differences)
        if not free_opening:
            opening_differences = [mean([f(s) for s in cluster["overdrive-v2"]]) - mean([f(s) for s in cluster["overdrive-v1"]]) for cluster in paired_openings]
            paired_by_opening[name] = bootstrap_means(opening_differences)
    return {
        "source": str(base), "sourceCommit": data.get("sourceCommit"), "engineSha256": data.get("engineSha256"), "settings": data["settings"], "expectedGames": data["expectedGames"], "completedGames": data["completedGames"],
        "complete": complete,
        "validation": {"uniqueJobs": True, "bothRulesVersionsPresent": both_versions, "matchedRuleAndColourPairsComplete": pair_complete},
        "experiment": "free-opening" if free_opening else "fixed-opening-tapes",
        "primaryCluster": "seed" if free_opening else "opening",
        "versions": {version: version_summary(group, enriched, free_opening) for version, group in sorted(groups.items())},
        "pairedClusterDifferencesV2minusV1": paired,
        "pairedOpeningDifferencesV2minusV1": paired_by_opening,
        "bootstrapInterpretation": "Descriptive resampling within this chosen experiment, preserving both colour assignments and rule versions. Fixed tapes: opening is the primary cluster, opening+seed is a secondary view. Free openings: seed is the cluster. These are not human population intervals. Unfinished games retain the ply cutoff; never counted as draws.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directories", type=Path, nargs="+")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--allow-partial", action="store_true", help="Allow an explicitly incomplete interim report; final reports require all matched rule/colour jobs")
    options = parser.parse_args()
    result = [analyze(base, allow_partial=options.allow_partial) for base in options.directories]
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if options.output:
        options.output.write_text(text + "\n")
    else:
        print(text)
