# GridZA

## 1. Core Record

### One-line thesis

Build a South Africa-focused loadshedding map and schedule utility that makes Eskom and area-based interruption information easier to interpret, visualize, and act on.

### Target user

Residents, commuters, small operators, and local businesses who need a clearer picture of loadshedding timing and geography.

### Geography / market

South Africa, starting with locations where schedule lookups and alerting are already high-frequency behaviors.

### Customer type

`hybrid`

### Product surface

`map_first`

## 2. Problem

### Core user problem

Existing schedule tools are often fragmented, hard to interpret, and not especially map-native, which creates friction for routine planning.

### Why now

Loadshedding remains a recurring operational pain point, and users already have learned behavior around checking schedules and sharing outage information.

## 3. Delivery Model

### Data dependencies

- Eskom and area schedule data
- location-to-schedule mappings
- interruption stage updates
- optional alerting and historical pattern layers

### Likely business model

- premium alerts
- local sponsorship or promoted placements
- B2B access for small operators later

### First acquisition channel

- search intent
- local sharing
- utility-focused content and notification hooks

### Likely Stitchly role

`backbone`

## 4. Risks

### Main risks

- strong existing competitors reduce differentiation
- schedule integrity and mapping accuracy must be very high
- utility products can become operationally noisy if source data shifts often

### Open unknowns

- what the minimum differentiated product angle is
- which customer segment pays first
- how much better the map and alerting experience can be than existing tools

## 5. Scorecard

| Dimension | Weight | Score (1-5) | Confidence | Evidence note |
| --- | ---: | ---: | --- | --- |
| Problem usefulness / urgency | 15 | 4 | high | The problem is recurring and operationally relevant, though not always peak urgency. |
| Reachability of first users | 10 | 4 | medium | Strong search and social discovery potential exists. |
| Ease of first dollar | 20 | 3 | medium | Faster than the other civic utilities, but still not trivial. |
| Ease of recurring income | 15 | 3 | medium | Repeat use is strong, and premium alerting is plausible. |
| Implementation ease | 10 | 4 | medium | More straightforward than WaterWatch if schedule data is accessible. |
| Operating cost efficiency | 10 | 4 | medium | Good candidate for relatively lean operations once pipelines are stable. |
| Data availability / reliability | 8 | 4 | medium | Better structured than many outage categories, though still requires care. |
| South Africa local edge | 5 | 5 | high | Very strong local fit and recurring need. |
| Platform / regulatory safety | 3 | 4 | medium | Lower platform risk, mostly a data quality and product differentiation problem. |
| Stitchly leverage | 4 | 4 | high | Stitchly can power ingestion, normalization, alert routing, and operator tooling well. |

## 6. Evaluation Output

### Weighted score

`74.0 / 100`

### Overall confidence

`medium`

### Top 3 strengths

- strong repeat-use behavior and local relevance
- better path to lean implementation than the water-outage idea
- strong Stitchly fit as the schedule ingestion and alerting backbone

### Top 3 risks

- real differentiation versus existing tools is not yet fully proven
- monetization still needs sharper validation
- source quality and mapping accuracy will define trust

### Recommendation

`Validate First`

### Next concrete action

Test a narrow differentiated MVP around one geography, one alerting behavior, and one acquisition channel before committing to a broader product build.

### Validation artifact

`prototype`
