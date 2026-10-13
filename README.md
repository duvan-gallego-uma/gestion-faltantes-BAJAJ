# Gestión de Lotes con Novedades · Grupo UMA (Planta CKD)

Aplicación web para gestionar los lotes CKD que Bajaj envió con faltantes y sobrantes. Permite:

- **Tablero:** riesgo de paro de línea, estado porcentual de los lotes y programación de ensamble.
- **Lotes:** detalle de cada lote, compensación de faltantes con sobrantes e inventarios, y registro de unidades ingresadas.
- **Verificación física** lote a lote, pensada para tableta o celular en piso.
- **Cruce por SKU** contra los inventarios y cálculo de la brecha.
- **Solicitud a Bajaj** con pagos reportados y recibidos, validadores e historial.
- **Usuarios** con usuario y contraseña propios y cuatro roles.

## Estructura

```
gestion-lotes-uma/
├── frontend/src/        Código de la app (HTML, CSS y JavaScript por módulo)
│   ├── index.html       Plantilla
│   ├── style.css        Estilos (sistema de diseño UMA-DS)
│   ├── runtime.js       Conecta la app con el servidor Python cuando no corre en Claude
│   ├── core.js          Lectura del Excel y motor de compensación
│   ├── app.js           Vistas: tablero, lotes, verificación, cruce SKU, datos
│   ├── fuentes.js       Rough Cut y maestro packing list
│   ├── usuarios.js      Ingreso, roles y administración de usuarios
│   └── bajaj.js         Solicitud a Bajaj, pagos y validadores
├── server/              Servidor Flask: sirve la app y guarda los datos en SQLite
├── tools/
│   ├── build.py         Genera dist/index.html (un solo archivo)
│   ├── excel_a_json.py  Convierte el Excel de seguimiento a JSON
│   └── respaldo.py      Exporta o importa la base de datos
├── tests/               Pruebas (servidor, Excel, build y motor)
├── data/                Base de datos y archivos locales (excluido de Git)
└── dist/                App construida (excluido de Git)
```

## Requisitos

- Python 3.10 o superior.
- Node.js 18 o superior: opcional, solo para las pruebas del motor.
- Conexión a internet en el navegador: la lectura y exportación de Excel usa SheetJS desde cdnjs.

## Instalación y uso

**Windows:** doble clic en `iniciar.bat`.

**Linux o macOS:** ejecuta `./iniciar.sh`.

**Manual:**

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate     Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python tools/build.py
python -m server            # http://127.0.0.1:8000
```

### Primer ingreso

1. Abre http://127.0.0.1:8000 **en el mismo equipo donde corre el servidor**. Solo desde ese equipo se puede crear el administrador inicial.
2. Crea el administrador. Luego, en **Usuarios**, crea las cuentas del equipo.
3. En **Datos → Seleccionar archivo**, carga el Excel de seguimiento y pulsa **Publicar para el equipo**.

### Uso desde otros equipos de la red

```bash
python -m server --host 0.0.0.0 --port 8000
```

Los demás entran a `http://IP-DEL-SERVIDOR:8000`. Usa esta opción solo dentro de la red de la empresa o por VPN, y nunca expuesta a internet: la API no tiene autenticación propia.

### Construir con datos embebidos (opcional)

```bash
python tools/build.py --excel "ruta/Hardware case dispatched with shortage.xlsx"
```

## Desarrollo

1. Edita los archivos de `frontend/src/`.
2. Ejecuta `python tools/build.py` y recarga el navegador.
3. Corre las pruebas:

```bash
pip install -r requirements-dev.txt
python -m pytest            # o: python -m unittest discover -s tests -t .
```

`tests/fixtures/raw_ejemplo.json` contiene **datos ficticios** para probar sin información de la empresa:

```bash
python tools/build.py --raw tests/fixtures/raw_ejemplo.json
```

GitHub Actions (`.github/workflows/ci.yml`) corre las pruebas y construye la app en cada push a `main`.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Gestión de lotes CKD: versión inicial"
git branch -M main
git remote add origin https://github.com/ORGANIZACION/gestion-lotes-uma.git
git push -u origin main
```

Crea el repositorio como **privado**.

## Datos y confidencialidad

- `.gitignore` excluye la carpeta `data/`, los Excel, los CSV, los respaldos y la base SQLite. **Antes de cada commit revisa con `git status` que no se suba información de la empresa.**
- El build por defecto **no** embebe datos.
- Respaldo de la base:

```bash
python tools/respaldo.py exportar respaldo.json
python tools/respaldo.py importar respaldo.json
```

## Modos de funcionamiento

| Cómo se abre | Dónde se guardan los datos | Compartido |
|---|---|---|
| `python -m server` | `data/app.db` (SQLite) | Sí, entre todos los que usen ese servidor |
| Publicado como artifact en Claude | Almacenamiento de Claude | Sí, entre quienes tengan acceso al artifact |
| `dist/index.html` abierto como archivo | Navegador (localStorage) | No |

Los tres modos son **independientes**: los datos de la versión publicada en Claude no se pasan solos al servidor Python.

## Seguridad

- Las contraseñas se guardan como huella PBKDF2-SHA256 con sal, nunca en texto.
- Bloqueo de 5 minutos tras 5 intentos fallidos.
- Cierre de sesión tras 20 minutos de inactividad.
- La validación de contraseñas y los permisos por rol se aplican en el navegador. Para un control estricto, el siguiente paso es mover el inicio de sesión y los permisos al servidor (`server/app.py`) y que la API exija un token de sesión.

## Lógica del motor (resumen)

- **Faltante real:** conteo físico de la verificación; si no existe, la cantidad reportada en el Excel.
- **Pendiente:** faltante real − cantidad ingresada en el Excel − unidades registradas en la app.
- **Reparto:** atiende primero los lotes con ensamble más cercano y usa las fuentes en el orden configurado en Datos. Cada unidad de inventario se asigna una sola vez.
- **Estados del lote:** COMPLETO, COMPLETABLE, CRÍTICO (alguna novedad sin fuente), SIN NOVEDAD y ENSAMBLADO. Un lote ensamblado con faltantes pendientes sigue activo.
- **Reclamo a Bajaj:** faltante real − pagos de Bajaj recibidos − (opcional) lo cubierto con sobrantes de otros lotes. Lo cubierto con inventario propio se reclama como reposición.
