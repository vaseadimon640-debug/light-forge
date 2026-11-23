# LIGHT FORGE

Рабочая среда для проектирования светильников и подготовки запросов китайским фабрикам. В этой версии доступны инженерная основа композиций и серверный Quick RFQ с текстом и PDF на английском и упрощённом китайском.

## Запуск

Требуются Node.js 22.18+ и npm. Для PDF нужны Chromium и системный шрифт Noto Sans CJK SC. Dev Container устанавливает их автоматически. При локальном запуске можно указать `CHROMIUM_PATH` или установить браузер командой `npx playwright install chromium`. Проверки PDF через Poppler описаны в документации.

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

Подключение текста, PDF, предпросмотра и локального хранилища описано в [API_CONTRACTS.md](API_CONTRACTS.md). Развитие Quick RFQ, 3D и CAD описано в [ROADMAP.md](ROADMAP.md).

Сформировать двуязычный PDF из MYLINE и проверить страницы, китайский текст и встраивание шрифтов.

```bash
node --experimental-strip-types --input-type=module -e "import {createMyline} from './src/domain/myline.ts'; console.log(JSON.stringify({project:createMyline()}))" |
  curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary @- 'http://localhost:3000/api/rfq/quick?format=pdf&lang=en-zh' -o MYLINE.pdf
pdfinfo MYLINE.pdf
pdftotext MYLINE.pdf -
pdffonts MYLINE.pdf
```
