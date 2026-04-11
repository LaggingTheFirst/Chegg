# Rank System Configuration

This directory contains the configurable rank display system for the Chegg leaderboard, similar to Rainbow Six Siege's ranking system.

## Structure

```
assets/leaderboard/
├── ranks.json          # Main configuration file
├── 1_iron/            # Iron rank images (I, II, III)
│   ├── ore.png        # Iron I
│   ├── block.png      # Iron II
│   └── ornate.png     # Iron III
├── 2_gold/            # Gold rank images
├── 3_diamond/         # Diamond rank images
├── 4_redstone/        # Redstone rank images
└── 5_netherite/       # Netherite rank images
```

## Configuration (ranks.json)

### Rank Tier with Subdivisions

Each tier has 3 subdivisions (like Copper I, II, III in Siege):

```json
{
  "tier": "Iron",
  "color": "#9ca3af",
  "subdivisions": [
    {
      "name": "Iron I",
      "minElo": 0,
      "maxElo": 399,
      "image": "assets/leaderboard/1_iron/ore.png"
    },
    {
      "name": "Iron II",
      "minElo": 400,
      "maxElo": 799,
      "image": "assets/leaderboard/1_iron/block.png"
    },
    {
      "name": "Iron III",
      "minElo": 800,
      "maxElo": 1199,
      "image": "assets/leaderboard/1_iron/ornate.png"
    }
  ]
}
```

### Display Settings

```json
{
  "imageSize": 32,         // Default image size in pixels
  "showRankName": true,    // Show rank name next to image
  "showTierOnly": false    // Show only tier (e.g., "Iron" instead of "Iron II")
}
```

## Progression System

Like Rainbow Six Siege:
- **Ore** = Subdivision I (lowest in tier)
- **Block** = Subdivision II (middle in tier)
- **Ornate** = Subdivision III (highest in tier)

Example progression:
1. Iron I (ore) → Iron II (block) → Iron III (ornate)
2. Gold I (ore) → Gold II (block) → Gold III (ornate)
3. Diamond I (ore) → Diamond II (block) → Diamond III (ornate)

## Current Rank Structure

| Tier | Subdivision | ELO Range | Image |
|------|-------------|-----------|-------|
| Iron | I | 0-399 | ore.png |
| Iron | II | 400-799 | block.png |
| Iron | III | 800-1199 | ornate.png |
| Gold | I | 1200-1399 | ore.png |
| Gold | II | 1400-1599 | block.png |
| Gold | III | 1600-1799 | ornate.png |
| Diamond | I | 1800-1999 | ore.png |
| Diamond | II | 2000-2199 | block.png |
| Diamond | III | 2200-2399 | ornate.png |
| Redstone | I | 2400-2599 | ore.png |
| Redstone | II | 2600-2799 | block.png |
| Redstone | III | 2800-2999 | ornate.png |
| Netherite | I | 3000-3299 | ore.png |
| Netherite | II | 3300-3599 | block.png |
| Netherite | III | 3600+ | ornate.png |

## Adding New Tiers

1. Create a new directory: `assets/leaderboard/6_yourtier/`
2. Add three images: `ore.png`, `block.png`, `ornate.png`
3. Add tier configuration to `ranks.json`:

```json
{
  "tier": "YourTier",
  "color": "#your-color",
  "subdivisions": [
    {
      "name": "YourTier I",
      "minElo": 3700,
      "maxElo": 3999,
      "image": "assets/leaderboard/6_yourtier/ore.png"
    },
    {
      "name": "YourTier II",
      "minElo": 4000,
      "maxElo": 4299,
      "image": "assets/leaderboard/6_yourtier/block.png"
    },
    {
      "name": "YourTier III",
      "minElo": 4300,
      "maxElo": 9999,
      "image": "assets/leaderboard/6_yourtier/ornate.png"
    }
  ]
}
```

## Usage in Code

```javascript
import { RankSystem } from './js/ui/RankSystem.js';

const rankSystem = new RankSystem();
await rankSystem.load();

// Get rank for ELO (returns subdivision info)
const rank = rankSystem.getRankForElo(1500);
// Returns: { name: "Gold II", minElo: 1400, maxElo: 1599, image: "...", tier: "Gold", color: "#fbbf24" }

// Get rank image
const imagePath = rankSystem.getRankImage(1500);

// Get rank color
const color = rankSystem.getRankColor(1500);

// Get full rank name (e.g., "Gold II")
const rankName = rankSystem.getRankName(1500);

// Get tier only (e.g., "Gold")
const tierName = rankSystem.getTierName(1500);

// Create rank badge HTML
const badgeHTML = rankSystem.getRankHTML(1500, {
  size: 32,
  showName: true,
  showTierOnly: false  // false = "Gold II", true = "Gold"
});
```

## Image Requirements

- Format: PNG with transparency
- Recommended size: 32x32 pixels (will be scaled)
- Style: Pixelated/retro style (image-rendering: pixelated is applied)
- Three images per tier representing progression:
  - **ore.png**: Subdivision I (entry level)
  - **block.png**: Subdivision II (mid level)
  - **ornate.png**: Subdivision III (top level)

## Customization

Everything is configurable via JSON:

1. **Change ELO ranges**: Edit `minElo` and `maxElo` in subdivisions
2. **Change colors**: Edit the `color` field for each tier
3. **Add new tiers**: Add new tier objects with 3 subdivisions
4. **Change subdivision count**: Add more or fewer subdivisions per tier
5. **Change default display**: Edit `displaySettings`
6. **Replace images**: Replace PNG files in tier directories

