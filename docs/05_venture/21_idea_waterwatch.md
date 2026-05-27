# WaterWatch

## 1. Core Record

### One-line thesis

Build a South Africa-focused water-outage map and alert product that helps residents understand current outages, affected zones, and expected restoration windows.

### Target user

Residents, neighborhoods, local communities, and possibly small operators affected by water disruptions.

### Geography / market

South Africa, starting with regions where outages are frequent and publicly discussed.

### Customer type

`hybrid`

### Product surface

`map_first`

## 2. Problem

### Core user problem

Water outages are disruptive, poorly communicated, and hard to interpret geographically, leaving residents without a clear operational picture.

### Why now

Infrastructure strain and service interruptions make the problem highly visible, while community reliance on informal channels suggests a product gap.

## 3. Delivery Model

### Data dependencies

- municipal outage notices
- ward or suburb mappings
- community-confirmed incident data
- timing and restoration updates

### Likely business model

- sponsorships
- civic partnerships
- premium alerts or business continuity monitoring later

### First acquisition channel

- community groups
- local social sharing
- municipal information amplification

### Likely Stitchly role

`backbone`

## 4. Risks

### Main risks

- official outage data may be inconsistent or late
- geographic mapping quality may vary widely by municipality
- strong public utility value may not translate to fast revenue

### Open unknowns

- which data sources are reliable enough to seed the map
- whether community-reported data can be structured safely
- whether there is a viable early-paying segment

## 5. Scorecard

| Dimension | Weight | Score (1-5) | Confidence | Evidence note |
| --- | ---: | ---: | --- | --- |
| Problem usefulness / urgency | 15 | 5 | medium | Water outages are highly disruptive and operationally urgent when they happen. |
| Reachability of first users | 10 | 4 | medium | Affected communities are easy to identify, but distribution still needs focus. |
| Ease of first dollar | 20 | 2 | low | Fast monetization is unclear despite strong utility. |
| Ease of recurring income | 15 | 2 | low | Repeat usage exists, but the revenue model is still uncertain. |
| Implementation ease | 10 | 3 | medium | Map and alerting are feasible, but trustworthy outage pipelines are harder. |
| Operating cost efficiency | 10 | 3 | medium | Costs are manageable early, but support and data operations may rise. |
| Data availability / reliability | 8 | 2 | low | Data consistency and ownership are major unresolved risks. |
| South Africa local edge | 5 | 5 | high | Strong local relevance and local pain. |
| Platform / regulatory safety | 3 | 4 | medium | Lower platform risk than many categories, but data handling still matters. |
| Stitchly leverage | 4 | 4 | high | Stitchly fits well as the ingestion, normalization, alerting, and operator layer. |

## 6. Evaluation Output

### Weighted score

`62.8 / 100`

### Overall confidence

`low`

### Top 3 strengths

- highly useful, urgent problem
- very strong South Africa local fit
- excellent fit for Stitchly-backed data and alerting workflows

### Top 3 risks

- unreliable source data may undermine trust
- monetization is weak relative to public utility value
- operational accuracy expectations will be high from day one

### Recommendation

`Incubate / Park`

### Next concrete action

Prove one reliable outage data pipeline for a narrow geography before investing in the public-facing map product.

### Validation artifact

`data_source_proof`
