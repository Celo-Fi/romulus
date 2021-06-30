# Romulus 

## Deploying the contract
```
cp .env.example .env
# Fill in empty keys
yarn build && yarn deploy
```

## Usage

```
yarn cp .env.example .env
yarn test
```

## How to upgrade implementation

1. Make sure once you deploy new Governance implementation, call `initialize` methods right after it.
