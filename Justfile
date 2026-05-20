set shell := ["bash", "-lc"]

dev-backend:
  cargo run -p runtime_server --bin stitchly-server

dev-frontend:
  cd apps/web && corepack pnpm dev

dev-ui:
  ./scripts/dev_ui_agent.sh up

dev-ui-no-open:
  ./scripts/dev_ui_agent.sh up --no-open

dev-ui-stop:
  ./scripts/dev_ui_agent.sh down

dev-ui-status:
  ./scripts/dev_ui_agent.sh status

generate-contracts:
  @echo "Contract generation is planned next; current frontend uses shared fixtures and live API payloads."

test-backend:
  cargo test --workspace

test-frontend:
  cd apps/web && corepack pnpm test --run

test-integration:
  cargo test --test integration

build:
  cargo build --workspace

lint:
  cargo fmt --check
  cargo clippy --workspace --all-targets --all-features
  cd apps/web && corepack pnpm typecheck
