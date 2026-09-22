# Tests unitarios (Jest)

## Contexto

Hasta el Ticket 19 el backend no tenía ningún test. Este ticket añade Jest y
tests unitarios de los 5 servicios de negocio (`auth`, `maps`, `trayectos`,
`stripe`, `cancelaciones`) más el guard y el filtro de excepciones, que sí
tienen lógica propia.

**Alcance deliberado**: tests unitarios de servicios, con `SupabaseService`,
el cliente de Stripe y el cliente de Google Maps mockeados a mano
(`jest.fn()`). No son tests de integración/e2e contra Supabase real, ni tests
de controllers (delegan directamente en el servicio) ni de DTOs (la
validación de Zod es declarativa, se confía en el framework). Mismo criterio
que se siguió en `GiConnectBack`.

## Nest v12 es ESM puro — por qué existe `test-mocks/nestjs-common.js`

A partir de la v12, `@nestjs/common` se publica sin build CommonJS
(`"type": "module"`, sin condición `require` en `exports`). Jest con Node 22
no puede hacer `require()` de un paquete así sin `--experimental-vm-modules`
y reescribir el proyecto entero a ESM nativo (afectaría también a cómo
arrancan `dev`/`build`/`start`, no solo a los tests).

Como los tests instancian los servicios directamente
(`new AuthService(mockDeps)`), sin pasar por el contenedor de Nest, los
decoradores (`@Injectable()`, etc.) no necesitan comportamiento real — solo
que no lancen error al evaluarse. `test-mocks/nestjs-common.js` los sustituye
por no-ops vía `jest.moduleNameMapper` (ver `package.json`). Esto **no afecta
a la app real**: `npm run dev`/`build`/`start` no pasan por Jest.

## Cobertura por módulo (statements)

| Módulo | Cobertura | Qué verifica |
|---|---|---|
| AuthService | 100% | Registro (cliente/taxista) con rollback del usuario de Auth si falla cualquier paso; login; logout; verificarToken |
| MapsService | 100% | Cálculo de trayecto/hora de llegada/hora de salida (coords y municipio como texto); error si no hay ruta |
| StripeService | ~97% | Onboarding, estado de cuenta, PaymentIntent y sus validaciones, captura+transferencia al completar, reembolso, captura parcial de cancelaciones, retiro de incentivos (con comisión de Instant Payout), sincronización desde webhook |
| CancelacionesService | ~95% | Tramos ciudad/fuera de ciudad, override "taxista ya salió", compensación a titular/suplente, penalización al taxista, justificación/resolución, suspensión por impago |
| TrayectosService | ~93% | Crear trayecto, listar por rol, las 3 reglas de matching (municipio/aeropuerto-muelle/evento especial), aceptar como titular/suplente, cambiarEstado con transiciones por rol y promoción de suplente |
| AuthGuard | 100% | Falta de cabecera, formato inválido, token inválido, caso feliz |
| HttpExceptionFilter | 100% | Los 4 formatos de cuerpo que puede normalizar (Zod, string, message string, message array) |

**No cubierto (deliberado, no bloquea el ticket):** controllers (los 5), DTOs,
`main.ts`, `config/logger.ts`, middleware. Si se quiere subir más el
porcentaje global que reporta Sonar, el siguiente paso natural sería tests
e2e con `supertest` contra los controllers, no unitarios aislados.

## Cómo correrlos

```bash
npm test              # una vez
npm run test:watch    # modo watch
npm run test:cov       # con tabla de cobertura (carpeta coverage/, no se commitea)
```
