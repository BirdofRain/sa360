# US state map geometry (Inventory Explorer)

## Asset

- `us-states-albers.svg.json` — pre-projected SVG path data for US states (and DC)

## Source

Derived from [`us-atlas@3`](https://github.com/topojson/us-atlas) `states-albers-10m.json`, which redistributes U.S. Census Bureau cartographic boundary files (2017 edition).

- Projection: Albers USA fitted to a `975 × 610` viewport
- License: Census Bureau cartographic boundary data is public domain; us-atlas redistributes those geometries for web use

## Runtime

No network map requests. Geometry is imported as a static JSON module and rendered as SVG. No MapLibre, deck.gl, or paid map provider is used in this slice.
