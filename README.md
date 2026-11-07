# Reel Edits

Reel Edits is a Next.js project for turning a collection of short clips and photos into a polished, editable 60–120 second vertical reel. A creative brief and an optional reference style guide the first cut. The creator reviews the cut, adjusts the timeline, and exports an MP4.

**Status:** Repository foundation and Next.js starter. Ingest, editing, AI analysis, preview, and export are planned.

## Run the starter

Use Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. Use `npm run build` to check the production build and `npm start` to serve it.

## Documentation

- [Research and decisions](docs/research.md) covers video tooling, reference links, AI APIs, compute, and costs.
- [Pipeline architecture](docs/architecture.md) defines the asset, style, timeline, and render boundaries.
- [Implementation roadmap](docs/roadmap.md) lists the proposed pull requests and acceptance gates.
- [Licensing and media policy](docs/licensing.md) explains the scope of the MIT license, dependency obligations, and media handling.

The source and documentation in this repository use the [MIT License](LICENSE).
