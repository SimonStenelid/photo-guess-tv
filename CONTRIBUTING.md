# Contributing to Photo Guess TV

For a bug, open an issue with reproduction steps, the observed result, and the behavior you expected. For a larger change, start with an issue so we can talk through the design. Use the private [security reporting instructions](SECURITY.md) for vulnerabilities.

1. Fork and clone the repository, then create a branch from `main`.
2. With Node.js 22 or newer, run `npm ci` and `npm run dev`. The [local preview](http://127.0.0.1:3100/preview) has sample photos, a TV, three sample phones, and a sound check.
3. Run `npm test`. For TV or phone changes, play a round in the preview. For packaging changes, run `npm run build:wgt` with `zip` installed.
4. Open a pull request with the reason for the change and how you tested it. Use sample images and fictitious configuration in screenshots, logs, and examples. Keep game photos, host codes, certificates, and generated widgets out of commits.

Changes are contributed under the [MIT License](LICENSE). Please follow the [code of conduct](CODE_OF_CONDUCT.md).
