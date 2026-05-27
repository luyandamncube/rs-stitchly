# Savr

## 1. Core Record

### One-line thesis

Build a South Africa-focused barcode scanner and price comparison utility that helps shoppers quickly compare grocery and household prices across retailers.

### Target user

Price-sensitive South African consumers who want to reduce grocery spend and compare alternatives in real time.

### Geography / market

South Africa, starting with urban and peri-urban retail users.

### Customer type

`consumer`

### Product surface

`mobile_web`

## 2. Problem

### Core user problem

Consumers often do not know whether a product is fairly priced across nearby retailers, which makes it hard to optimize household spend.

### Why now

Cost-of-living pressure is persistent, mobile usage is strong, and users already compare prices informally through store specials and social sharing.

## 3. Delivery Model

### Data dependencies

- retailer price data
- barcode-to-product matching
- store-level availability and packaging normalization

### Likely business model

- affiliate or referral revenue
- promoted placements
- premium deal alerts or household budgeting features later

### First acquisition channel

- short-form social content around savings
- community sharing
- WhatsApp and local deal communities

### Likely Stitchly role

`backbone`

## 4. Risks

### Main risks

- retailer pricing data may be difficult to source reliably
- packaging and SKU normalization may become messy quickly
- consumer utility may be high while monetization remains weak

### Open unknowns

- how much usable pricing data can be acquired without fragile scraping
- whether users will trust incomplete price coverage
- what the first durable revenue event actually is

## 5. Scorecard

| Dimension | Weight | Score (1-5) | Confidence | Evidence note |
| --- | ---: | ---: | --- | --- |
| Problem usefulness / urgency | 15 | 4 | high | Household savings is useful and persistent, especially in a price-sensitive market. |
| Reachability of first users | 10 | 3 | medium | Consumers are reachable, but acquisition will depend on strong distribution content. |
| Ease of first dollar | 20 | 2 | medium | Early revenue path exists, but it is not immediately obvious or strong. |
| Ease of recurring income | 15 | 2 | medium | Repeat use is plausible, but recurring revenue is still weakly defined. |
| Implementation ease | 10 | 3 | medium | Scanner and comparison UX are feasible, but data normalization raises difficulty. |
| Operating cost efficiency | 10 | 3 | medium | Costs are manageable early, but ongoing data maintenance may grow. |
| Data availability / reliability | 8 | 2 | low | Data access is the major uncertainty and a likely structural bottleneck. |
| South Africa local edge | 5 | 4 | high | Local savings pressure and retailer differences create strong local relevance. |
| Platform / regulatory safety | 3 | 4 | medium | Low direct regulatory risk, but data-source method still matters. |
| Stitchly leverage | 4 | 3 | high | Stitchly can help with ingestion, normalization, and operator workflows, but is not the whole product. |

## 6. Evaluation Output

### Weighted score

`56.0 / 100`

### Overall confidence

`medium`

### Top 3 strengths

- strong everyday usefulness in a price-sensitive economy
- clear local relevance for South African users
- good fit for Stitchly-backed ingestion and normalization workflows

### Top 3 risks

- fragile or incomplete pricing data could break the product early
- monetization path is weaker than the user value proposition
- SKU normalization complexity may expand fast

### Recommendation

`Incubate / Park`

### Next concrete action

Prove one durable retailer data-acquisition path and normalize a small manual dataset before committing product build time.

### Validation artifact

`data_source_proof`
