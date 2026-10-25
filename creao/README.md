# Agent bundle — Symptom & Biosensor Health Analyzer

Version **1.1.0** · app id `4a2f70bf-4da0-422d-a0e2-9c9bc003fd9c`

## Files in this bundle

| File | Role |
|---|---|
| `SKILL.md` | The agent's program: Goal, Inputs, Procedure steps 1–9, Output template, recording metrics. 12,668 characters (under the 16,384 hard cap). |
| `config.yaml` | App config: name, description, version, connectors, form fields, memory block. |
| `README.md` | This file. |

No supporting files (CSS, templates, scripts) exist for this agent — the procedure is pure reasoning over user inputs, so everything lives in `SKILL.md` and `config.yaml`.

## Inputs

Required:
- `symptoms` — free text.

Optional:
- `symptom_duration`, `age`, `sex`
- `chronic_conditions` — existing long-term diagnoses and regular medications
- `biosensor_data` — pasted health-app metrics
- `cycle_data` — period history, regularity, cycle day, flow, cycle-linked symptoms
- `last_period_start` — date of most recent period start
- `biosensor_file` — screenshot / CSV / JSON / PDF export

## Procedure at a glance

1. Normalize the symptom report — split into distinct symptoms, capture onset/duration/severity/pattern/triggers, keep volunteered negatives, tag cycle-linked symptoms.
2. Build a biosensor baseline — compute **trends, not points** (7-day vs 4–8-week baselines for steps and flights climbed, resting HR vs personal norm, respiratory rate, weight rate of change, sleep, temperature deviations, BMI).
3. Chronic ailments — weigh dysmenorrhoea, endometriosis, PCOS, fibroids, perimenopause, PMDD, migraine, asthma, IBS, thyroid disease, anaemia, diabetes, chronic pain/fatigue and mood disorders in the same ranked list as acute conditions; separate a chronic flare from a new acute illness by tempo.
4. Menstrual-cycle analysis — compute the expected date from the person's own baseline, grade the deviation, then tie drivers to supplied evidence (pregnancy first check when late, stress/sleep, weight and energy availability, exercise load, recent illness, endocrine causes, contraception/medication, perimenopause), and screen gynaecological red flags.
5. Generate the differential — acute plus chronic, with honest look-alikes.
6. Decide how many to report — one if it dominates, otherwise the two to three most probable. Never force a single answer.
7. Red-flag screen — leads the output with escalation guidance when triggered.
8. Write the output — fixed section template.
9. Wording rules — no numeric probabilities ever; relative language only; no prescriptions; no ovulation/fertility estimates as contraception advice.

## Output

Markdown report: pattern summary → 1–3 ranked conditions (labelled acute/chronic/cycle-related) → chronic-pattern note → cycle-timing section (when cycle data supplied) → discounted list → signals used → discriminators → care-urgency guidance → non-diagnostic disclaimer.

## Recorded per session

`primary_condition`, `conditions_count`, `urgency_level`, `biosensor_data_used`, `cycle_data_used`, `cycle_deviation`, `age`, `sex`.

Aggregations: `conditions_count` (avg, count) and `urgency_level` (count), grouped by `primary_condition`.

## Change history

**1.1.0** — added chronic ailments as first-class ranked candidates; added menstrual-cycle inputs (`cycle_data`, `last_period_start`, `chronic_conditions`); new cycle-timing procedure step and "Cycle timing" output section; gynaecological red-flag screen; now records `cycle_data_used` and `cycle_deviation`.

**1.0.0** — initial agent: symptom + biosensor analysis with hedged likelihood wording.
