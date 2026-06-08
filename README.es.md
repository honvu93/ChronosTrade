# 📊 ChronosTrade — Plataforma Analítica y de Trading Cuantitativo de Nivel Empresarial

[English](README.md) | [Tiếng Việt](README.vi.md) | [简体中文](README.zh.md)

**ChronosTrade** es una plataforma de trading cuantitativo y análisis financiero de alto rendimiento y nivel empresarial. Diseñada para ofrecer la máxima velocidad, proporciona un flujo unificado que abarca desde la ingesta de datos de mercado, el cálculo dinámico de indicadores técnicos y la optimización de estrategias en paralelo (backtesting de alta concurrencia), hasta el envío de señales en tiempo real y la ejecución automatizada de órdenes a través del puente de conexión con MetaTrader 5 (MT5). El proyecto sirve como una base sólida para desarrolladores cuantitativos y traders algorítmicos que desean transicionar del descubrimiento de estrategias a la ejecución en vivo.

---

## 🛠 Stack Tecnológico

### 1. Backend (Motor Central)
* **Node.js & TypeScript:** Requiere Node >= 20.x, TypeScript 5.3.
* **Express.js 5:** API REST de alto rendimiento con arquitectura de middleware de seguridad.
* **Prisma ORM & TimescaleDB:** Almacenamiento optimizado para series temporales financieras (velas de precios) y gestión de 29 modelos relacionales complejos.
* **BullMQ & Redis:** Gestor de colas y bróker de mensajería asíncrona para la ejecución de backtests en paralelo y órdenes.
* **Socket.IO:** Transmisión en tiempo real de eventos y estados al panel de control.

### 2. Frontend (Panel de Control - Dashboard)
* **Next.js 16 (App Router) & React 19:** Renderizado optimizado tanto del lado del servidor como del cliente.
* **Tailwind CSS 4 & Radix UI:** Interfaz de usuario moderna, responsive, limpia y accesible.
* **Zustand & TanStack React Query:** Gestión fluida del estado del cliente y sincronización automatizada con el servidor.
* **Lightweight Charts (TradingView):** Gráficos profesionales interactivos para visualizar puntos de entrada/salida y precios.

### 3. MT5 Bridge (Servicio de Puente Python)
* **Python 3.x & MetaTrader5 API:** Recuperación de datos históricos e inyección directa de órdenes en la terminal de MT5.
* **APScheduler:** Programador de tareas automatizado para la sincronización periódica de velas.
* **Thread-safe Lock:** Garantiza una ejecución serializada y segura de las operaciones en MT5.

---

## 🚀 Características Principales

```mermaid
flowchart TD
    subgraph MarketData [Flujo de Datos de Mercado]
        MT5[MetaTrader 5] -->|Sincronizar Velas| Bridge[Puente MT5 Python]
        Bridge -->|Almacenar| TS[TimescaleDB]
    end

    subgraph SignalEngine [Motor de Señales]
        TS -->|Consultar Velas| Runner[Ejecutor de Indicadores en Vivo]
        Def[Definición de Señal] -->|Configurar Indicadores| Runner
        Runner -->|Generar Evento| Event[Evento de Señal]
    end

    subgraph Execution [Oleoducto de Ejecución]
        Event -->|Crear Intención| Intent[Intención de Trade]
        Intent -->|Comprobar Filtros| Guard{Filtros de Riesgo}
        Guard -->|Aprobado| Comm[Comando de Ejecución]
        Comm -->|Petición HTTP| Bridge
        Bridge -->|Ejecutar Orden| MT5
    end

    subgraph Monitoring [Transmisiones en Vivo]
        Event -->|Socket.IO| UI[Dashboard Next.js]
        Event -->|Bot de Telegram| TG[Canal de Telegram]
    end
```

### 1. Gestión de Indicadores y Ajuste Dinámico de Parámetros
* **Ajuste de Parámetros:** Personalice dinámicamente los indicadores técnicos (como períodos de RSI, longitud de EMA, Elliott Waves y estructuras de Swing) directamente desde la UI de Backtest sin alterar el código fuente.
* **Esquemas Declarativos:** Los indicadores definen sus parámetros mediante esquemas (`FieldSchema`). El frontend genera automáticamente controles deslizantes, interruptores o menús desplegables.
* **Bar Inspection:** Pase el cursor sobre cualquier vela para inspeccionar los valores precisos de todos los indicadores activos en esa barra específica.

### 2. Perfiles de Salida y Gestión de Riesgo Avanzada (Filtros de Entrada)
* **Perfiles de Salida (Exit Profiles):** Soporta múltiples estrategias de salida automática:
  * Múltiplo de riesgo fijo (1R, 2R, TP/SL fijo).
  * **Break-even:** Mueve el Stop Loss (SL) al precio de entrada una vez alcanzado el objetivo 1R.
  * **Cierre Parcial:** Cierra una parte del volumen en 1R, dejando el resto correr con un Stop Trailing.
  * **Trailing Stop por Estructura:** Trailing stop basado en los máximos/mínimos de las últimas N barras.
* **Filtros de Entrada (Trade Guards):**
  * Cooldown por racha de pérdidas (detiene las operaciones tras N pérdidas consecutivas).
  * Límites de pérdidas diarios y por sesión (max drawdown de seguridad).
  * Filtro EMA de la curva de equidad (restringe la entrada si la equidad está por debajo de su promedio).

### 3. Trazabilidad de Decisiones y Sincronización Multi-Timeframe
* **Trazabilidad de Decisiones:** Registre el estado paso a paso de las condiciones de salida en cada vela (`PASS`, `FAIL`, `TRIGGERED`, `SKIPPED`) para facilitar la depuración.
* **Sincronización Multi-Timeframe:** Sincronice indicadores de marcos temporales superiores (ej. tendencia H1) con el marco de ejecución base (ej. entrada M5) alineados en tiempo de cierre de vela.

### 4. Motor de Backtesting en Paralelo de Alto Rendimiento
* **Trabajadores Concurrentes:** Procese tareas masivas de optimización y backtest en paralelo mediante colas de BullMQ (configurable mediante `BACKTEST_WORKER_CONCURRENCY`).
* **Matrix Sweeps:** Ejecute barridos de parámetros (búsqueda en rejilla) en varias configuraciones de indicadores para encontrar la combinación óptima.

---

## ⚖️ ¿Por qué ChronosTrade? (Comparación con Alternativas)

Al compararlo con otros marcos de trading minoristas o propietarios, ChronosTrade ofrece un equilibrio óptimo entre velocidad de investigación y ejecución en vivo automatizada:

| Característica / Criterio | Frameworks Python (Backtrader / Zipline) | Asesores Expertos (MQL5 EA) | TradingView / Pine Script | **ChronosTrade** |
| :--- | :--- | :--- | :--- | :--- |
| **Arquitectura de Ejecución** | Alta latencia o puente personalizado | Baja latencia pero gestión de estado compleja | Retraso de webhook, requiere servidor externo | **Puente MT5 sub-segundo con bloqueos atómicos** |
| **Rendimiento de Base de Datos** | Archivos planos (CSV) o consultas DB lentas | Sin integración nativa de DB de series temporales | Almacenamiento limitado de historial | **TimescaleDB optimizado para series temporales** |
| **Optimización de Parámetros** | Monoproceso en CPU por defecto | MT5 Strategy Tester (Limitado a Windows) | Monohilo ejecutado en el navegador | **Trabajadores BullMQ distribuidos (multinúcleo)** |
| **Personalización de Parámetros** | Requiere editar código por cada ejecución | Formulario rígido y estático | Ajustes en el panel de TradingView | **Formularios generados por esquemas (`FieldSchema`)** |
| **Depuración de Decisiones** | Logs de texto simple en consola | Impresión en la pestaña Journal de MT5 | Figuras visuales en gráficos (difícil de auditar) | **Línea de tiempo detallada (`PASS`/`FAIL` por vela)** |
| **Modelo de Alojamiento** | Scripts locales o servidores propios | Ejecución local en terminal MT5 o VPS | Alojamiento en la nube de TradingView | **Local-first, 100% auto-alojado e independiente** |

---

## 📐 Arquitectura del Sistema

Diagrama que muestra la comunicación entre los componentes principales:

```
                         ┌─────────────────────────────────┐
                         │        Cloudflare Tunnel         │
                         └──────────┬──────────────────────┘
                                    │
                         ┌──────────▼──────────────────────┐
                         │   API Server (Express :3001)     │
                         │   REST + Socket.IO real-time     │
                         │   JWT Auth + RBAC + Feature Flags│
                         └──┬────────┬────────┬────────────┘
                            │        │        │
               ┌─────────────▼─┐  ┌───▼────┐  ┌▼──────────────────┐
               │  TimescaleDB   │  │ Redis  │  │  Next.js Frontend  │
               │  :5433 (main)  │  │ :6379  │  │  :5001 (dashboard) │
               └────────────────┘  └───┬────┘  └────────────────────┘
                                       │
                     ┌─────────────────┼─────────────────────┐
                     │                 │                     │
               ┌─────▼──────┐  ┌──────▼───────┐  ┌─────────▼────────┐
               │  BullMQ     │  │  BullMQ      │  │  BullMQ          │
               │  Backtest   │  │  Auto-Exec   │  │  External Action │
               │  Worker     │  │  Worker       │  │  Worker          │
               └─────────────┘  └──────────────┘  └──────────────────┘
                                       │
                               ┌───────▼────────┐
                               │  MT5 Bridge     │
                               │  Python         │
                               │  :8765 (read)   │
                               │  :8766 (exec)   │
                               └────────────────┘
                                       │
                               ┌───────▼────────┐
                               │  MetaTrader 5   │
                               │  Terminal       │
                               └────────────────┘
```

---

## 🏃 Guía de Inicio Rápido

### Requisitos Previos
* **Node.js** v20 o superior.
* **Docker & Docker Compose** instalados y en ejecución.
* **Python 3.8+** (para el servicio puente MT5).
* **Terminal MetaTrader 5** (conectada a su cuenta de bróker).

### Paso 1: Instalar Dependencias

1. Instale las dependencias del Backend:
   ```bash
   npm install
   ```

2. Instale las dependencias del Frontend:
   ```bash
   npm --prefix web install
   ```

3. Instale los requisitos de Python (dentro del directorio `mt5-service`):
   ```bash
   pip install -r mt5-service/requirements.txt
   ```

### Paso 2: Iniciar los Servicios de Infraestructura

Inicie los contenedores de TimescaleDB, Redis y Base de Datos de Señales Externas:
```bash
docker compose up -d
```
*Compruebe el estado con:* `docker ps`

### Paso 3: Configurar las Variables de Entorno (.env)

1. Cree un archivo `.env` en la carpeta raíz (para Backend API & Workers):
   ```env
   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/binance_trade?schema=public"
   EXTERNAL_SIGNAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:5434/external_signal?schema=public"
   REDIS_URL="redis://localhost:6379"
   NODE_ENV="development"
   MT5_BRIDGE_PORT="8765"
   MT5_EXEC_BRIDGE_PORT="8766"
   ```

2. Cree un archivo `web/.env.local` en la carpeta `web/`:
   ```env
   NEXT_PUBLIC_API_URL="http://localhost:3001"
   NEXT_PUBLIC_SOCKET_URL="http://localhost:3001"
   ```

### Paso 4: Ejecutar Migraciones de Prisma

Genere el cliente de Prisma y aplique las migraciones en TimescaleDB:
```bash
npx prisma generate
npx prisma migrate deploy
```

---

## 🚀 Ejecución del Proyecto

### Método 1: Script Automatizado (Recomendado)
Use el script de inicio integrado `trade-dev`:
```bash
# Asigne permisos de ejecución (solo la primera vez)
chmod +x ./trade-dev

# Inicie Backend y Frontend
./trade-dev

# Inicie con Cloudflare Tunnel habilitado
./trade-dev --with-tunnel
```

### Método 2: Ejecución Manual por Terminales Separadas
* **Terminal 1: Iniciar API Server Backend** -> `npm run dev`
* **Terminal 2: Iniciar Dashboard Next.js** -> `npm --prefix web run dev`
* **Terminal 3: Iniciar Backtest Worker** -> `npm run dev:backtest:worker`
* **Terminal 4: Iniciar Auto Execution Worker** -> `npm run dev:trading:auto-worker`
* **Terminal 5: Iniciar Puente MT5 Python** -> `python mt5-service/bridge_server.py`

---

## 🧪 Seeding & Scripts de Prueba (CLI)

El repositorio incluye varias herramientas CLI útiles para poblar datos de prueba u optimizar parámetros:

* **Poblar Datos de Prueba (Seed):**
  ```bash
  npm run seed:engine               # Poblar configuración del motor
  npx ts-node src/scripts/seedTier1ComposedSignals.ts # Poblar señales de nivel 1
  ```
* **Smoke Tests (Pruebas de humo):**
  ```bash
  npm run smoke:signals-platform    # Probar lógica de plataforma de señales
  npm run test:trading:backend      # Ejecutar pruebas unitarias de trading
  ```
* **Optimización de Estrategias para Oro (XAU/USD - M5):**
  ```bash
  npm run xau:abc:all               # Ejecutar todos los barridos de parámetros
  npm run xau:new:l5                # Probar variante lógica Smart Trail M5
  ```

---

## 📂 Árbol de Directorios del Repositorio

```
ChronosTrade/
  ├── prisma/               # Esquema de Prisma e historiales de migración
  ├── src/                  # Código fuente del Backend
  │    ├── routes/          # Endpoints de API REST
  │    ├── services/        # Servicios de lógica de negocio (backtest, trading)
  │    ├── workers/         # Procesadores de colas de BullMQ
  │    └── scripts/         # Scripts CLI de análisis y optimización
  ├── web/                  # Frontend Next.js (Dashboard)
  │    ├── src/app/         # Enrutamiento de páginas y vistas de cliente
  │    ├── src/components/  # Componentes de gráficos (Lightweight Charts)
  │    └── src/store/       # Gestión de estado de Zustand
  ├── mt5-service/          # Puente de conexión MT5 escrito en Python
  ├── docs/                 # Documentación técnica avanzada por módulos
  ├── docker-compose.yml    # Definición de contenedores de Docker
  └── trade-dev             # Script bash de inicio rápido
```

---

## 🤝 Contribuir

¡Agradecemos las contribuciones de la comunidad! Si desea colaborar:
1. Haga un Fork del repositorio.
2. Cree una nueva rama: `git checkout -b feature/AmazingFeature`.
3. Confirme sus cambios: `git commit -m 'Add some AmazingFeature'`.
4. Envíe los cambios a su rama: `git push origin feature/AmazingFeature`.
5. Abra una **Pull Request**.

---

## 📄 Licencia

Este proyecto está licenciado bajo la **Licencia ISC**. Para más detalles, consulte el archivo [LICENSE](file:///Users/honvu/Public/Claude-Project/ChronosTrade/LICENSE).
