# @chess-2/engine-sdk

Private Chess 2 workspace containing generic two-player, zero-sum, perfect-information search and a shared Worker contract. Each game supplies its own pure rules adapter and evaluation. No game UI, assets or rule implementation belongs here.

The explicit package export points to TypeScript source. Vite compiles it into each consumer; this is an internal workspace package, not an independently published npm distribution.

From the repository root:

```sh
npm run sdk:test
npm run typecheck --workspace @chess-2/engine-sdk
```

See [the contract and search design](../../docs/ENGINE_SDK.md).
