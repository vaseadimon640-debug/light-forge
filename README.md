# LIGHT FORGE

Рабочая среда для проектирования светильников и подготовки запросов китайским фабрикам. В этой версии доступна инженерная основа композиций и HTTP API геометрии.

## Запуск

Требуется Node.js 22.18+ и npm. Для одинаковой среды в Antigravity и Codex в репозитории есть Dev Container.

```bash
npm ci
npm run dev
```

- Состояние сервера — [localhost:3000/api/health](http://localhost:3000/api/health).
- Контракт API — [API_CONTRACTS.md](API_CONTRACTS.md) и [openapi.yaml](openapi.yaml).
- Формулы, уровни отсчёта и переход к Three.js — [GEOMETRY.md](GEOMETRY.md).
- Работа двух сред — [AGENTS.md](AGENTS.md) и [DEVELOPMENT_TASKS.md](DEVELOPMENT_TASKS.md).

```bash
npm run typecheck
npm test
npm run build
```

Сформировать запрос на примере MYLINE и проверить его через локальный сервер.

```bash
node --experimental-strip-types --input-type=module -e "import {createMylineComposition} from './src/geometry/examples.ts'; console.log(JSON.stringify(createMylineComposition()))" |
  curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary @- http://localhost:3000/api/geometry/resolve
```

Примеры данных, развитие Quick RFQ, 3D и CAD описаны в [ROADMAP.md](ROADMAP.md).
